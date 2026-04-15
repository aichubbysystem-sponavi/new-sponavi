import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5分

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const GBP_API_BASE = "https://mybusiness.googleapis.com/v4";
const GBP_CLIENT_ID = process.env.GBP_CLIENT_ID || "";
const GBP_CLIENT_SECRET = process.env.GBP_CLIENT_SECRET || "";

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

// OAuthトークンをDBから取得し、期限切れなら自動リフレッシュ
async function getOAuthToken(): Promise<string | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("system_oauth_tokens")
    .select("access_token, refresh_token, expiry")
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    console.error("[sync-reviews] OAuth token fetch error:", error);
    return null;
  }

  // トークンが有効か確認（5分のバッファ）
  const expiry = new Date(data.expiry);
  const now = new Date();
  if (expiry.getTime() - now.getTime() > 5 * 60 * 1000) {
    return data.access_token;
  }

  // 期限切れ → リフレッシュ
  console.log("[sync-reviews] Token expired, refreshing...");
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GBP_CLIENT_ID,
        client_secret: GBP_CLIENT_SECRET,
        refresh_token: data.refresh_token,
        grant_type: "refresh_token",
      }),
    });

    if (!res.ok) {
      console.error("[sync-reviews] Token refresh failed:", res.status, res.statusText);
      return null;
    }

    const tokenData = await res.json();
    const newAccessToken = tokenData.access_token;
    const newExpiry = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString();

    // DBを更新（system.tokensテーブルに直接）
    // ビューは読み取り専用なので、直接REST APIでsystemスキーマにアクセス
    await fetch(
      `${SUPABASE_URL}/rest/v1/tokens?account_id=not.is.null`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY}`,
          "Content-Profile": "system",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          access_token: newAccessToken,
          expiry: newExpiry,
          ...(tokenData.refresh_token ? { refresh_token: tokenData.refresh_token } : {}),
        }),
      }
    );

    console.log("[sync-reviews] Token refreshed successfully");
    return newAccessToken;
  } catch (err) {
    console.error("[sync-reviews] Token refresh error:", err);
    return data.access_token; // フォールバック: 古いトークンを試す
  }
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

  // locationNameを accounts/XXX/locations/YYY 形式に変換
  const parent = locationName.startsWith("accounts/")
    ? locationName
    : `accounts/111148362910776147900/${locationName}`;

  do {
    const params = new URLSearchParams({ orderBy: "updateTime desc", pageSize: "50" });
    if (nextPageToken) params.set("pageToken", nextPageToken);

    const res = await fetch(`${GBP_API_BASE}/${parent}/reviews?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
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
  } while (nextPageToken);

  return { reviews: allReviews, totalCount, avgRating };
}

// POST /api/report/sync-reviews
export async function POST(request: NextRequest) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const shopIds: string[] = body.shopIds || []; // 空なら全店舗

  // OAuthトークン取得
  let accessToken: string | null = null;
  try {
    accessToken = await getOAuthToken();
  } catch (e: any) {
    return NextResponse.json({ error: `OAuthトークン取得エラー: ${e?.message || "不明"}` }, { status: 500 });
  }
  if (!accessToken) {
    return NextResponse.json({ error: "OAuthトークンが見つかりません。GBPアカウント管理からOAuth認証を実行してください。" }, { status: 500 });
  }

  const supabase = getSupabase();
  const GO_API_URL = process.env.NEXT_PUBLIC_API_URL || "";

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

  // Go APIから取れなければSupabaseフォールバック
  if (shops.length === 0) {
    const query = supabase.from("shops").select("id, name, gbp_location_name").not("gbp_location_name", "is", null);
    const { data, error: shopError } = await query;
    if (shopError || !data) {
      return NextResponse.json({ error: `店舗の取得に失敗しました: ${shopError?.message || "不明"}` }, { status: 500 });
    }
    shops = data;
  }

  // shopIds指定がある場合はフィルタ
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

      // 50件ずつバッチupsert
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

      // 悪い口コミ（★3以下）をアラートテーブルに追加
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
    } catch (err) {
      console.error(`[sync-reviews] Error for ${shop.name}:`, err);
      totalErrors++;
      results.push({ shopName: shop.name, count: 0, status: "error" });
    }
  }

  return NextResponse.json({
    success: true,
    shops: shops.length,
    totalSynced,
    totalErrors,
    results,
  });
}
