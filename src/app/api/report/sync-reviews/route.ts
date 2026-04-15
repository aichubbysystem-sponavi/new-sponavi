import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Vercel Pro: 5分

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const GBP_API_BASE = "https://mybusiness.googleapis.com/v4";
const GBP_CLIENT_ID = process.env.GBP_CLIENT_ID || "";
const GBP_CLIENT_SECRET = process.env.GBP_CLIENT_SECRET || "";
const GO_API_URL = process.env.NEXT_PUBLIC_API_URL || "";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
}

interface GBPReview {
  name: string;
  reviewId: string;
  reviewer: { displayName: string; profilePhotoUrl?: string; isAnonymous?: boolean };
  starRating: string;
  comment?: string;
  createTime: string;
  updateTime?: string;
  reviewReply?: { comment: string; updateTime?: string };
}

interface ReviewsResponse {
  reviews?: GBPReview[];
  averageRating?: number;
  totalReviewCount?: number;
  nextPageToken?: string;
}

// OAuthトークンを取得
// Go APIが自動リフレッシュを管理しているので、Go APIにGBP APIを叩かせてトークンを最新化し、
// その後Go APIのアカウント情報からトークンを間接取得する
async function getOAuthToken(): Promise<string | null> {
  // 1. まずGo APIにGBP APIを叩かせてトークンを自動リフレッシュさせる
  try {
    await fetch(`${GO_API_URL}/api/gbp/account`, {
      signal: AbortSignal.timeout(15000),
    });
    console.log("[sync-reviews] Go API GBP call triggered token refresh");
  } catch {}

  // 2. Supabase system_oauth_tokens からリフレッシュ済みトークンを取得
  try {
    const supabase = getSupabase();
    const { data } = await supabase
      .from("system_oauth_tokens")
      .select("access_token, refresh_token, expiry")
      .order("expiry", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.access_token) {
      console.log("[sync-reviews] Got token from system_oauth_tokens, expiry:", data.expiry);
      return data.access_token;
    }
  } catch (e: any) {
    console.log("[sync-reviews] system_oauth_tokens not accessible:", e?.message);
  }

  // 3. Supabase REST API で system.tokens テーブルから取得
  try {
    const key = SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY;
    if (key) {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/tokens?select=access_token,refresh_token,expiry&order=expiry.desc&limit=1`,
        {
          headers: { apikey: key, Authorization: `Bearer ${key}`, "Accept-Profile": "system" },
          signal: AbortSignal.timeout(5000),
        }
      );
      if (res.ok) {
        const rows = await res.json();
        if (Array.isArray(rows) && rows.length > 0 && rows[0].access_token) {
          console.log("[sync-reviews] Got token from system.tokens");
          return rows[0].access_token;
        }
      }
    }
  } catch (e: any) {
    console.log("[sync-reviews] system.tokens not accessible:", e?.message);
  }

  // 4. public.tokens からフォールバック
  try {
    const key = SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY;
    if (key) {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/tokens?select=access_token,refresh_token,expiry&order=expiry.desc&limit=1`,
        {
          headers: { apikey: key, Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(5000),
        }
      );
      if (res.ok) {
        const rows = await res.json();
        if (Array.isArray(rows) && rows.length > 0 && rows[0].access_token) {
          console.log("[sync-reviews] Got token from public.tokens");
          return rows[0].access_token;
        }
      }
    }
  } catch {}

  // 5. 最終手段: GBP_CLIENT_ID/SECRETで直接リフレッシュ
  try {
    const supabase = getSupabase();
    // refresh_tokenだけでも取得できないか試行
    const { data } = await supabase
      .from("system_oauth_tokens")
      .select("refresh_token")
      .limit(1)
      .maybeSingle();
    if (data?.refresh_token && GBP_CLIENT_ID && GBP_CLIENT_SECRET) {
      const refreshed = await refreshToken(data.refresh_token);
      if (refreshed) return refreshed;
    }
  } catch {}

  return null;
}

async function refreshToken(refreshTokenStr: string): Promise<string | null> {
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GBP_CLIENT_ID,
        client_secret: GBP_CLIENT_SECRET,
        refresh_token: refreshTokenStr,
        grant_type: "refresh_token",
      }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.access_token || null;
    }
  } catch {}
  return null;
}

// GBP Reviews APIからページネーション付きで全件取得
async function fetchAllReviews(
  locationName: string,
  accessToken: string
): Promise<{ reviews: GBPReview[]; totalCount: number; avgRating: number }> {
  const allReviews: GBPReview[] = [];
  let nextPageToken: string | undefined;
  let totalCount = 0;
  let avgRating = 0;
  let pageCount = 0;
  const MAX_PAGES = 20; // 1000件まで

  const parent = locationName.startsWith("accounts/")
    ? locationName
    : `accounts/111148362910776147900/${locationName}`;

  do {
    const params = new URLSearchParams({ orderBy: "updateTime desc", pageSize: "50" });
    if (nextPageToken) params.set("pageToken", nextPageToken);

    const res = await fetch(`${GBP_API_BASE}/${parent}/reviews?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`[sync-reviews] GBP API error for ${parent}:`, res.status, err);
      break;
    }

    const data: ReviewsResponse = await res.json();
    if (data.reviews) allReviews.push(...data.reviews);
    if (data.totalReviewCount) totalCount = data.totalReviewCount;
    if (data.averageRating) avgRating = data.averageRating;
    nextPageToken = data.nextPageToken;
    pageCount++;
  } while (nextPageToken && pageCount < MAX_PAGES);

  return { reviews: allReviews, totalCount, avgRating };
}

// POST /api/report/sync-reviews
export async function POST(request: NextRequest) {
  try {
    const { verifyAuth } = await import("@/lib/auth-verify");
    const auth = await verifyAuth(request.headers.get("authorization"));
    if (!auth.valid) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const shopIds: string[] = body.shopIds || [];

    // OAuthトークン取得
    let accessToken: string | null = null;
    try {
      accessToken = await getOAuthToken();
    } catch (e: any) {
      return NextResponse.json({ error: `OAuthトークン取得エラー: ${e?.message || "不明"}` }, { status: 500 });
    }
    if (!accessToken) {
      return NextResponse.json({
        error: "OAuthトークンが見つかりません。Supabaseのsystem_oauth_tokensテーブルにトークンが存在するか確認してください。",
        debug: {
          supabaseUrl: SUPABASE_URL ? "設定済み" : "未設定",
          serviceKey: SUPABASE_SERVICE_KEY ? "設定済み" : "未設定",
          anonKey: SUPABASE_ANON_KEY ? "設定済み" : "未設定",
          goApiUrl: GO_API_URL ? "設定済み" : "未設定",
          clientId: GBP_CLIENT_ID ? "設定済み" : "未設定",
        },
      }, { status: 500 });
    }

    const supabase = getSupabase();

    // 店舗一覧取得（Go API → Supabaseフォールバック）
    let shops: { id: string; name: string; gbp_location_name: string }[] = [];
    try {
      const goRes = await fetch(`${GO_API_URL}/api/shop`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15000),
      });
      if (goRes.ok) {
        const goData = await goRes.json();
        shops = (Array.isArray(goData) ? goData : [])
          .filter((s: any) => s.gbp_location_name)
          .map((s: any) => ({
            id: s.id || s.ID,
            name: s.name || s.Name,
            gbp_location_name: s.gbp_location_name || s.GbpLocationName,
          }));
      }
    } catch {}

    if (shops.length === 0) {
      const { data, error: shopError } = await supabase
        .from("shops").select("id, name, gbp_location_name").not("gbp_location_name", "is", null);
      if (shopError || !data) {
        return NextResponse.json({ error: `店舗の取得に失敗しました: ${shopError?.message || "Go API/Supabase両方失敗"}` }, { status: 500 });
      }
      shops = data;
    }

    if (shopIds.length > 0) {
      const idSet = new Set(shopIds);
      shops = shops.filter(s => idSet.has(s.id));
    }

    if (shops.length === 0) {
      return NextResponse.json({ error: "対象店舗が見つかりません" }, { status: 400 });
    }

    let totalSynced = 0;
    let totalErrors = 0;
    const results: { shopName: string; count: number; status: string }[] = [];

    for (const shop of shops) {
      if (!shop.gbp_location_name) continue;

      try {
        const { reviews } = await fetchAllReviews(shop.gbp_location_name, accessToken);

        if (reviews.length === 0) {
          results.push({ shopName: shop.name, count: 0, status: "no_reviews" });
          continue;
        }

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
          const { error } = await supabase
            .from("reviews")
            .upsert(batch, { onConflict: "review_id" });
          if (error) {
            console.error(`[sync-reviews] Upsert error for ${shop.name}:`, error);
            totalErrors++;
          }
        }

        const badReviews = reviews.filter((r) => {
          const s = (r.starRating || "").toUpperCase();
          return s === "ONE" || s === "TWO" || s === "THREE" || s === "ONE_STAR" || s === "TWO_STARS" || s === "THREE_STARS";
        });
        if (badReviews.length > 0) {
          const alerts = badReviews.map((r) => ({
            shop_id: shop.id,
            shop_name: shop.name,
            review_id: r.reviewId,
            reviewer_name: r.reviewer?.displayName || "匿名",
            star_rating: r.starRating,
            comment: r.comment || null,
            reply_comment: r.reviewReply?.comment || null,
          }));
          await supabase
            .from("bad_review_alerts")
            .upsert(alerts, { onConflict: "review_id" })
            .then(({ error }) => { if (error) console.error("[sync-reviews] Alert upsert error:", error); });
        }

        totalSynced += reviews.length;
        results.push({ shopName: shop.name, count: reviews.length, status: "success" });
      } catch (err: any) {
        console.error(`[sync-reviews] Error for ${shop.name}:`, err);
        totalErrors++;
        results.push({ shopName: shop.name, count: 0, status: `error: ${err?.message || ""}` });
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
    return NextResponse.json({ error: `サーバーエラー: ${e?.message || "不明なエラー"}` }, { status: 500 });
  }
}
