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
// トークン管理: PostgreSQL直接接続 + Go APIリフレッシュ連携
// ============================================================

interface AccountToken {
  accountId: string; // Google OAuth account UUID
  email: string;
  accessToken: string;
  refreshToken: string;
  expiry: string;
}

/**
 * Go APIのDBからOAuthトークンを直接取得（PostgreSQL接続）
 */
async function getAllTokensFromDB(): Promise<AccountToken[]> {
  // 方法1: Supabase REST API (system schema)
  try {
    const key = SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY;
    if (key) {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/tokens?select=account_id,access_token,refresh_token,expiry&order=expiry.desc`,
        {
          headers: { apikey: key, Authorization: `Bearer ${key}`, "Accept-Profile": "system" },
          signal: AbortSignal.timeout(5000),
        }
      );
      if (res.ok) {
        const rows = await res.json();
        if (Array.isArray(rows) && rows.length > 0 && rows[0].access_token) {
          console.log("[sync-reviews] Got tokens from system.tokens:", rows.length);
          return rows.map((r: any) => ({
            accountId: r.account_id || "",
            email: "",
            accessToken: r.access_token,
            refreshToken: r.refresh_token || "",
            expiry: r.expiry || "",
          }));
        }
      }
    }
  } catch (e: any) {
    console.log("[sync-reviews] system.tokens not accessible:", e?.message);
  }

  // 方法2: Supabase client (system_oauth_tokens view)
  try {
    const supabase = getSupabase();
    const { data } = await supabase
      .from("system_oauth_tokens")
      .select("account_id, access_token, refresh_token, expiry")
      .order("expiry", { ascending: false });
    if (data && data.length > 0) {
      console.log("[sync-reviews] Got tokens from system_oauth_tokens:", data.length);
      return data.map((r: any) => ({
        accountId: r.account_id || "",
        email: "",
        accessToken: r.access_token,
        refreshToken: r.refresh_token || "",
        expiry: r.expiry || "",
      }));
    }
  } catch (e: any) {
    console.log("[sync-reviews] system_oauth_tokens not accessible:", e?.message);
  }

  // 方法3: PostgreSQL直接接続
  try {
    if (DB_PASSWORD && SUPABASE_PROJECT_ID) {
      const { Client } = await import("pg");
      const client = new Client({
        host: `db.${SUPABASE_PROJECT_ID}.supabase.co`,
        port: 5432,
        database: "postgres",
        user: "postgres",
        password: DB_PASSWORD,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 10000,
      });
      await client.connect();
      const result = await client.query(
        "SELECT account_id, access_token, refresh_token, expiry FROM system.tokens ORDER BY expiry DESC"
      );
      await client.end();
      if (result.rows.length > 0) {
        console.log("[sync-reviews] Got tokens from PostgreSQL direct:", result.rows.length);
        return result.rows.map((r: any) => ({
          accountId: r.account_id || "",
          email: "",
          accessToken: r.access_token,
          refreshToken: r.refresh_token || "",
          expiry: r.expiry?.toISOString?.() || r.expiry || "",
        }));
      }
    }
  } catch (e: any) {
    console.log("[sync-reviews] PostgreSQL direct not accessible:", e?.message);
  }

  return [];
}

/**
 * トークンをリフレッシュ
 */
async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiry: string } | null> {
  if (!refreshToken || !GBP_CLIENT_ID || !GBP_CLIENT_SECRET) return null;
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GBP_CLIENT_ID,
        client_secret: GBP_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (res.ok) {
      const data = await res.json();
      return {
        accessToken: data.access_token,
        expiry: new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString(),
      };
    }
  } catch {}
  return null;
}

/**
 * 有効なトークンを1つ取得（リフレッシュ付き）
 */
async function getValidToken(): Promise<string | null> {
  // まずGo APIにGBP APIを叩かせてトークンリフレッシュを発火
  try {
    await fetch(`${GO_API_URL}/api/gbp/account`, { signal: AbortSignal.timeout(15000) });
  } catch {}

  const tokens = await getAllTokensFromDB();
  if (tokens.length === 0) {
    // DBから取れない場合、Go APIに直接リフレッシュさせた後のフォールバック
    console.log("[sync-reviews] No tokens found in DB, trying direct refresh...");
    return null;
  }

  const now = Date.now();
  // 有効なトークンを探す
  for (const t of tokens) {
    if (new Date(t.expiry).getTime() - now > 60 * 1000) {
      return t.accessToken;
    }
  }

  // 全て期限切れ → リフレッシュ
  for (const t of tokens) {
    if (t.refreshToken) {
      const refreshed = await refreshAccessToken(t.refreshToken);
      if (refreshed) {
        console.log("[sync-reviews] Token refreshed successfully");
        return refreshed.accessToken;
      }
    }
  }

  // 最後の手段: 古くても使ってみる
  return tokens[0]?.accessToken || null;
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
): Promise<{ reviews: GBPReview[]; totalCount: number; avgRating: number }> {
  const allReviews: GBPReview[] = [];
  let nextPageToken: string | undefined;
  let totalCount = 0;
  let avgRating = 0;
  let pageCount = 0;

  do {
    const params = new URLSearchParams({ orderBy: "updateTime desc", pageSize: "50" });
    if (nextPageToken) params.set("pageToken", nextPageToken);

    const res = await fetch(`${GBP_API_BASE}/${fullPath}/reviews?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15000),
    });

    if (res.status === 429) {
      console.log(`[sync-reviews] Rate limited for ${fullPath}, waiting 10s...`);
      await new Promise(r => setTimeout(r, 10000));
      continue;
    }

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      console.error(`[sync-reviews] GBP API error for ${fullPath}:`, res.status, err.slice(0, 200));
      break;
    }

    const data = await res.json();
    if (data.reviews) allReviews.push(...data.reviews);
    if (data.totalReviewCount) totalCount = data.totalReviewCount;
    if (data.averageRating) avgRating = data.averageRating;
    nextPageToken = data.nextPageToken;
    pageCount++;
  } while (nextPageToken && pageCount < 20);

  return { reviews: allReviews, totalCount, avgRating };
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

    // 1. OAuthトークン取得
    const accessToken = await getValidToken();
    if (!accessToken) {
      return NextResponse.json({
        error: "OAuthトークンが取得できません。GBPアカウント管理からGoogleアカウントを再認証してください。",
        debug: {
          supabaseUrl: SUPABASE_URL ? "設定済み" : "未設定",
          serviceKey: SUPABASE_SERVICE_KEY ? "設定済み" : "未設定",
          dbPassword: DB_PASSWORD ? "設定済み" : "未設定",
          projectId: SUPABASE_PROJECT_ID || "不明",
        },
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
        results.push({ shopName: shop.name, count: 0, status: "no_gbp_location" });
        continue;
      }

      try {
        const { reviews } = await fetchReviews(fullPath, accessToken);

        if (reviews.length === 0) {
          results.push({ shopName: shop.name, count: 0, status: "no_reviews" });
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
