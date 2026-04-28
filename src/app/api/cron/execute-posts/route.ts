import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getOAuthToken } from "@/lib/gbp-token";
import { resolveLocationName } from "@/lib/gbp-location";
import { resolveImageUrl, cleanupImage } from "@/lib/image-proxy";

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

/** Go API経由でGBP投稿を作成（通常投稿） */
async function postViaGoApi(
  shopId: string, post: any
): Promise<{ ok: boolean; name?: string; error?: string }> {
  const body: any = {
    summary: (post.summary || "").slice(0, 1500),
    topicType: "STANDARD",
  };
  if (post.action_type && post.action_url) {
    const u = post.action_url;
    if (!u.includes("dropbox.com/scl/fo/") && !u.includes("dropbox.com/sh/")) {
      body.callToAction = { actionType: post.action_type, url: u };
    }
  }
  if (post.topic_type === "OFFER" && post.offer_title) {
    body.topicType = "OFFER";
    body.event = { title: post.offer_title, schedule: { startDate: post.offer_start_date, endDate: post.offer_end_date } };
  }
  if (post.photo_url) {
    body.media_urls = [post.photo_url];
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
      if (result?.name) return { ok: true, name: result.name };
      // Go APIが200を返したが投稿名がない場合（shopのgbp_location_nameがnull等）
      return { ok: false, error: "Go API: 投稿名なし（GBP未接続の可能性）" };
    }
    const errText = await res.text().catch(() => "");
    return { ok: false, error: `Go API ${res.status}: ${errText.slice(0, 200)}` };
  } catch (e: any) {
    return { ok: false, error: `Go API通信エラー: ${e?.message}` };
  }
}

/** ロケーション名を解決（Supabase shops → resolveLocationName） */
async function getLocationName(post: any, supabase: any): Promise<string | null> {
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
  if (!shopLocName) return null;
  return resolveLocationName(shopLocName);
}

/** 直接GBP APIで通常投稿（Go APIフォールバック用） */
async function postDirectGbpApi(
  post: any, accessToken: string, locationName: string
): Promise<{ ok: boolean; name?: string; error?: string }> {
  const postBody: any = {
    summary: (post.summary || "").slice(0, 1500),
    topicType: "STANDARD",
    languageCode: "ja",
  };
  if (post.action_type && post.action_url) {
    const u = post.action_url;
    if (!u.includes("dropbox.com/scl/fo/") && !u.includes("dropbox.com/sh/")) {
      postBody.callToAction = { actionType: post.action_type, url: u };
    }
  }
  if (post.photo_url) {
    postBody.media = [{ mediaFormat: "PHOTO", sourceUrl: post.photo_url }];
  }

  try {
    let res = await fetch(`${GBP_API_BASE}/${locationName}/localPosts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(postBody),
      signal: AbortSignal.timeout(30000),
    });
    // 写真付きで失敗したら写真なしでリトライ
    if (!res.ok && post.photo_url) {
      const retryBody: any = { summary: postBody.summary, topicType: "STANDARD", languageCode: "ja" };
      if (postBody.callToAction) retryBody.callToAction = postBody.callToAction;
      res = await fetch(`${GBP_API_BASE}/${locationName}/localPosts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(retryBody),
        signal: AbortSignal.timeout(30000),
      });
    }
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

/** 写真投稿: Go API経由でMedia APIアップロード */
async function uploadPhotoViaGoApi(
  shopId: string, post: any
): Promise<{ ok: boolean; name?: string; error?: string }> {
  if (!post.photo_url) return { ok: false, error: "写真URLなし" };

  // Go APIにmedia_urlsを渡してlocalPostとして作成（写真付き投稿）
  // Go APIがMedia APIを直接サポートしていないため、localPostとして作成
  // ただしこれは「投稿」セクションに行く — 後でMedia API直接呼び出しに変更する必要あり
  const body: any = {
    summary: "",
    topicType: "STANDARD",
    media_urls: [post.photo_url],
  };

  try {
    const res = await fetch(`${GO_API_URL}/api/shop/${shopId}/local_post`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    if (res.ok) {
      const result = await res.json().catch(() => ({}));
      if (result?.name) return { ok: true, name: result.name };
      return { ok: false, error: "Go API: 投稿名なし" };
    }
    const errText = await res.text().catch(() => "");
    return { ok: false, error: `Go API ${res.status}: ${errText.slice(0, 200)}` };
  } catch (e: any) {
    return { ok: false, error: `Go API通信エラー: ${e?.message}` };
  }
}

/** 写真投稿: 直接Media APIでアップロード（フォールバック） */
async function uploadPhotoDirectMediaApi(
  post: any, accessToken: string, locationName: string
): Promise<{ ok: boolean; name?: string; error?: string }> {
  if (!post.photo_url) return { ok: false, error: "写真URLなし" };

  try {
    const res = await fetch(`${GBP_API_BASE}/${locationName}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ mediaFormat: "PHOTO", sourceUrl: post.photo_url, locationAssociation: { category: "ADDITIONAL" } }),
      signal: AbortSignal.timeout(30000),
    });
    if (res.ok) {
      const result = await res.json().catch(() => ({}));
      return { ok: true, name: result?.name || "media-uploaded" };
    }
    const errText = await res.text().catch(() => "");
    return { ok: false, error: `GBP Media API ${res.status}: ${errText.slice(0, 200)}` };
  } catch (e: any) {
    return { ok: false, error: e?.message || "通信エラー" };
  }
}

/**
 * GET /api/cron/execute-posts
 * 予約投稿の自動実行（5分ごと）
 * 方式: Go API優先 → 失敗時は直接GBP API
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
    .limit(500);

  if (!posts || posts.length === 0) {
    console.log("[cron/execute-posts] 実行対象なし");
    return NextResponse.json({ success: true, message: "実行対象なし", posted: 0 });
  }

  const goToken = await getOAuthToken();
  const startTime = Date.now();
  const CONCURRENCY = 10;
  let posted = 0, errors = 0;

  async function processPost(post: any): Promise<void> {
    try {
      if (!post.shop_id) {
        await supabase.from("scheduled_posts").update({
          status: "error", error_detail: "shop_idなし",
        }).eq("id", post.id);
        errors++; return;
      }

      // Dropbox一時URLを安定した公開URLに変換
      if (post.photo_url) {
        const resolvedUrl = await resolveImageUrl(post.photo_url, post.id);
        if (resolvedUrl) {
          post.photo_url = resolvedUrl;
        } else {
          console.log(`[cron] ${post.shop_name}: 画像URL解決失敗、写真なしで投稿`);
          post.photo_url = null;
        }
      }

      let result: { ok: boolean; name?: string; error?: string };

      if (post.topic_type === "PHOTO") {
        // === 写真投稿 ===
        // 1. Go API経由（localPostとして写真付き投稿）
        result = await uploadPhotoViaGoApi(post.shop_id, post);

        // 2. Go API失敗 → 直接Media API
        if (!result.ok && goToken) {
          const locationName = await getLocationName(post, supabase);
          if (locationName) {
            console.log(`[cron] ${post.shop_name}: Go API失敗、直接Media APIにフォールバック`);
            result = await uploadPhotoDirectMediaApi(post, goToken, locationName);
          }
        }
      } else {
        // === 通常投稿 ===
        // 1. Go API経由（以前から動いていた方式）
        result = await postViaGoApi(post.shop_id, post);

        // 2. Go API失敗 → 直接GBP API
        if (!result.ok && goToken) {
          const locationName = await getLocationName(post, supabase);
          if (locationName) {
            console.log(`[cron] ${post.shop_name}: Go API失敗(${result.error?.slice(0, 60)})、直接GBP APIにフォールバック`);
            result = await postDirectGbpApi(post, goToken, locationName);
          }
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
        cleanupImage(post.id).catch(() => {});
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

  for (let i = 0; i < posts.length; i += CONCURRENCY) {
    if (Date.now() - startTime > 270_000) {
      console.log(`[cron] タイムアウト: ${posts.length - i}件を次回に持ち越し`);
      break;
    }
    const batch = posts.slice(i, i + CONCURRENCY);
    await Promise.allSettled(batch.map(processPost));
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`[cron/execute-posts] posted: ${posted}, errors: ${errors}, elapsed: ${elapsed}s`);
  return NextResponse.json({ success: true, posted, errors, total: posts.length, elapsed });
}
