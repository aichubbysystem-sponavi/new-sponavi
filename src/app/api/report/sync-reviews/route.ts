import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5分

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const GBP_API_BASE = "https://mybusiness.googleapis.com/v4";

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

// OAuthトークンをDBから取得（public.system_oauth_tokens ビュー経由）
async function getOAuthToken(): Promise<string | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("system_oauth_tokens")
    .select("access_token")
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    console.error("[sync-reviews] OAuth token fetch error:", error);
    return null;
  }
  return data.access_token || null;
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
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const shopIds: string[] = body.shopIds || []; // 空なら全店舗

  // OAuthトークン取得
  const accessToken = await getOAuthToken();
  if (!accessToken) {
    return NextResponse.json({ error: "OAuthトークンが見つかりません。OAuth認証を実行してください。" }, { status: 500 });
  }

  const supabase = getSupabase();

  // 店舗一覧取得
  let query = supabase.from("shops").select("id, name, gbp_location_name").not("gbp_location_name", "is", null);
  if (shopIds.length > 0) {
    query = query.in("id", shopIds);
  }
  const { data: shops, error: shopError } = await query;

  if (shopError || !shops) {
    return NextResponse.json({ error: "店舗の取得に失敗しました" }, { status: 500 });
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
