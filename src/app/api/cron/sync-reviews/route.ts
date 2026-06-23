import { NextRequest, NextResponse } from "next/server";
import { getSupabase, verifyCron } from "@/lib/supabase";
import { getOAuthToken } from "@/lib/gbp-token";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const GO_API_URL = process.env.NEXT_PUBLIC_API_URL || "";
const GBP_API_BASE = "https://mybusiness.googleapis.com/v4";
const BATCH_SIZE = 100; // 1回のCron実行で処理する店舗数

// ── ロケーションマッピング ──

interface LocMapping { fullPath: string; title: string; }

async function getLocationMap(): Promise<Map<string, LocMapping>> {
  const map = new Map<string, LocMapping>();
  try {
    const res = await fetch(`${GO_API_URL}/api/gbp/account`, { signal: AbortSignal.timeout(20000) });
    if (res.ok) {
      const accounts = await res.json();
      for (const acc of (Array.isArray(accounts) ? accounts : [])) {
        const accName = acc.name || "";
        for (const loc of (acc.locations || [])) {
          const locName = loc.name || "";
          const fullPath = `${accName}/${locName}`;
          const m: LocMapping = { fullPath, title: loc.title || "" };
          map.set(locName, m);
          map.set(fullPath, m);
          if (loc.title) map.set(loc.title, m);
        }
      }
    }
  } catch (e: any) { console.error("[cron/sync-reviews] location map fetch:", e?.message); }
  return map;
}

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
}

async function fetchReviews(fullPath: string, token: string): Promise<FetchResult> {
  const all: GBPReview[] = [];
  let nextPage: string | undefined;
  let pages = 0;
  let retries429 = 0;
  let totalCount = 0;
  let avgRating = 0;
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
    if (!res.ok) break;
    retries429 = 0;
    const data = await res.json();
    if (data.reviews) all.push(...data.reviews);
    if (data.totalReviewCount) totalCount = data.totalReviewCount;
    if (data.averageRating) avgRating = data.averageRating;
    nextPage = data.nextPageToken;
    pages++;
  } while (nextPage && pages < 40);
  return { reviews: all, totalCount, avgRating };
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
  const allTokens = [token];
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
  let synced = 0;
  let errors = 0;
  let consecutiveAuthErrors = 0;

  // Supabase shop_idマップを構築（Go API IDではなくSupabase IDを使うため）
  const batchNames = batch.map(s => s.name);
  const { data: sbShops } = await supabase.from("shops").select("id, name").in("name", batchNames);
  const sbShopIdMap = new Map((sbShops || []).map(s => [s.name, s.id]));

  for (let i = 0; i < batch.length; i++) {
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
    if (!fullPath) continue;

    try {
      // 全トークンを試す（アカウントごとにアクセス権が異なるため）
      let result: FetchResult = { reviews: [], totalCount: 0, avgRating: 0 };
      for (const t of allTokens) {
        result = await fetchReviews(fullPath, t);
        if (result.reviews.length > 0) break;
      }
      const reviews = result.reviews;
      if (reviews.length === 0) continue;

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

      // Google公式評価をshopsテーブルに保存（店舗名で検索 — Go API IDとSupabase IDは異なる）
      if (result.avgRating > 0 || result.totalCount > 0) {
        const updateData: Record<string, any> = {};
        if (result.avgRating > 0) updateData.rating = result.avgRating;
        if (result.totalCount > 0) updateData.review_count = result.totalCount;
        await supabase.from("shops").update(updateData).eq("name", shop.name);
      }

      synced += reviews.length;

      // レート制限対策: 2秒待機
      if (i < batch.length - 1) await new Promise(r => setTimeout(r, 2000));
    } catch (e: any) {
      console.error(`[cron/sync-reviews] Error for ${shop.name}:`, e?.message);
      errors++;
      consecutiveAuthErrors++;

      // 連続5回失敗 → バッチ中断
      if (consecutiveAuthErrors >= 5) {
        console.error("[cron/sync-reviews] 連続5回エラー、バッチ中断");
        break;
      }
    }
  }

  // 6. オフセット更新
  const nextOffset = offset + BATCH_SIZE;
  await setSyncOffset(nextOffset >= shops.length ? 0 : nextOffset);

  const result = {
    success: true,
    range: `${offset + 1}〜${offset + batch.length}`,
    totalShops: shops.length,
    batchSize: batch.length,
    synced,
    errors,
    nextOffset: nextOffset >= shops.length ? 0 : nextOffset,
    completedCycle: nextOffset >= shops.length,
  };

  console.log("[cron/sync-reviews] Done:", result);
  return NextResponse.json(result);
}
