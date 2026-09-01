import { NextRequest, NextResponse } from "next/server";
import { getSupabase, verifyCron } from "@/lib/supabase";
import {
  getOAuthToken,
  getFallbackTokens,
  getAccountToken,
  setAccountToken,
  TOKEN_RETRY_STATUSES,
} from "@/lib/gbp-token";
import { getLocationMap } from "@/lib/gbp-location";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const GO_API_URL = process.env.NEXT_PUBLIC_API_URL || "";
const GBP_API_BASE = "https://mybusiness.googleapis.com/v4";
const BATCH_SIZE = 100; // 1回のCron実行で処理する店舗数

// ── GBP Reviews取得 ──

interface GBPReview {
  reviewId: string;
  reviewer: { displayName: string; profilePhotoUrl?: string };
  starRating: string;
  comment?: string;
  createTime: string;
  updateTime?: string;
  reviewReply?: { comment: string; updateTime?: string };
}

interface FetchResult {
  reviews: GBPReview[];
  totalCount: number;
  avgRating: number;
  authError: boolean; // 401/403（トークン失効）を検出。空応答と区別する
  apiError?: number; // 404含むHTTPエラー。トークンフォールバックの判定に使う
}

async function fetchReviews(fullPath: string, token: string): Promise<FetchResult> {
  const all: GBPReview[] = [];
  let nextPage: string | undefined;
  let pages = 0;
  let retries429 = 0;
  let totalCount = 0;
  let avgRating = 0;
  let authError = false;
  let apiError: number | undefined;
  const MAX_429_RETRIES = 3;
  do {
    const params = new URLSearchParams({ orderBy: "updateTime desc", pageSize: "50" });
    if (nextPage) params.set("pageToken", nextPage);
    const res = await fetch(`${GBP_API_BASE}/${fullPath}/reviews?${params}`, {
      cache: "no-store" as const,
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000),
    });
    if (res.status === 429) {
      retries429++;
      if (retries429 >= MAX_429_RETRIES) {
        console.warn(`[cron/sync-reviews] 429 rate limit exceeded ${MAX_429_RETRIES} times for ${fullPath}, skipping`);
        break;
      }
      await new Promise(r => setTimeout(r, 10000 * retries429));
      continue;
    }
    if (res.status === 401 || res.status === 403) { authError = true; apiError = res.status; break; }
    if (!res.ok) { apiError = res.status; break; }
    retries429 = 0;
    const data = await res.json();
    if (data.reviews) all.push(...data.reviews);
    if (data.totalReviewCount) totalCount = data.totalReviewCount;
    if (data.averageRating) avgRating = data.averageRating;
    nextPage = data.nextPageToken;
    pages++;
  } while (nextPage && pages < 40);
  return { reviews: all, totalCount, avgRating, authError, apiError };
}

/**
 * トークンフォールバック付きの口コミ取得（report/sync-reviewsと同パターン）。
 * 1本のトークンでは見えないアカウントがあり、v4 APIは権限が無くても404を返す
 * （重要ナレッジ 2026-08-15）。401/403/404 のときだけ全トークンで順に再試行する。
 */
async function fetchReviewsWithTokenFallback(fullPath: string, primaryToken: string): Promise<FetchResult & { usedToken: string }> {
  const tried = new Set<string>();
  const attempt = async (t: string) => {
    tried.add(t);
    const r = await fetchReviews(fullPath, t);
    if (!r.apiError) setAccountToken(fullPath, t);
    return { ...r, usedToken: t };
  };
  // 1ページ目が通ればトークンからロケーションは見えている＝途中エラーはトークン問題ではない
  const shouldRetry = (r: FetchResult) =>
    r.apiError !== undefined && TOKEN_RETRY_STATUSES.includes(r.apiError) && r.reviews.length === 0;

  const firstToken = getAccountToken(fullPath) || primaryToken;
  let result = await attempt(firstToken);
  if (!shouldRetry(result)) return result;

  const fallbacks = await getFallbackTokens();
  for (const t of [primaryToken, ...fallbacks]) {
    if (tried.has(t)) continue;
    const r = await attempt(t);
    if (!shouldRetry(r)) return r;
    result = r;
  }
  return result;
}

/**
 * オーナー権限（VoiceOfMerchant）の確認（report/sync-reviewsと同じ）。
 * 権限が無いロケーションは200で口コミ空が返り「本当に0件」と区別できないため、
 * 0件だった店舗だけ確認してログに残す（cronはログ・集計のみ、DBには書かない）。
 * @returns true=権限あり / false=権限なし / null=判定不能
 */
async function checkVoiceOfMerchant(fullPath: string, token: string): Promise<boolean | null> {
  const locPart = fullPath.match(/locations\/[^/]+/)?.[0];
  if (!locPart) return null;
  try {
    const res = await fetch(
      `https://mybusinessverifications.googleapis.com/v1/${locPart}/VoiceOfMerchantState`,
      {
        cache: "no-store" as const,
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    // proto3ではfalseのbooleanが省略されることがあるため「=== true」で判定
    return data.hasVoiceOfMerchant === true;
  } catch {
    return null;
  }
}

// ── 同期進捗管理（Supabase sync_progress テーブル） ──

async function getSyncOffset(): Promise<number> {
  const supabase = getSupabase();
  try {
    const { data } = await supabase.from("sync_progress")
      .select("offset_value, updated_at")
      .eq("job_name", "sync-reviews")
      .maybeSingle();
    if (data) {
      // 24時間以内のオフセットなら続行、それ以上なら最初から
      const age = Date.now() - new Date(data.updated_at).getTime();
      if (age < 24 * 60 * 60 * 1000) return data.offset_value || 0;
    }
  } catch (e: any) { console.error("[cron/sync-reviews] get sync offset:", e?.message); }
  return 0;
}

async function setSyncOffset(offset: number): Promise<void> {
  const supabase = getSupabase();
  try {
    await supabase.from("sync_progress").upsert({
      job_name: "sync-reviews",
      offset_value: offset,
      updated_at: new Date().toISOString(),
    }, { onConflict: "job_name" });
  } catch (e: any) {
    console.log("[cron/sync-reviews] Failed to save offset:", e?.message);
  }
}

// ── メインCronハンドラ ──

/**
 * GET /api/cron/sync-reviews
 * 毎時実行: 50店舗ずつ口コミ自動同期
 * 12時間で全555店舗を1周（50店舗/時 × 12時間 = 600店舗）
 */
export async function GET(request: NextRequest) {
  const cronErr = verifyCron(request); if (cronErr) return cronErr;

  console.log("[cron/sync-reviews] Starting batch sync...");

  // 1. OAuthトークン取得（gbp-token.ts統一経路）
  const token = await getOAuthToken();
  if (!token) {
    console.error("[cron/sync-reviews] No valid token");
    return NextResponse.json({ error: "OAuthトークン取得失敗" }, { status: 500 });
  }
  console.log(`[cron/sync-reviews] Token ready via gbp-token.ts`);

  // 2. ロケーションマッピング
  const locMap = await getLocationMap();

  // 3. 店舗一覧取得
  let shops: { id: string; name: string; gbp_location_name: string }[] = [];
  try {
    const goRes = await fetch(`${GO_API_URL}/api/shop`, {
      cache: "no-store" as const,
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (goRes.ok) {
      const goData = await goRes.json();
      shops = (Array.isArray(goData) ? goData : []).map((s: any) => ({
        id: s.id || s.ID,
        name: s.name || s.Name,
        gbp_location_name: s.gbp_location_name || s.GbpLocationName || "",
      }));
    }
  } catch (e: any) { console.error("[cron/sync-reviews] Go API shop list fetch:", e?.message); }

  if (shops.length === 0) {
    return NextResponse.json({ error: "店舗取得失敗" }, { status: 500 });
  }

  // 3.5 解約店舗を除外
  try {
    const supabaseForCancel = getSupabase();
    const { data: cancelledData } = await supabaseForCancel
      .from("shops")
      .select("id")
      .not("cancelled_at", "is", null);
    if (cancelledData && cancelledData.length > 0) {
      const cancelledIds = new Set(cancelledData.map(c => c.id));
      const beforeCount = shops.length;
      shops = shops.filter(s => !cancelledIds.has(s.id));
      console.log(`[cron/sync-reviews] Cancelled filter: ${beforeCount} → ${shops.length} active shops`);
    }
  } catch (e: any) { console.error("[cron/sync-reviews] cancelled filter:", e?.message); }

  // 3.6 契約中の店舗のみに絞り込み（API代節約）
  try {
    const { fetchCustomerSheet } = await import("@/lib/customer-sheet");
    const custMap = await fetchCustomerSheet();
    if (custMap.size > 0) {
      const beforeCount = shops.length;
      shops = shops.filter(s => {
        const key = s.name.replace(/\s+/g, " ").trim().toLowerCase();
        if (custMap.has(key)) return true;
        for (const k of Array.from(custMap.keys())) {
          if (k.length >= 3 && key.length >= 3 && (key.includes(k) || k.includes(key))) return true;
        }
        return false;
      });
      console.log(`[cron/sync-reviews] Filtered: ${beforeCount} → ${shops.length} contracted shops`);
    }
  } catch (e: any) { console.error("[cron/sync-reviews] customer sheet filter:", e?.message); }

  // 4. オフセットから50店舗分を取得
  let offset = await getSyncOffset();
  if (offset >= shops.length) offset = 0; // 1周完了 → 最初から

  const batch = shops.slice(offset, offset + BATCH_SIZE);
  console.log(`[cron/sync-reviews] Processing shops ${offset + 1}〜${offset + batch.length} / ${shops.length}`);

  // 5. 1店舗ずつ同期
  const supabase = getSupabase();
  const startTime = Date.now();
  const TIME_LIMIT = 270_000; // 270秒でループを打ち切り、必ずオフセット保存まで到達させる（maxDuration=300s）
  let synced = 0;
  let errors = 0;
  let noPermissionCount = 0;
  const noPermissionShops: string[] = [];
  let consecutiveAuthErrors = 0;
  let lastProcessedIndex = 0; // 最後に処理した店舗のインデックス（offset計算用）
  let stoppedByTime = false;

  // Supabase shop_idマップを構築（Go API IDではなくSupabase IDを使うため）
  const batchNames = batch.map(s => s.name);
  const { data: sbShops } = await supabase.from("shops").select("id, name").in("name", batchNames);
  const sbShopIdMap = new Map((sbShops || []).map(s => [s.name, s.id]));

  for (let i = 0; i < batch.length; i++) {
    // 時間切れ前に打ち切り: ここでbreakすればループ後のオフセット保存が必ず実行され、
    // 処理済み分だけ前進する（Vercelの強制killでオフセット未保存になるのを防ぐ）
    if (Date.now() - startTime > TIME_LIMIT) {
      stoppedByTime = true;
      console.log(`[cron/sync-reviews] 時間切れ、${i}/${batch.length}店舗で打ち切り`);
      break;
    }

    const shop = batch[i];

    // フルパス解決
    let fullPath = "";
    const gbpLoc = shop.gbp_location_name;
    if (gbpLoc && gbpLoc.startsWith("accounts/")) {
      fullPath = gbpLoc;
    } else if (gbpLoc) {
      const m = locMap.get(gbpLoc);
      if (m) fullPath = m.fullPath;
    }
    if (!fullPath && shop.name) {
      const m = locMap.get(shop.name);
      if (m) fullPath = m.fullPath;
    }
    if (!fullPath) {
      lastProcessedIndex = i + 1; // フルパス未解決でもスキップとしてカウント
      continue;
    }

    try {
      // 401/403/404は全アカウントのトークンで順に再試行（アカウントごとにアクセス権が異なるため）
      const result = await fetchReviewsWithTokenFallback(fullPath, token);

      // トークン失効（401/403）: 「口コミ0件」と誤認して同期済み扱いにしない。
      // （フォールバック済みなので、ここに来るのは全トークンで401/403だった場合）
      if (result.authError) {
        console.error(`[cron/sync-reviews] 認証エラー(401/403) for ${shop.name}`);
        errors++;
        consecutiveAuthErrors++;
        // 連続3回 = トークンが全体的に失効している可能性 → オフセットを進めず中断（次回再試行）
        if (consecutiveAuthErrors >= 3) {
          console.error("[cron/sync-reviews] 連続3回の認証エラー、バッチ中断（オフセット非前進）");
          break;
        }
        // 単発の401（その店舗だけ権限なし）→ スキップして前進（後続店舗が永久に滞留するのを防ぐ）
        lastProcessedIndex = i + 1;
        continue;
      }

      const reviews = result.reviews;
      if (reviews.length === 0) {
        // 0件のときだけオーナー権限を確認（権限が無いと200で空が返り、0件と区別できないため）
        // cronではログ・集計のみ（DBには書かない。可視化は手動同期のstatusで行う）
        if (!result.apiError) {
          const vom = await checkVoiceOfMerchant(fullPath, result.usedToken);
          if (vom === false) {
            noPermissionCount++;
            noPermissionShops.push(shop.name);
            console.warn(`[cron/sync-reviews] no VoiceOfMerchant for "${shop.name}" (path: ${fullPath})`);
          }
        }
        lastProcessedIndex = i + 1; // 口コミ0件でもスキップとしてカウント
        continue;
      }

      consecutiveAuthErrors = 0; // 成功したらリセット

      const rows = reviews.map((r) => ({
        shop_id: sbShopIdMap.get(shop.name) || shop.id, shop_name: shop.name, review_id: r.reviewId,
        reviewer_name: r.reviewer?.displayName || "匿名",
        reviewer_photo_url: r.reviewer?.profilePhotoUrl || null,
        star_rating: r.starRating, comment: r.comment || null,
        reply_comment: r.reviewReply?.comment || null,
        reply_time: r.reviewReply?.updateTime || null,
        create_time: r.createTime, update_time: r.updateTime || null,
        synced_at: new Date().toISOString(),
      }));

      for (let j = 0; j < rows.length; j += 50) {
        await supabase.from("reviews").upsert(rows.slice(j, j + 50), { onConflict: "review_id" });
      }

      // Google公式評価 + GBPフルパスをshopsテーブルに永続保存
      {
        const updateData: Record<string, any> = {};
        if (result.avgRating > 0) updateData.rating = result.avgRating;
        if (result.totalCount > 0) updateData.review_count = result.totalCount;
        if (fullPath) {
          updateData.gbp_full_path = fullPath;
          const locPart = fullPath.match(/(locations\/[^/]+)/)?.[1] || "";
          if (locPart) updateData.gbp_location_name = locPart;
        }
        if (Object.keys(updateData).length > 0) {
          await supabase.from("shops").update(updateData).eq("name", shop.name);
        }
      }

      synced += reviews.length;
      lastProcessedIndex = i + 1;

      // レート制限対策: 2秒待機
      if (i < batch.length - 1) await new Promise(r => setTimeout(r, 2000));
    } catch (e: any) {
      console.error(`[cron/sync-reviews] Error for ${shop.name}:`, e?.message);
      errors++;
      consecutiveAuthErrors++;
      lastProcessedIndex = i + 1;

      // 連続5回失敗 → バッチ中断
      if (consecutiveAuthErrors >= 5) {
        console.error("[cron/sync-reviews] 連続5回エラー、バッチ中断");
        break;
      }
    }
  }

  // 6. オフセット更新（実際に処理した分だけ進める — エラーで中断した場合はそこから再開）
  const nextOffset = offset + lastProcessedIndex;
  await setSyncOffset(nextOffset >= shops.length ? 0 : nextOffset);

  const result = {
    success: true,
    range: `${offset + 1}〜${offset + batch.length}`,
    totalShops: shops.length,
    batchSize: batch.length,
    synced,
    errors,
    noPermissionCount,
    noPermissionShops,
    stoppedByTime,
    processed: lastProcessedIndex,
    nextOffset: nextOffset >= shops.length ? 0 : nextOffset,
    completedCycle: nextOffset >= shops.length,
  };

  console.log("[cron/sync-reviews] Done:", result);
  return NextResponse.json(result);
}
