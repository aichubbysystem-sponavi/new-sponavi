import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const GO_API_URL = process.env.NEXT_PUBLIC_API_URL || "";
const GBP_CLIENT_ID = process.env.GBP_CLIENT_ID || "";
const GBP_CLIENT_SECRET = process.env.GBP_CLIENT_SECRET || "";
const DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD || "";
const SUPABASE_PROJECT_ID = (SUPABASE_URL.match(/https:\/\/([^.]+)/) || [])[1] || "";
const GBP_API_BASE = "https://mybusiness.googleapis.com/v4";
const BATCH_SIZE = 50; // 1回のCron実行で処理する店舗数

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
}

// ── トークン取得（sync-reviews/route.tsと同じ3段階フォールバック） ──

async function getValidToken(): Promise<string | null> {
  // Go APIにGBP APIを叩かせてトークンリフレッシュ発火
  try {
    await fetch(`${GO_API_URL}/api/gbp/account`, { signal: AbortSignal.timeout(15000) });
  } catch {}

  // 1. Supabase REST API (system schema)
  try {
    const key = SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY;
    if (key) {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/tokens?select=access_token,refresh_token,expiry&order=expiry.desc&limit=1`,
        { headers: { apikey: key, Authorization: `Bearer ${key}`, "Accept-Profile": "system" }, signal: AbortSignal.timeout(5000) }
      );
      if (res.ok) {
        const rows = await res.json();
        if (Array.isArray(rows) && rows.length > 0 && rows[0].access_token) {
          const t = rows[0];
          if (new Date(t.expiry).getTime() - Date.now() > 60000) return t.access_token;
          if (t.refresh_token) {
            const refreshed = await refreshToken(t.refresh_token);
            if (refreshed) return refreshed;
          }
          return t.access_token;
        }
      }
    }
  } catch {}

  // 2. Supabase client
  try {
    const supabase = getSupabase();
    const { data } = await supabase.from("system_oauth_tokens")
      .select("access_token, refresh_token, expiry").order("expiry", { ascending: false }).limit(1).maybeSingle();
    if (data?.access_token) {
      if (new Date(data.expiry).getTime() - Date.now() > 60000) return data.access_token;
      if (data.refresh_token) { const r = await refreshToken(data.refresh_token); if (r) return r; }
      return data.access_token;
    }
  } catch {}

  // 3. PostgreSQL直接接続
  try {
    if (DB_PASSWORD && SUPABASE_PROJECT_ID) {
      const { Client } = await import("pg");
      const client = new Client({
        host: `db.${SUPABASE_PROJECT_ID}.supabase.co`, port: 5432,
        database: "postgres", user: "postgres", password: DB_PASSWORD,
        ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000,
      });
      await client.connect();
      const result = await client.query("SELECT access_token, refresh_token, expiry FROM system.tokens ORDER BY expiry DESC LIMIT 1");
      await client.end();
      if (result.rows.length > 0) {
        const r = result.rows[0];
        const token = r.access_token;
        if (new Date(r.expiry).getTime() - Date.now() > 60000) return token;
        if (r.refresh_token) { const refreshed = await refreshToken(r.refresh_token); if (refreshed) return refreshed; }
        return token;
      }
    }
  } catch (e: any) {
    console.log("[cron/sync-reviews] PostgreSQL error:", e?.message);
  }

  return null;
}

async function refreshToken(rt: string): Promise<string | null> {
  if (!rt || !GBP_CLIENT_ID || !GBP_CLIENT_SECRET) return null;
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: GBP_CLIENT_ID, client_secret: GBP_CLIENT_SECRET, refresh_token: rt, grant_type: "refresh_token" }),
    });
    if (res.ok) { const d = await res.json(); return d.access_token || null; }
  } catch {}
  return null;
}

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
  } catch {}
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

async function fetchReviews(fullPath: string, token: string): Promise<GBPReview[]> {
  const all: GBPReview[] = [];
  let nextPage: string | undefined;
  let pages = 0;
  let retries429 = 0;
  const MAX_429_RETRIES = 3;
  do {
    const params = new URLSearchParams({ orderBy: "updateTime desc", pageSize: "50" });
    if (nextPage) params.set("pageToken", nextPage);
    const res = await fetch(`${GBP_API_BASE}/${fullPath}/reviews?${params}`, {
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
    retries429 = 0; // 成功したらリセット
    const data = await res.json();
    if (data.reviews) all.push(...data.reviews);
    nextPage = data.nextPageToken;
    pages++;
  } while (nextPage && pages < 20);
  return all;
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
  } catch {}
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
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    console.error("[cron/sync-reviews] Unauthorized: CRON_SECRET未設定または不一致");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("[cron/sync-reviews] Starting batch sync...");

  // 1. トークン取得
  const token = await getValidToken();
  if (!token) {
    console.error("[cron/sync-reviews] No valid token");
    return NextResponse.json({ error: "OAuthトークン取得失敗" }, { status: 500 });
  }

  // 2. ロケーションマッピング
  const locMap = await getLocationMap();

  // 3. 店舗一覧取得
  let shops: { id: string; name: string; gbp_location_name: string }[] = [];
  try {
    const goRes = await fetch(`${GO_API_URL}/api/shop`, {
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
  } catch {}

  if (shops.length === 0) {
    return NextResponse.json({ error: "店舗取得失敗" }, { status: 500 });
  }

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
  let currentToken = token;

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
      const reviews = await fetchReviews(fullPath, currentToken);
      if (reviews.length === 0) continue;

      consecutiveAuthErrors = 0; // 成功したらリセット

      const rows = reviews.map((r) => ({
        shop_id: shop.id, shop_name: shop.name, review_id: r.reviewId,
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

      synced += reviews.length;

      // レート制限対策: 2秒待機
      if (i < batch.length - 1) await new Promise(r => setTimeout(r, 2000));
    } catch (e: any) {
      console.error(`[cron/sync-reviews] Error for ${shop.name}:`, e?.message);
      errors++;
      consecutiveAuthErrors++;

      // 連続3回失敗 → トークン再取得を試みる
      if (consecutiveAuthErrors >= 3) {
        console.warn("[cron/sync-reviews] 連続エラー: トークン再取得中...");
        const newToken = await getValidToken();
        if (newToken) {
          currentToken = newToken;
          consecutiveAuthErrors = 0;
          console.log("[cron/sync-reviews] トークン再取得成功");
        } else {
          console.error("[cron/sync-reviews] トークン再取得失敗、バッチ中断");
          break;
        }
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
