import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const GBP_API_BASE = "https://mybusiness.googleapis.com/v4";
const GBP_CLIENT_ID = process.env.GBP_CLIENT_ID || "";
const GBP_CLIENT_SECRET = process.env.GBP_CLIENT_SECRET || "";
const GO_API_URL = process.env.NEXT_PUBLIC_API_URL || "";
const DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD || "";
const SUPABASE_PROJECT_ID = (SUPABASE_URL.match(/https:\/\/([^.]+)/) || [])[1] || "";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
}

// ============================================================
// トークン管理: Cron版と統一した3段階フォールバック
// ============================================================

/**
 * トークンをリフレッシュ
 */
async function refreshToken(rt: string): Promise<string | null> {
  if (!rt || !GBP_CLIENT_ID || !GBP_CLIENT_SECRET) return null;
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GBP_CLIENT_ID,
        client_secret: GBP_CLIENT_SECRET,
        refresh_token: rt,
        grant_type: "refresh_token",
      }),
    });
    if (res.ok) {
      const d = await res.json();
      return d.access_token || null;
    } else {
      console.log("[sync-reviews] Token refresh failed:", res.status);
    }
  } catch (e: any) {
    console.log("[sync-reviews] Token refresh error:", e?.message);
  }
  return null;
}

/**
 * 全アカウントの有効なトークンを取得（期限切れはリフレッシュ）
 */
async function getAllValidTokens(): Promise<string[]> {
  // Go APIにGBP APIを叩かせてトークンリフレッシュ発火
  try {
    await fetch(`${GO_API_URL}/api/gbp/account`, { signal: AbortSignal.timeout(15000) });
  } catch {}

  interface TokenRow { access_token: string; refresh_token: string; expiry: string; }
  let allRows: TokenRow[] = [];

  // 1. Supabase client (system_oauth_tokens view) — 全トークン取得
  try {
    const supabase = getSupabase();
    const { data } = await supabase.from("system_oauth_tokens")
      .select("access_token, refresh_token, expiry")
      .order("expiry", { ascending: false });
    if (data && data.length > 0) {
      allRows = data as TokenRow[];
      console.log(`[sync-reviews] Got ${allRows.length} tokens from system_oauth_tokens`);
    }
  } catch (e: any) {
    console.log("[sync-reviews] system_oauth_tokens error:", e?.message);
  }

  // 2. フォールバック: PostgreSQL直接接続
  if (allRows.length === 0) {
    try {
      if (DB_PASSWORD && SUPABASE_PROJECT_ID) {
        const { Client } = await import("pg");
        const client = new Client({
          host: `db.${SUPABASE_PROJECT_ID}.supabase.co`, port: 5432,
          database: "postgres", user: "postgres", password: DB_PASSWORD,
          ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000,
        });
        await client.connect();
        const result = await client.query("SELECT access_token, refresh_token, expiry FROM system.tokens ORDER BY expiry DESC");
        await client.end();
        if (result.rows.length > 0) {
          allRows = result.rows;
          console.log(`[sync-reviews] Got ${allRows.length} tokens from PostgreSQL`);
        }
      }
    } catch (e: any) {
      console.log("[sync-reviews] PostgreSQL error:", e?.message);
    }
  }

  if (allRows.length === 0) {
    console.log("[sync-reviews] No tokens found in DB");
    return [];
  }

  // 全トークンをリフレッシュして有効なものを返す
  const validTokens: string[] = [];
  for (const row of allRows) {
    if (new Date(row.expiry).getTime() - Date.now() > 60000) {
      // まだ有効
      validTokens.push(row.access_token);
    } else if (row.refresh_token) {
      // 期限切れ → リフレッシュ
      const refreshed = await refreshToken(row.refresh_token);
      if (refreshed) {
        validTokens.push(refreshed);
      } else {
        // リフレッシュ失敗でも古いトークンを試す
        validTokens.push(row.access_token);
      }
    } else {
      validTokens.push(row.access_token);
    }
  }

  console.log(`[sync-reviews] ${validTokens.length} valid tokens ready`);
  return validTokens;
}

/** 後方互換: 1つだけ返す */
async function getValidToken(): Promise<string | null> {
  const tokens = await getAllValidTokens();
  return tokens[0] || null;
}

// ============================================================
// GBPアカウント→ロケーションマッピング
// ============================================================

interface LocationMapping {
  locationName: string;      // "locations/XXX"
  accountName: string;       // "accounts/YYY"
  fullPath: string;          // "accounts/YYY/locations/XXX"
  title: string;             // 店舗名
}

let locationMapCache: { map: Map<string, LocationMapping>; ts: number } | null = null;

async function getLocationMap(): Promise<Map<string, LocationMapping>> {
  if (locationMapCache && Date.now() - locationMapCache.ts < 600000) return locationMapCache.map;

  const map = new Map<string, LocationMapping>();
  try {
    const res = await fetch(`${GO_API_URL}/api/gbp/account`, { signal: AbortSignal.timeout(20000) });
    if (res.ok) {
      const accounts = await res.json();
      for (const acc of (Array.isArray(accounts) ? accounts : [])) {
        const accName = acc.name || ""; // "accounts/XXX"
        for (const loc of (acc.locations || [])) {
          const locName = loc.name || ""; // "locations/YYY"
          const fullPath = `${accName}/${locName}`;
          const mapping: LocationMapping = { locationName: locName, accountName: accName, fullPath, title: loc.title || "" };
          map.set(locName, mapping);
          map.set(fullPath, mapping);
          if (loc.title) map.set(loc.title, mapping);
        }
      }
    }
  } catch {}

  console.log("[sync-reviews] Location map built:", map.size, "entries");
  locationMapCache = { map, ts: Date.now() };
  return map;
}

// ============================================================
// GBP Reviews API
// ============================================================

interface GBPReview {
  name: string;
  reviewId: string;
  reviewer: { displayName: string; profilePhotoUrl?: string };
  starRating: string;
  comment?: string;
  createTime: string;
  updateTime?: string;
  reviewReply?: { comment: string; updateTime?: string };
}

async function fetchReviews(
  fullPath: string,
  accessToken: string
): Promise<{ reviews: GBPReview[]; totalCount: number; avgRating: number; apiError?: number }> {
  const allReviews: GBPReview[] = [];
  let nextPageToken: string | undefined;
  let totalCount = 0;
  let avgRating = 0;
  let pageCount = 0;
  let retries429 = 0;
  let apiError: number | undefined;

  do {
    const params = new URLSearchParams({ orderBy: "updateTime desc", pageSize: "50" });
    if (nextPageToken) params.set("pageToken", nextPageToken);

    const res = await fetch(`${GBP_API_BASE}/${fullPath}/reviews?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15000),
    });

    if (res.status === 429) {
      retries429 = (retries429 || 0) + 1;
      if (retries429 >= 3) {
        console.warn(`[sync-reviews] 429 rate limit exceeded 3 times for ${fullPath}, skipping`);
        apiError = 429;
        break;
      }
      console.log(`[sync-reviews] Rate limited for ${fullPath}, waiting ${10 * retries429}s... (retry ${retries429}/3)`);
      await new Promise(r => setTimeout(r, 10000 * retries429));
      continue;
    }
    retries429 = 0;

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      console.error(`[sync-reviews] GBP API error for ${fullPath}:`, res.status, err.slice(0, 200));
      apiError = res.status;
      break;
    }

    const data = await res.json();
    if (data.reviews) allReviews.push(...data.reviews);
    if (data.totalReviewCount) totalCount = data.totalReviewCount;
    if (data.averageRating) avgRating = data.averageRating;
    nextPageToken = data.nextPageToken;
    pageCount++;
  } while (nextPageToken && pageCount < 20);

  return { reviews: allReviews, totalCount, avgRating, apiError };
}

// ============================================================
// メインAPI
// ============================================================

export async function POST(request: NextRequest) {
  try {
    const { verifyAuth } = await import("@/lib/auth-verify");
    const auth = await verifyAuth(request.headers.get("authorization"));
    if (!auth.valid) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const shopIds: string[] = body.shopIds || [];

    // 1. 全アカウントのOAuthトークン取得
    const allTokens = await getAllValidTokens();
    const accessToken = allTokens[0] || null;
    if (!accessToken) {
      return NextResponse.json({
        error: "OAuthトークンが取得できません。GBPアカウント管理からGoogleアカウントを再認証してください。",
      }, { status: 500 });
    }

    // 2. ロケーションマッピング取得
    const locMap = await getLocationMap();

    // 3. 店舗一覧取得
    let shops: { id: string; name: string; gbp_location_name: string }[] = [];
    try {
      const goRes = await fetch(`${GO_API_URL}/api/shop`, {
        headers: { Authorization: `Bearer ${accessToken}` },
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
      return NextResponse.json({ error: "店舗の取得に失敗しました" }, { status: 500 });
    }

    if (shopIds.length > 0) {
      const idSet = new Set(shopIds);
      shops = shops.filter(s => idSet.has(s.id));
    }

    if (shops.length === 0) {
      return NextResponse.json({ error: "対象店舗が見つかりません" }, { status: 400 });
    }

    // 4. 店舗ごとに口コミ取得・保存
    const supabase = getSupabase();
    let totalSynced = 0;
    let totalErrors = 0;
    const results: { shopName: string; count: number; status: string }[] = [];

    for (let si = 0; si < shops.length; si++) {
      const shop = shops[si];

      // ロケーションのフルパスを解決
      let fullPath = "";
      const gbpLoc = shop.gbp_location_name;

      if (gbpLoc && gbpLoc.startsWith("accounts/")) {
        // 既にフルパス
        fullPath = gbpLoc;
      } else if (gbpLoc) {
        // locations/XXX形式 → マッピングからフルパスを取得
        const mapping = locMap.get(gbpLoc);
        if (mapping) {
          fullPath = mapping.fullPath;
        }
      }

      // gbp_location_nameが空の場合、店舗名でマッチ
      if (!fullPath && shop.name) {
        const mapping = locMap.get(shop.name);
        if (mapping) {
          fullPath = mapping.fullPath;
        }
      }

      if (!fullPath) {
        console.log(`[sync-reviews] No GBP location for "${shop.name}" (gbp_location_name: "${gbpLoc}")`);
        results.push({ shopName: shop.name, count: 0, status: "no_gbp_location" });
        continue;
      }

      try {
        // 全トークンを順番に試す（アカウントごとにアクセス権が異なるため）
        let reviews: GBPReview[] = [];
        let apiError: number | undefined;
        for (let ti = 0; ti < allTokens.length; ti++) {
          const result = await fetchReviews(fullPath, allTokens[ti]);
          if (result.reviews.length > 0) {
            reviews = result.reviews;
            apiError = undefined;
            break;
          }
          apiError = result.apiError;
          // 最後のトークン以外でエラーなら次を試す
          if (ti < allTokens.length - 1 && (result.apiError || result.reviews.length === 0)) {
            continue;
          }
        }

        if (reviews.length === 0) {
          if (apiError === 404) {
            console.log(`[sync-reviews] 404 for "${shop.name}" (path: ${fullPath}, tried ${allTokens.length} tokens)`);
            results.push({ shopName: shop.name, count: 0, status: "api_404" });
          } else if (apiError) {
            results.push({ shopName: shop.name, count: 0, status: `api_error_${apiError}` });
          } else {
            results.push({ shopName: shop.name, count: 0, status: "no_reviews" });
          }
          continue;
        }

        // Supabaseにupsert
        const rows = reviews.map((r) => ({
          shop_id: shop.id,
          shop_name: shop.name,
          review_id: r.reviewId,
          reviewer_name: r.reviewer?.displayName || "匿名",
          reviewer_photo_url: r.reviewer?.profilePhotoUrl || null,
          star_rating: r.starRating,
          comment: r.comment || null,
          reply_comment: r.reviewReply?.comment || null,
          reply_time: r.reviewReply?.updateTime || null,
          create_time: r.createTime,
          update_time: r.updateTime || null,
          synced_at: new Date().toISOString(),
        }));

        for (let i = 0; i < rows.length; i += 50) {
          const batch = rows.slice(i, i + 50);
          const { error } = await supabase.from("reviews").upsert(batch, { onConflict: "review_id" });
          if (error) {
            console.error(`[sync-reviews] Upsert error for ${shop.name}:`, error.message);
            totalErrors++;
          }
        }

        // 悪い口コミアラート
        const badReviews = reviews.filter((r) => {
          const s = (r.starRating || "").toUpperCase();
          return ["ONE", "TWO", "THREE", "ONE_STAR", "TWO_STARS", "THREE_STARS"].includes(s);
        });
        if (badReviews.length > 0) {
          await supabase.from("bad_review_alerts").upsert(
            badReviews.map((r) => ({
              shop_id: shop.id, shop_name: shop.name, review_id: r.reviewId,
              reviewer_name: r.reviewer?.displayName || "匿名",
              star_rating: r.starRating, comment: r.comment || null,
              reply_comment: r.reviewReply?.comment || null,
            })),
            { onConflict: "review_id" }
          ).then(({ error }) => { if (error) console.error("[sync-reviews] Alert error:", error.message); });
        }

        totalSynced += reviews.length;
        results.push({ shopName: shop.name, count: reviews.length, status: "success" });
      } catch (err: any) {
        console.error(`[sync-reviews] Error for ${shop.name}:`, err?.message);
        totalErrors++;
        results.push({ shopName: shop.name, count: 0, status: `error: ${err?.message || ""}` });
      }

      // 複数店舗の場合のみディレイ
      if (shops.length > 1 && si < shops.length - 1) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    return NextResponse.json({
      success: true,
      shops: shops.length,
      totalSynced,
      totalErrors,
      results,
    });
  } catch (e: any) {
    console.error("[sync-reviews] Unhandled error:", e);
    return NextResponse.json({ error: `サーバーエラー: ${e?.message || "不明"}` }, { status: 500 });
  }
}
