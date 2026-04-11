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

  const expiry = new Date(data.expiry);
  if (expiry.getTime() - Date.now() > 5 * 60 * 1000) return data.access_token;

  // リフレッシュ
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
    if (!res.ok) return data.access_token;
    const tokenData = await res.json();
    await getSupabase()
      .from("system_oauth_tokens")
      .update({
        access_token: tokenData.access_token,
        expiry: new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString(),
      })
      .not("account_id", "is", null);
    return tokenData.access_token;
  } catch {
    return data.access_token;
  }
}

/**
 * POST /api/report/reply-review
 * GBP口コミに返信を投稿
 */
export async function POST(request: NextRequest) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = await request.json();
  const { shopId, reviewId, comment } = body as {
    shopId: string;
    reviewId: string;
    comment: string;
  };

  if (!shopId || !reviewId || !comment) {
    return NextResponse.json({ error: "shopId, reviewId, commentが必要です" }, { status: 400 });
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

  // locationNameを accounts/XXX/locations/YYY 形式に正規化
  const locationName = shop.gbp_location_name.startsWith("accounts/")
    ? shop.gbp_location_name
    : `accounts/111148362910776147900/${shop.gbp_location_name}`;

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
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error(`[reply-review] GBP API error: ${res.status}`, errBody, "URL:", replyUrl);
      return NextResponse.json(
        { error: `GBP返信エラー (${res.status}): ${errBody.slice(0, 300)}`, url: replyUrl },
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
