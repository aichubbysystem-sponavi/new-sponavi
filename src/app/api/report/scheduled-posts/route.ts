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

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
}

async function getOAuthToken(): Promise<string | null> {
  const supabase = getSupabase();
  const { data } = await supabase.from("system_oauth_tokens")
    .select("access_token, refresh_token, expiry").limit(1).maybeSingle();
  if (!data) return null;
  if (new Date(data.expiry).getTime() - Date.now() > 5 * 60 * 1000) return data.access_token;
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: GBP_CLIENT_ID, client_secret: GBP_CLIENT_SECRET,
        refresh_token: data.refresh_token, grant_type: "refresh_token" }),
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
 * GET /api/report/scheduled-posts?shopId=xxx
 * 予約投稿一覧を取得
 */
export async function GET(request: NextRequest) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  const shopId = request.nextUrl.searchParams.get("shopId");
  const supabase = getSupabase();
  let query = supabase.from("scheduled_posts").select("*").order("scheduled_at", { ascending: true });
  if (shopId) query = query.eq("shop_id", shopId);
  const { data } = await query;
  return NextResponse.json(data || []);
}

/**
 * POST /api/report/scheduled-posts
 * 予約投稿を登録
 */
export async function POST(request: NextRequest) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const body = await request.json();
  const { shopId, summary, topicType, photoUrl, actionType, actionUrl, scheduledAt } = body;

  if (!shopId || !summary || !scheduledAt) {
    return NextResponse.json({ error: "shopId, summary, scheduledAtが必要です" }, { status: 400 });
  }

  const supabase = getSupabase();
  const { data: shop } = await supabase.from("shops").select("name").eq("id", shopId).single();

  const { error } = await supabase.from("scheduled_posts").insert({
    id: crypto.randomUUID(),
    shop_id: shopId,
    shop_name: shop?.name || "",
    summary,
    topic_type: topicType || "STANDARD",
    photo_url: photoUrl || null,
    action_type: actionType || null,
    action_url: actionUrl || null,
    scheduled_at: scheduledAt,
    status: "pending",
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

/**
 * DELETE /api/report/scheduled-posts
 * 予約投稿を削除
 */
export async function DELETE(request: NextRequest) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: "idが必要です" }, { status: 400 });
  const supabase = getSupabase();
  await supabase.from("scheduled_posts").delete().eq("id", id);
  return NextResponse.json({ success: true });
}

/**
 * PUT /api/report/scheduled-posts
 * 予約投稿を実行（cronから呼ばれる or 手動実行）
 */
export async function PUT(request: NextRequest) {
  const supabase = getSupabase();
  const now = new Date().toISOString();

  // 実行予定時刻を過ぎた未実行の投稿を取得
  const { data: posts } = await supabase.from("scheduled_posts")
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_at", now);

  if (!posts || posts.length === 0) {
    return NextResponse.json({ message: "実行対象なし", executed: 0 });
  }

  const accessToken = await getOAuthToken();
  if (!accessToken) {
    return NextResponse.json({ error: "OAuthトークンなし" }, { status: 500 });
  }

  let executed = 0;
  let errors = 0;

  for (const post of posts) {
    const { data: shop } = await supabase.from("shops")
      .select("gbp_location_name").eq("id", post.shop_id).single();

    if (!shop?.gbp_location_name) {
      await supabase.from("scheduled_posts").update({ status: "error", error_detail: "GBP未接続" }).eq("id", post.id);
      errors++;
      continue;
    }

    const { resolveLocationName } = await import("@/lib/gbp-location");
    const locationName = await resolveLocationName(shop.gbp_location_name);
    if (!locationName) { errors++; continue; }

    const postBody: any = { summary: post.summary, topicType: post.topic_type, languageCode: "ja" };
    if (post.action_type && post.action_url) {
      postBody.callToAction = { actionType: post.action_type, url: post.action_url };
    }
    if (post.photo_url) {
      let url = post.photo_url;
      if (url.includes("dropbox.com")) url = url.replace("dl=0", "raw=1");
      postBody.media = [{ mediaFormat: "PHOTO", sourceUrl: url }];
    }

    try {
      const res = await fetch(`${GBP_API_BASE}/${locationName}/localPosts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(postBody),
      });

      if (res.ok) {
        const result = await res.json();
        await supabase.from("scheduled_posts").update({
          status: "published",
          published_at: new Date().toISOString(),
          search_url: result.searchUrl || null,
        }).eq("id", post.id);

        // post_logsにも記録
        await supabase.from("post_logs").insert({
          id: crypto.randomUUID(),
          shop_id: post.shop_id,
          shop_name: post.shop_name,
          summary: post.summary,
          topic_type: post.topic_type,
          media_url: post.photo_url,
          action_type: post.action_type,
          action_url: post.action_url,
          search_url: result.searchUrl || null,
        });

        executed++;
      } else {
        const err = await res.text().catch(() => "");
        await supabase.from("scheduled_posts").update({ status: "error", error_detail: `API ${res.status}: ${err.slice(0, 100)}` }).eq("id", post.id);
        errors++;
      }
    } catch (e: any) {
      await supabase.from("scheduled_posts").update({ status: "error", error_detail: e?.message || "不明" }).eq("id", post.id);
      errors++;
    }
  }

  return NextResponse.json({ executed, errors, total: posts.length });
}
