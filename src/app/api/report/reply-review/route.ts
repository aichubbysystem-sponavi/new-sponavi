import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { withAudit, requireCtxShopAccess, type AuditContext } from "@/lib/audit";
import { getOAuthToken } from "@/lib/gbp-token";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const GBP_API_BASE = "https://mybusiness.googleapis.com/v4";

/**
 * POST /api/report/reply-review
 * GBP口コミに返信を投稿
 */
export const POST = withAudit("口コミ返信送信", "EXTERNAL_OP", async (_request, ctx) => {
  // 一時無効化: 構造改善完了まで外部GBP操作を停止
  ctx.detail = "機能一時停止中（503）";
  return NextResponse.json({ error: "口コミ返信機能は一時停止中です" }, { status: 503 });
});

async function _POST_disabled(request: NextRequest, ctx: AuditContext) {
  const body = await request.json();
  const { shopId, reviewId, comment } = body as {
    shopId: string;
    reviewId: string;
    comment: string;
  };

  if (!shopId || !reviewId || !comment) {
    return NextResponse.json({ error: "shopId, reviewId, commentが必要です" }, { status: 400 });
  }

  // 認可チェック: shopIdからshop_nameを取得して店舗アクセス権を検証
  const supabaseForAccess = getSupabase();
  const { data: shopForAccess } = await supabaseForAccess.from("shops").select("name").eq("id", shopId).maybeSingle();
  if (shopForAccess?.name) {
    const shopErr = await requireCtxShopAccess(ctx, shopForAccess.name);
    if (shopErr) return shopErr;
  }

  // OAuthトークン取得
  const accessToken = await getOAuthToken();
  if (!accessToken) {
    return NextResponse.json({ error: "OAuthトークンが見つかりません" }, { status: 500 });
  }

  // 店舗のGBPロケーション名を取得
  const supabase = getSupabase();
  const { data: shop } = await supabase
    .from("shops")
    .select("gbp_location_name, name")
    .eq("id", shopId)
    .single();

  if (!shop?.gbp_location_name) {
    return NextResponse.json({ error: "店舗のGBP情報が見つかりません" }, { status: 404 });
  }

  const { resolveLocationName } = await import("@/lib/gbp-location");
  const locationName = await resolveLocationName(shop.gbp_location_name);
  if (!locationName) return NextResponse.json({ error: "GBPロケーション解決失敗" }, { status: 400 });

  ctx.detail = `${shop.name || shopId}: reviewId=${reviewId}「${comment.slice(0, 50)}」`;

  // GBP API v4: PUT {locationName}/reviews/{reviewId}/reply
  const replyUrl = `${GBP_API_BASE}/${locationName}/reviews/${reviewId}/reply`;
  console.log("[reply-review] URL:", replyUrl);

  try {
    const res = await fetch(replyUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ comment }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error(`[reply-review] GBP API error: ${res.status}`, errBody, "URL:", replyUrl);
      return NextResponse.json(
        { error: `GBP返信エラーが発生しました（${res.status}）` },
        { status: 500 }
      );
    }

    const replyData = await res.json();

    // Supabaseの口コミデータも更新
    await supabase
      .from("reviews")
      .update({
        reply_comment: comment,
        reply_time: new Date().toISOString(),
      })
      .eq("review_id", reviewId);

    return NextResponse.json({
      success: true,
      reply: replyData,
    });
  } catch (err: any) {
    console.error("[reply-review] error:", err);
    return NextResponse.json({ error: err?.message || "返信に失敗しました" }, { status: 500 });
  }
}
