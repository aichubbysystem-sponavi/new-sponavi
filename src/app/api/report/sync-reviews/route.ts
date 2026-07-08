import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { withAudit, requireCtxShopAccess } from "@/lib/audit";
import { getOAuthToken } from "@/lib/gbp-token";
import { getLocationMap, normName } from "@/lib/gbp-location";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const GBP_API_BASE = "https://mybusiness.googleapis.com/v4";
const GO_API_URL = process.env.NEXT_PUBLIC_API_URL || "";

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
      retries429++;
      if (retries429 >= 2) {
        console.warn(`[sync-reviews] 429 rate limit exceeded for ${fullPath}, skipping`);
        apiError = 429;
        break;
      }
      console.log(`[sync-reviews] Rate limited for ${fullPath}, waiting 5s... (retry ${retries429}/1)`);
      await new Promise(r => setTimeout(r, 5000));
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

export const POST = withAudit("口コミ同期", "DATA_OP", async (request, ctx) => {
  try {
    const body = await request.json().catch(() => ({}));
    const shopIds: string[] = body.shopIds || [];

    // 認可チェック: 指定店舗へのアクセス権を検証
    if (shopIds.length > 0) {
      const sbAccess = getSupabase();
      const { data: shops } = await sbAccess.from("shops").select("name").in("id", shopIds);
      for (const shop of shops || []) {
        const shopErr = await requireCtxShopAccess(ctx, shop.name);
        if (shopErr) return shopErr;
      }
    }

    // 1. 全アカウントのOAuthトークン取得
    const accessToken = await getOAuthToken();
    const allTokens = accessToken ? [accessToken] : [];
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

    // Go APIにgbp_location_nameがない店舗はSupabaseから補完
    const supabaseMain = getSupabase();
    const shopsNeedingGbp = shops.filter(s => !s.gbp_location_name);
    if (shopsNeedingGbp.length > 0) {
      // Supabaseの全GBP紐付け済み店舗を取得（名前の正規化マッチのため全件取得）
      const { data: sbShopsGbp } = await supabaseMain
        .from("shops")
        .select("name, gbp_location_name")
        .not("gbp_location_name", "is", null);
      if (sbShopsGbp && sbShopsGbp.length > 0) {
        // 正規化名 → gbp_location_name のマップ
        const sbGbpByExact = new Map(sbShopsGbp.map(s => [s.name, s.gbp_location_name]));
        const sbGbpByNorm = new Map(sbShopsGbp.map(s => [normName(s.name), s.gbp_location_name]));
        let supplemented = 0;
        for (const shop of shops) {
          if (shop.gbp_location_name) continue;
          // 完全一致 → 正規化マッチの順で試行
          const exact = sbGbpByExact.get(shop.name);
          const norm = !exact ? sbGbpByNorm.get(normName(shop.name)) : undefined;
          if (exact || norm) {
            shop.gbp_location_name = (exact || norm)!;
            supplemented++;
          }
        }
        if (supplemented > 0) {
          console.log(`[sync-reviews] Supplemented gbp_location_name from Supabase for ${supplemented}/${shopsNeedingGbp.length} shops`);
        }
      }
    }

    if (shopIds.length > 0) {
      const idSet = new Set(shopIds);
      // Go API ID または Supabase ID でマッチ
      const { data: sbIdMap } = await supabaseMain
        .from("shops")
        .select("id, name")
        .in("id", shopIds);
      const sbNameSet = new Set((sbIdMap || []).map(s => s.name));
      shops = shops.filter(s => idSet.has(s.id) || sbNameSet.has(s.name));
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

      // gbp_location_nameが空の場合、店舗名でマッチ（完全一致→正規化マッチ）
      if (!fullPath && shop.name) {
        const mapping = locMap.get(shop.name) || locMap.get(normName(shop.name));
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
        let googleTotalCount = 0;
        let googleAvgRating = 0;
        // 最大2トークンまで試行（全トークン試すと遅すぎるため）
        const maxTokenTries = Math.min(allTokens.length, 2);
        for (let ti = 0; ti < maxTokenTries; ti++) {
          const result = await fetchReviews(fullPath, allTokens[ti]);
          if (result.reviews.length > 0) {
            reviews = result.reviews;
            googleTotalCount = result.totalCount;
            googleAvgRating = result.avgRating;
            apiError = undefined;
            break;
          }
          apiError = result.apiError;
          // 401/403はトークン問題→次トークン、429は即中断
          if (result.apiError === 429) break;
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

        // Google公式評価 + GBPフルパスをshopsテーブルに永続保存
        {
          const updateData: any = {};
          if (googleAvgRating > 0) updateData.rating = googleAvgRating;
          if (googleTotalCount > 0) updateData.review_count = googleTotalCount;
          // fullPathを永続保存（OAuthが切れても二度と失われない）
          if (fullPath) {
            updateData.gbp_full_path = fullPath;
            // gbp_location_nameも保存（locationsパート）
            const locPart = fullPath.match(/(locations\/[^/]+)/)?.[1] || "";
            if (locPart) updateData.gbp_location_name = locPart;
          }
          if (Object.keys(updateData).length > 0) {
            await supabase.from("shops").update(updateData).eq("name", shop.name);
          }
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

    ctx.detail = `対象${shops.length}店舗: 同期${totalSynced}件, エラー${totalErrors}件`;
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
});
