import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveLocationName } from "@/lib/gbp-location";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const GBP_API_BASE = "https://mybusiness.googleapis.com/v4";
const GBP_CLIENT_ID = process.env.GBP_CLIENT_ID || "";
const GBP_CLIENT_SECRET = process.env.GBP_CLIENT_SECRET || "";
const MAX_RETRY = 3;

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
}

/** scheduled-postsと同一方式: Supabaseビューから取得+refresh_tokenで自動更新 */
async function getOAuthToken(): Promise<string | null> {
  // Go APIでトークンリフレッシュ発火
  try {
    const GO_API = process.env.NEXT_PUBLIC_API_URL || "";
    if (GO_API) await fetch(`${GO_API}/api/gbp/account`, { signal: AbortSignal.timeout(10000) });
  } catch {}

  const supabase = getSupabase();
  const { data } = await supabase.from("system_oauth_tokens")
    .select("access_token, refresh_token, expiry").limit(1).maybeSingle();
  if (!data) {
    console.error("[cron/execute-posts] No token in system_oauth_tokens");
    return null;
  }
  // まだ有効なら即返す
  if (new Date(data.expiry).getTime() - Date.now() > 5 * 60 * 1000) {
    return data.access_token;
  }
  // 期限切れ → リフレッシュ
  if (!data.refresh_token || !GBP_CLIENT_ID || !GBP_CLIENT_SECRET) {
    console.error("[cron/execute-posts] Cannot refresh: missing credentials");
    return data.access_token;
  }
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
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.error("[cron/execute-posts] Token refresh failed:", res.status);
      return data.access_token;
    }
    const t = await res.json();
    // DB書き戻し
    await supabase.from("system_oauth_tokens").update({
      access_token: t.access_token,
      expiry: new Date(Date.now() + (t.expires_in || 3600) * 1000).toISOString(),
    }).not("account_id", "is", null);
    console.log("[cron/execute-posts] Token refreshed successfully");
    return t.access_token;
  } catch (e: any) {
    console.error("[cron/execute-posts] Token refresh error:", e?.message);
    return data.access_token;
  }
}

/**
 * GET /api/cron/execute-posts
 * 予約投稿の自動実行: scheduled_postsテーブルのpending投稿をGBPに投稿
 * 毎時0分に実行
 * - エラー時は retry_count をインクリメントし、3回未満なら pending に戻して次回再試行
 * - 3回失敗したら error に確定
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
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
    .limit(10);

  if (fetchErr || !posts || posts.length === 0) {
    return NextResponse.json({ success: true, message: "実行対象なし", count: 0 });
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
  let retried = 0;

  for (const post of posts) {
    const retryCount = post.retry_count || 0;

    try {
      // shop_idで検索、見つからなければshop_nameでフォールバック
      let shop = shopMap.get(post.shop_id);
      if (!shop?.gbp_location_name && post.shop_name) {
        const { data: byName } = await supabase.from("shops")
          .select("id, name, gbp_location_name")
          .eq("name", post.shop_name)
          .not("gbp_location_name", "is", null)
          .limit(1).maybeSingle();
        if (byName) shop = byName;
      }
      if (!shop?.gbp_location_name) {
        await markFailed(supabase, post, retryCount, `GBP未接続: ${post.shop_name}`);
        errors++;
        continue;
      }

      const locationName = await resolveLocationName(shop.gbp_location_name);
      if (!locationName) {
        await markFailed(supabase, post, retryCount, `ロケーション解決失敗: ${shop.gbp_location_name}`);
        errors++;
        continue;
      }

      const postBody: any = {
        summary: (post.summary || "").slice(0, 1500),
        topicType: post.topic_type || "STANDARD",
        languageCode: "ja",
      };
      if (post.topic_type === "OFFER" && post.offer_title) {
        postBody.event = {
          title: post.offer_title,
          schedule: { startDate: post.offer_start_date, endDate: post.offer_end_date },
        };
      }
      if (post.action_type && post.action_url) {
        postBody.callToAction = { actionType: post.action_type, url: post.action_url };
      }
      if (post.media_url || post.photo_url) {
        const url = post.media_url || post.photo_url;
        postBody.media = [{ mediaFormat: "PHOTO", sourceUrl: url }];
      }

      // トークン取得（scheduled-postsと同一方式）
      const accessToken = await getOAuthToken();
      if (!accessToken) {
        await markFailed(supabase, post, retryCount, "OAuthトークン取得失敗");
        if (retryCount + 1 < MAX_RETRY) retried++;
        else errors++;
        continue;
      }

      const res = await fetch(`${GBP_API_BASE}/${locationName}/localPosts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(postBody),
        signal: AbortSignal.timeout(30000),
      });

      if (res.ok) {
        const result = await res.json().catch(() => ({}));
        await supabase.from("scheduled_posts").update({
          status: "published",
          posted_at: new Date().toISOString(),
          retry_count: retryCount,
        }).eq("id", post.id);

        await supabase.from("post_logs").insert({
          id: crypto.randomUUID(),
          shop_id: post.shop_id,
          shop_name: post.shop_name || shop.name,
          summary: post.summary,
          topic_type: post.topic_type || "STANDARD",
          search_url: result?.searchUrl || null,
        });
        posted++;
      } else {
        const errText = await res.text().catch(() => "");
        await markFailed(supabase, post, retryCount, `GBP API ${res.status}: ${errText.slice(0, 200)}`);
        if (retryCount + 1 < MAX_RETRY) retried++;
        else errors++;
      }
    } catch (e: any) {
      await markFailed(supabase, post, retryCount, (e?.message || "不明な例外").slice(0, 300));
      if (retryCount + 1 < MAX_RETRY) retried++;
      else errors++;
    }
  }

  console.log(`[cron/execute-posts] posted: ${posted}, errors: ${errors}, retried: ${retried}`);
  return NextResponse.json({ success: true, posted, errors, retried, total: posts.length });
}

/**
 * 失敗処理: リトライ上限未満ならpendingに戻す、上限に達したらerrorに確定
 */
async function markFailed(
  supabase: ReturnType<typeof getSupabase>,
  post: any,
  currentRetry: number,
  errorDetail: string
) {
  const nextRetry = currentRetry + 1;
  if (nextRetry < MAX_RETRY) {
    // pendingに戻して次のCron実行で再試行
    await supabase.from("scheduled_posts").update({
      status: "pending",
      retry_count: nextRetry,
      error_detail: `[リトライ${nextRetry}/${MAX_RETRY}] ${errorDetail}`,
    }).eq("id", post.id);
    console.log(`[cron/execute-posts] Retry ${nextRetry}/${MAX_RETRY}: ${post.shop_name} - ${errorDetail}`);
  } else {
    // 3回失敗 → error確定
    await supabase.from("scheduled_posts").update({
      status: "error",
      retry_count: nextRetry,
      error_detail: `[${MAX_RETRY}回失敗] ${errorDetail}`,
    }).eq("id", post.id);
    console.error(`[cron/execute-posts] FAILED after ${MAX_RETRY} retries: ${post.shop_name} - ${errorDetail}`);
  }
}
