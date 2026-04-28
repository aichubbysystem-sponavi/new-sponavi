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
const GBP_API_BASE = "https://mybusiness.googleapis.com/v4";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
}

/** ロケーション名を解決（shop_id → Supabase shops → resolveLocationName） */
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

/** 直接GBP APIで通常投稿を作成（即時投稿と同じ方式） */
async function postViaGbpApi(
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
  if (post.topic_type === "OFFER" && post.offer_title) {
    postBody.topicType = "OFFER";
    postBody.event = { title: post.offer_title, schedule: { startDate: post.offer_start_date, endDate: post.offer_end_date } };
  }
  if (post.photo_url) {
    postBody.media = [{ mediaFormat: "PHOTO", sourceUrl: post.photo_url }];
  }

  const doPost = async (token: string, body: any) => {
    return fetch(`${GBP_API_BASE}/${locationName}/localPosts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
  };

  try {
    let res = await doPost(accessToken, postBody);

    // 401の場合、トークン再取得してリトライ
    if (res.status === 401) {
      console.log(`[postViaGbpApi] 401 for ${post.shop_name}, retrying with new token...`);
      const newToken = await getOAuthToken();
      if (newToken && newToken !== accessToken) {
        res = await doPost(newToken, postBody);
      }
    }

    // 写真付きで失敗したら写真なしでリトライ（即時投稿と同じ）
    if (!res.ok && post.photo_url) {
      const retryBody: any = { summary: postBody.summary, topicType: "STANDARD", languageCode: "ja" };
      if (postBody.callToAction) retryBody.callToAction = postBody.callToAction;
      res = await doPost(accessToken, retryBody);
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

/** 写真投稿: Media APIで「写真と動画」セクションにアップロード（401時リトライ付き） */
async function uploadPhotoViaMediaApi(
  post: any, accessToken: string, locationName: string
): Promise<{ ok: boolean; name?: string; error?: string }> {
  if (!post.photo_url) return { ok: false, error: "写真URLなし" };

  const mediaUrl = `${GBP_API_BASE}/${locationName}/media`;
  const body = JSON.stringify({ mediaFormat: "PHOTO", sourceUrl: post.photo_url, locationAssociation: { category: "ADDITIONAL" } });

  const doUpload = async (token: string) => {
    console.log(`[uploadPhoto] ${post.shop_name}: URL=${mediaUrl}, token=${token?.slice(0, 20)}...`);
    return fetch(mediaUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body,
      signal: AbortSignal.timeout(30000),
    });
  };

  try {
    let res = await doUpload(accessToken);

    // 401の場合、別のトークンで最大3回リトライ
    if (res.status === 401) {
      for (let i = 0; i < 3; i++) {
        console.log(`[uploadPhoto] 401 retry ${i + 1} for ${post.shop_name}`);
        const newToken = await getOAuthToken();
        if (newToken && newToken !== accessToken) {
          res = await doUpload(newToken);
          if (res.status !== 401) break;
          accessToken = newToken; // 次のリトライで同じトークンを避ける
        } else {
          break; // 同じトークンしか取れない場合はリトライしない
        }
      }
    }

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
 * 即時投稿（auto-post）と同じ方式で直接GBP APIを呼ぶ
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

  const _token = await getOAuthToken();
  if (!_token) {
    console.error("[cron/execute-posts] OAuthトークン取得失敗");
    return NextResponse.json({ error: "OAuthトークン取得失敗" }, { status: 500 });
  }
  const accessToken: string = _token;

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

      // ロケーション解決（Supabase shops → resolveLocationName）
      const locationName: string | null = await getLocationName(post, supabase);
      if (!locationName) {
        await supabase.from("scheduled_posts").update({
          status: "error", error_detail: `ロケーション解決失敗: ${post.shop_name}`,
        }).eq("id", post.id);
        errors++; return;
      }

      // Dropbox一時URLを安定した公開URLに変換
      if (post.photo_url) {
        const resolvedUrl = await resolveImageUrl(post.photo_url, post.id);
        if (resolvedUrl) {
          post.photo_url = resolvedUrl;
        } else {
          console.log(`[cron/execute-posts] ${post.shop_name}: 画像URL解決失敗、写真なしで投稿`);
          post.photo_url = null;
        }
      }

      let result: { ok: boolean; name?: string; error?: string };

      const loc = locationName!;
      console.log(`[cron/execute-posts] ${post.shop_name}: topic_type=${post.topic_type}, location=${loc}, photo_url=${post.photo_url ? 'あり' : 'なし'}`);
      // 写真投稿（topic_type === "PHOTO"）→ Media APIで「写真と動画」にアップロード
      if (post.topic_type === "PHOTO") {
        result = await uploadPhotoViaMediaApi(post, accessToken, loc);
      } else {
        // 通常投稿 → 直接GBP API（即時投稿と同じ方式）
        result = await postViaGbpApi(post, accessToken, loc);
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
      console.log(`[cron/execute-posts] タイムアウト: ${posts.length - i}件を次回に持ち越し`);
      break;
    }
    const batch = posts.slice(i, i + CONCURRENCY);
    await Promise.allSettled(batch.map(processPost));
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`[cron/execute-posts] posted: ${posted}, errors: ${errors}, elapsed: ${elapsed}s`);
  return NextResponse.json({ success: true, posted, errors, total: posts.length, elapsed });
}
