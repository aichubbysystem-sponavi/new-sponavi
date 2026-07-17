import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { withAudit, requireCtxShopAccess } from "@/lib/audit";
import { getOAuthToken } from "@/lib/gbp-token";

export const dynamic = "force-dynamic";

const GBP_API_BASE = "https://mybusiness.googleapis.com/v4";

/**
 * POST /api/report/create-post
 * GBP投稿を作成（写真対応）
 */
export const POST = withAudit("GBP投稿作成", "EXTERNAL_OP", async (request, ctx) => {
  const body = await request.json();
  const { shopId, summary, topicType, callToAction, photoUrl } = body as {
    shopId: string;
    summary: string;
    topicType?: string;
    callToAction?: { actionType: string; url: string };
    photoUrl?: string;
  };

  // 写真投稿（topicType=PHOTO）は本文不要・写真URL必須（Media APIで「写真と動画」に投稿する）
  const isPhotoPost = topicType === "PHOTO";
  if (!shopId || (!summary && !isPhotoPost)) {
    return NextResponse.json({ error: "shopIdとsummaryが必要です" }, { status: 400 });
  }
  if (isPhotoPost && !photoUrl) {
    return NextResponse.json({ error: "写真投稿にはphotoUrlが必要です" }, { status: 400 });
  }

  // 認可チェック: shopIdからshop_nameを取得して店舗アクセス権を検証
  const sbAccess = getSupabase();
  const { data: shopAccess } = await sbAccess.from("shops").select("name").eq("id", shopId).maybeSingle();
  if (shopAccess?.name) {
    const shopErr = await requireCtxShopAccess(ctx, shopAccess.name);
    if (shopErr) return shopErr;
  }

  const accessToken = await getOAuthToken();
  if (!accessToken) {
    return NextResponse.json({ error: "OAuthトークンが見つかりません" }, { status: 500 });
  }

  const supabase = getSupabase();
  const { data: shop } = await supabase
    .from("shops")
    .select("gbp_location_name, name")
    .eq("id", shopId)
    .single();

  if (!shop?.gbp_location_name) {
    return NextResponse.json({ error: "店舗のGBP情報が見つかりません" }, { status: 404 });
  }

  ctx.detail = `${shop.name || shopId}: ${isPhotoPost ? "写真投稿" : `「${(summary || "").slice(0, 50)}」${photoUrl ? "（写真あり）" : ""}`}`;

  const { resolveLocationName } = await import("@/lib/gbp-location");
  const locationName = await resolveLocationName(shop.gbp_location_name);
  if (!locationName) return NextResponse.json({ error: "GBPロケーション解決失敗" }, { status: 400 });

  // 写真URLの検証とDropbox直リンク変換（写真あり通常投稿・写真のみ投稿で共用）
  let fixedUrl: string | null = null;
  if (photoUrl) {
    // URLバリデーション（SSRF防止: httpsのみ、許可ドメインのみ）
    try {
      const parsed = new URL(photoUrl);
      const allowedHosts = ["dropbox.com", "www.dropbox.com", "dl.dropboxusercontent.com", "lh3.googleusercontent.com"];
      if (parsed.protocol !== "https:" || !allowedHosts.some(h => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`))) {
        return NextResponse.json({ error: "許可されていないURL形式です" }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: "無効なURLです" }, { status: 400 });
    }

    // Dropbox URLを直接ダウンロードURLに変換
    fixedUrl = photoUrl;
    if (fixedUrl.includes("dropbox.com")) {
      fixedUrl = fixedUrl.replace("www.dropbox.com", "dl.dropboxusercontent.com");
      fixedUrl = fixedUrl.replace(/[&?]dl=\d/g, "").replace(/[&?]st=[^&]*/g, "").replace(/[?&]$/, "");
    }
  }

  // 写真のみ投稿: localPostsではなくMedia APIで「写真と動画」セクションにアップロード
  if (isPhotoPost) {
    try {
      const res = await fetch(`${GBP_API_BASE}/${locationName}/media`, {
        cache: "no-store" as const,
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ mediaFormat: "PHOTO", sourceUrl: fixedUrl, locationAssociation: { category: "ADDITIONAL" } }),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        console.error(`[create-post] GBP Media API error: ${res.status}`, errBody);
        return NextResponse.json({ error: `GBP写真投稿エラーが発生しました（${res.status}）` }, { status: 500 });
      }
      const result = await res.json().catch(() => ({}));
      try {
        await supabase.from("post_logs").insert({
          id: crypto.randomUUID(),
          shop_id: shopId,
          shop_name: shop.name || "",
          summary: "",
          topic_type: "PHOTO",
          media_url: photoUrl,
          gbp_post_name: result.name || null,
        });
      } catch {}
      return NextResponse.json({ success: true, media: result });
    } catch {
      return NextResponse.json({ error: "写真投稿に失敗しました" }, { status: 500 });
    }
  }

  // GBP投稿ボディ構築
  const postBody: any = {
    summary,
    topicType: topicType || "STANDARD",
    languageCode: "ja",
  };

  if (callToAction?.actionType && callToAction?.url) {
    postBody.callToAction = callToAction;
  }

  if (fixedUrl) {
    postBody.media = [{ mediaFormat: "PHOTO", sourceUrl: fixedUrl }];
  }

  try {
    const res = await fetch(`${GBP_API_BASE}/${locationName}/localPosts`, {
      cache: "no-store" as const,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(postBody),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error(`[create-post] GBP API error: ${res.status}`, errBody);
      return NextResponse.json({ error: `GBP投稿エラーが発生しました（${res.status}）` }, { status: 500 });
    }

    const result = await res.json();

    // 投稿ログをSupabaseに保存（searchUrl含む）
    try {
      await supabase.from("post_logs").insert({
        id: crypto.randomUUID(),
        shop_id: shopId,
        shop_name: shop.name || "",
        summary,
        topic_type: topicType || "STANDARD",
        media_url: photoUrl || null,
        action_type: callToAction?.actionType || null,
        action_url: callToAction?.url || null,
        search_url: result.searchUrl || null,
        gbp_post_name: result.name || null,
      });
    } catch {}

    return NextResponse.json({ success: true, post: result });
  } catch {
    return NextResponse.json({ error: "投稿に失敗しました" }, { status: 500 });
  }
});
