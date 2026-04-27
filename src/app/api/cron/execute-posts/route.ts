import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getOAuthToken } from "@/lib/gbp-token";
import { resolveLocationName } from "@/lib/gbp-location";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const GO_API_URL = process.env.NEXT_PUBLIC_API_URL || "";
const GBP_API_BASE = "https://mybusiness.googleapis.com/v4";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
}

/**
 * Go API経由でGBP投稿を作成
 */
async function postViaGoApi(
  shopId: string, post: any
): Promise<{ ok: boolean; name?: string; error?: string }> {
  const body: any = {
    summary: (post.summary || "").slice(0, 1500),
    topicType: post.topic_type || "STANDARD",
  };

  if (post.action_type && post.action_url) {
    let ctaUrl = post.action_url;
    if (!ctaUrl.includes("dropbox.com/scl/fo/") && !ctaUrl.includes("dropbox.com/sh/")) {
      body.callToAction = { actionType: post.action_type, url: ctaUrl };
    }
  }

  if (post.topic_type === "OFFER" && post.offer_title) {
    body.event = {
      title: post.offer_title,
      schedule: { startDate: post.offer_start_date, endDate: post.offer_end_date },
    };
  }

  if (post.photo_url) {
    let url = post.photo_url;
    if (url.includes("dropbox.com") && !url.includes("dropboxusercontent")) {
      url = url.replace("www.dropbox.com", "dl.dropboxusercontent.com").replace(/[&?]dl=\d/g, "");
    }
    body.media_urls = [url];
  }

  try {
    const res = await fetch(`${GO_API_URL}/api/shop/${shopId}/local_post`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    if (res.ok) {
      const result = await res.json().catch(() => ({}));
      return { ok: true, name: result?.name || "unknown" };
    }

    const errText = await res.text().catch(() => "");
    return { ok: false, error: `Go API ${res.status}: ${errText.slice(0, 200)}` };
  } catch (e: any) {
    return { ok: false, error: e?.message || "通信エラー" };
  }
}

/**
 * Go APIトークンで直接GBP APIに投稿（Go APIにshopが無い場合のフォールバック）
 */
async function postDirectWithGoToken(
  post: any, accessToken: string, supabase: any
): Promise<{ ok: boolean; name?: string; error?: string }> {
  // shop_idからgbp_location_nameを取得
  let shopLocName = "";
  const { data: shop } = await supabase.from("shops")
    .select("gbp_location_name").eq("id", post.shop_id).maybeSingle();
  if (shop?.gbp_location_name) {
    shopLocName = shop.gbp_location_name;
  } else if (post.shop_name) {
    const { data: byName } = await supabase.from("shops")
      .select("gbp_location_name").eq("name", post.shop_name)
      .not("gbp_location_name", "is", null).limit(1).maybeSingle();
    if (byName?.gbp_location_name) shopLocName = byName.gbp_location_name;
  }
  if (!shopLocName) return { ok: false, error: `GBP未接続: ${post.shop_name}` };

  const locationName = await resolveLocationName(shopLocName);
  if (!locationName) return { ok: false, error: `ロケーション解決失敗: ${shopLocName}` };

  // 投稿ボディ構築
  const postBody: any = {
    summary: (post.summary || "").slice(0, 1500),
    topicType: post.topic_type || "STANDARD",
    languageCode: "ja",
  };

  if (post.action_type && post.action_url) {
    const u = post.action_url;
    if (!u.includes("dropbox.com/scl/fo/") && !u.includes("dropbox.com/sh/")) {
      postBody.callToAction = { actionType: post.action_type, url: u };
    }
  }

  if (post.photo_url) {
    let url = post.photo_url;
    if (url.includes("dropbox.com") && !url.includes("dropboxusercontent")) {
      url = url.replace("www.dropbox.com", "dl.dropboxusercontent.com").replace(/[&?]dl=\d/g, "");
    }
    postBody.media = [{ mediaFormat: "PHOTO", sourceUrl: url }];
  }

  try {
    const res = await fetch(`${GBP_API_BASE}/${locationName}/localPosts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(postBody),
      signal: AbortSignal.timeout(30000),
    });

    if (res.ok) {
      const result = await res.json().catch(() => ({}));
      return { ok: true, name: result?.name || "unknown" };
    }

    const errText = await res.text().catch(() => "");
    return { ok: false, error: `GBP API ${res.status}: ${errText.slice(0, 200)}` };
  } catch (e: any) {
    return { ok: false, error: e?.message || "通信エラー" };
  }
}

/**
 * GET /api/cron/execute-posts
 * 予約投稿の自動実行（毎時5分）
 * 1. Go API経由 → 2. Go APIトークンで直接GBP API
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();
  const now = new Date().toISOString();

  const { data: posts } = await supabase
    .from("scheduled_posts")
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_at", now)
    .order("scheduled_at", { ascending: true })
    .limit(10);

  if (!posts || posts.length === 0) {
    console.log("[cron/execute-posts] 実行対象なし");
    return NextResponse.json({ success: true, message: "実行対象なし", posted: 0 });
  }

  // Go APIトークンを事前取得（フォールバック用）
  let goToken: string | null = null;

  let posted = 0, errors = 0;

  for (const post of posts) {
    try {
      if (!post.shop_id) {
        await supabase.from("scheduled_posts").update({
          status: "error", error_detail: "shop_idなし",
        }).eq("id", post.id);
        errors++; continue;
      }

      // 方法1: Go API経由
      let result = await postViaGoApi(post.shop_id, post);

      // 方法2: Go APIでshop not found → Go APIトークンで直接GBP API
      if (!result.ok && result.error?.includes("not found")) {
        console.log(`[cron/execute-posts] ${post.shop_name}: Go APIにshopなし、直接投稿にフォールバック`);
        if (!goToken) goToken = await getOAuthToken();
        if (goToken) {
          result = await postDirectWithGoToken(post, goToken, supabase);
        }
      }

      if (result.ok) {
        await supabase.from("scheduled_posts").update({
          status: "published", published_at: new Date().toISOString(),
        }).eq("id", post.id);
        await supabase.from("post_logs").insert({
          id: crypto.randomUUID(), shop_id: post.shop_id, shop_name: post.shop_name,
          summary: post.summary, topic_type: post.topic_type,
          media_url: post.photo_url, gbp_post_name: result.name,
        });
        posted++;
      } else {
        await supabase.from("scheduled_posts").update({
          status: "error", error_detail: result.error?.slice(0, 300),
        }).eq("id", post.id);
        errors++;
      }
    } catch (e: any) {
      await supabase.from("scheduled_posts").update({
        status: "error", error_detail: (e?.message || "不明な例外").slice(0, 300),
      }).eq("id", post.id);
      errors++;
    }
  }

  console.log(`[cron/execute-posts] posted: ${posted}, errors: ${errors}`);
  return NextResponse.json({ success: true, posted, errors, total: posts.length });
}
