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
 * GET /api/cron/execute-posts
 * 予約投稿の自動実行: scheduled_postsテーブルのpending投稿をGBPに投稿
 * 毎時0分に実行
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();
  const now = new Date().toISOString();

  // scheduled_atが現在時刻以前のpending投稿を取得
  const { data: posts, error: fetchErr } = await supabase
    .from("scheduled_posts")
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_at", now)
    .order("scheduled_at", { ascending: true })
    .limit(10); // Vercel Hobby 60秒制限: 1投稿約5秒 → 最大10件/実行

  if (fetchErr || !posts || posts.length === 0) {
    return NextResponse.json({ success: true, message: "実行対象なし", count: 0 });
  }

  const accessToken = await getOAuthToken();
  if (!accessToken) {
    return NextResponse.json({ error: "OAuthトークンなし" }, { status: 500 });
  }

  // 店舗情報を取得
  const shopIds = Array.from(new Set(posts.map(p => p.shop_id)));
  const { data: shops } = await supabase
    .from("shops")
    .select("id, name, gbp_location_name")
    .in("id", shopIds);

  const shopMap = new Map((shops || []).map(s => [s.id, s]));
  let posted = 0;
  let errors = 0;

  for (const post of posts) {
    const shop = shopMap.get(post.shop_id);
    if (!shop || !shop.gbp_location_name) {
      await supabase.from("scheduled_posts").update({ status: "error" }).eq("id", post.id);
      errors++;
      continue;
    }

    const locationName = shop.gbp_location_name.startsWith("accounts/")
      ? shop.gbp_location_name
      : `accounts/111148362910776147900/${shop.gbp_location_name}`;

    const postBody: any = {
      summary: (post.summary || "").slice(0, 1500),
      topicType: post.topic_type || "STANDARD",
      languageCode: "ja",
    };
    if (post.media_url) {
      postBody.media = [{ mediaFormat: "PHOTO", sourceUrl: post.media_url }];
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
          status: "posted",
          posted_at: new Date().toISOString(),
        }).eq("id", post.id);

        // post_logsにも記録
        await supabase.from("post_logs").insert({
          id: crypto.randomUUID(),
          shop_id: post.shop_id,
          shop_name: shop.name,
          summary: post.summary,
          topic_type: post.topic_type || "STANDARD",
          search_url: result.searchUrl || null,
        });
        posted++;
      } else {
        await supabase.from("scheduled_posts").update({ status: "error" }).eq("id", post.id);
        errors++;
      }
    } catch {
      await supabase.from("scheduled_posts").update({ status: "error" }).eq("id", post.id);
      errors++;
    }
  }

  console.log(`[cron/execute-posts] posted: ${posted}, errors: ${errors}`);
  return NextResponse.json({ success: true, posted, errors, total: posts.length });
}
