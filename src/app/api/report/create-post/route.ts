import { NextRequest, NextResponse } from "next/server";
import { getSupabase, requireRole, verifyShopAccess } from "@/lib/supabase";
import { getOAuthToken } from "@/lib/gbp-token";

export const dynamic = "force-dynamic";

const GBP_API_BASE = "https://mybusiness.googleapis.com/v4";

/**
 * POST /api/report/create-post
 * GBP投稿を作成（写真対応）
 */
export async function POST(request: NextRequest) {
  // 投稿作成は社長・マネージャーのみ
  const r = await requireRole(request, ["president", "manager"]);
  if (r.error) return r.error;

  const body = await request.json();
  const { shopId, summary, topicType, callToAction, photoUrl } = body as {
    shopId: string;
    summary: string;
    topicType?: string;
    callToAction?: { actionType: string; url: string };
    photoUrl?: string;
  };

  if (!shopId || !summary) {
    return NextResponse.json({ error: "shopIdとsummaryが必要です" }, { status: 400 });
  }

  // 認可チェック: shopIdからshop_nameを取得して店舗アクセス権を検証
  const sbAccess = getSupabase();
  const { data: shopAccess } = await sbAccess.from("shops").select("name").eq("id", shopId).maybeSingle();
  if (shopAccess?.name) {
    const hasAccess = await verifyShopAccess(r.sub, shopAccess.name);
    if (!hasAccess) return NextResponse.json({ error: "この店舗へのアクセス権がありません" }, { status: 403 });
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

  const { resolveLocationName } = await import("@/lib/gbp-location");
  const locationName = await resolveLocationName(shop.gbp_location_name);
  if (!locationName) return NextResponse.json({ error: "GBPロケーション解決失敗" }, { status: 400 });

  // GBP投稿ボディ構築
  const postBody: any = {
    summary,
    topicType: topicType || "STANDARD",
    languageCode: "ja",
  };

  if (callToAction?.actionType && callToAction?.url) {
    postBody.callToAction = callToAction;
  }

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
    let fixedUrl = photoUrl;
    if (fixedUrl.includes("dropbox.com")) {
      fixedUrl = fixedUrl.replace("www.dropbox.com", "dl.dropboxusercontent.com");
      fixedUrl = fixedUrl.replace(/[&?]dl=\d/g, "").replace(/[&?]st=[^&]*/g, "").replace(/[?&]$/, "");
    }
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
}
