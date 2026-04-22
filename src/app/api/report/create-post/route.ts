import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const GBP_API_BASE = "https://mybusiness.googleapis.com/v4";
const GBP_CLIENT_ID = process.env.GBP_CLIENT_ID || "";
const GBP_CLIENT_SECRET = process.env.GBP_CLIENT_SECRET || "";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
}

async function getOAuthToken(): Promise<string | null> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("system_oauth_tokens")
    .select("access_token, refresh_token, expiry")
    .limit(1)
    .maybeSingle();
  if (!data) return null;

  if (new Date(data.expiry).getTime() - Date.now() > 5 * 60 * 1000) return data.access_token;

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GBP_CLIENT_ID, client_secret: GBP_CLIENT_SECRET,
        refresh_token: data.refresh_token, grant_type: "refresh_token",
      }),
    });
    if (!res.ok) return data.access_token;
    const t = await res.json();
    await getSupabase().from("system_oauth_tokens").update({
      access_token: t.access_token,
      expiry: new Date(Date.now() + (t.expires_in || 3600) * 1000).toISOString(),
    }).not("account_id", "is", null);
    return t.access_token;
  } catch { return data.access_token; }
}

/**
 * POST /api/report/create-post
 * GBP投稿を作成（写真対応）
 */
export async function POST(request: NextRequest) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

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
      return NextResponse.json({ error: `GBP投稿エラー (${res.status}): ${errBody.slice(0, 200)}` }, { status: 500 });
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
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "投稿に失敗しました" }, { status: 500 });
  }
}
