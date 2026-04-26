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

/** scheduled-postsと完全同一のトークン取得 */
async function getOAuthToken(): Promise<string | null> {
  // Go APIでトークンリフレッシュ発火
  try {
    const GO_API = process.env.NEXT_PUBLIC_API_URL || "";
    if (GO_API) await fetch(`${GO_API}/api/gbp/account`, { signal: AbortSignal.timeout(10000) });
  } catch {}

  const supabase = getSupabase();
  const { data } = await supabase.from("system_oauth_tokens")
    .select("access_token, refresh_token, expiry").limit(1).maybeSingle();
  if (!data) return null;
  if (new Date(data.expiry).getTime() - Date.now() > 5 * 60 * 1000) return data.access_token;
  if (!data.refresh_token || !GBP_CLIENT_ID || !GBP_CLIENT_SECRET) return data.access_token;
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GBP_CLIENT_ID, client_secret: GBP_CLIENT_SECRET,
        refresh_token: data.refresh_token, grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(10000),
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

/** GBP投稿を試行。400エラー時は写真/CTA除外で自動リトライ */
async function tryPostToGbp(
  locationName: string, post: any, accessToken: string
): Promise<{ ok: boolean; name?: string; searchUrl?: string; error?: string }> {
  let photoUrl = post.photo_url || "";
  if (photoUrl && photoUrl.includes("dropbox.com") && !photoUrl.includes("dropboxusercontent")) {
    photoUrl = photoUrl.replace("www.dropbox.com", "dl.dropboxusercontent.com").replace(/[&?]dl=\d/g, "");
  }
  let ctaType = post.action_type || "";
  let ctaUrl = post.action_url || "";
  if (ctaUrl && (ctaUrl.includes("dropbox.com/scl/fo/") || ctaUrl.includes("dropbox.com/sh/"))) {
    ctaType = ""; ctaUrl = "";
  }

  const attempts = [
    { photo: photoUrl, cta: ctaUrl, ctaType, label: "フル" },
    ...(photoUrl ? [{ photo: "", cta: ctaUrl, ctaType, label: "写真なし" }] : []),
    ...(ctaUrl ? [{ photo: photoUrl, cta: "", ctaType: "", label: "CTAなし" }] : []),
    ...(photoUrl || ctaUrl ? [{ photo: "", cta: "", ctaType: "", label: "テキストのみ" }] : []),
  ];

  let lastError = "";
  for (const attempt of attempts) {
    const postBody: any = {
      summary: (post.summary || "").slice(0, 1500),
      topicType: post.topic_type || "STANDARD",
      languageCode: "ja",
    };
    if (attempt.ctaType && attempt.cta) {
      postBody.callToAction = { actionType: attempt.ctaType, url: attempt.cta };
    }
    if (post.topic_type === "OFFER" && post.offer_title) {
      postBody.event = { title: post.offer_title, schedule: { startDate: post.offer_start_date, endDate: post.offer_end_date } };
    }
    if (attempt.photo) {
      postBody.media = [{ mediaFormat: "PHOTO", sourceUrl: attempt.photo }];
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
        if (attempt.label !== "フル") console.log(`[cron/execute-posts] ${post.shop_name}: ${attempt.label}で投稿成功`);
        return { ok: true, name: result?.name || "unknown", searchUrl: result?.searchUrl };
      }
      const errText = await res.text().catch(() => "");
      lastError = `GBP API ${res.status}: ${errText.slice(0, 200)}`;
      if (res.status === 400 || res.status === 422) continue;
      return { ok: false, error: lastError };
    } catch (e: any) {
      return { ok: false, error: e?.message || "通信エラー" };
    }
  }
  return { ok: false, error: `全パターン失敗: ${lastError}` };
}

/**
 * GET /api/cron/execute-posts
 * 予約投稿の自動実行（毎時5分）
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

  const accessToken = await getOAuthToken();
  if (!accessToken) {
    console.error("[cron/execute-posts] OAuthトークン取得失敗");
    return NextResponse.json({ error: "OAuthトークンなし" }, { status: 500 });
  }

  let posted = 0, errors = 0;

  for (const post of posts) {
    try {
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
      if (!shopLocName) {
        await supabase.from("scheduled_posts").update({ status: "error", error_detail: `GBP未接続: ${post.shop_name}` }).eq("id", post.id);
        errors++; continue;
      }

      const { resolveLocationName } = await import("@/lib/gbp-location");
      const locationName = await resolveLocationName(shopLocName);
      if (!locationName) {
        await supabase.from("scheduled_posts").update({ status: "error", error_detail: `ロケーション解決失敗: ${shopLocName}` }).eq("id", post.id);
        errors++; continue;
      }

      const result = await tryPostToGbp(locationName, post, accessToken);

      if (result.ok) {
        await supabase.from("scheduled_posts").update({
          status: "published", posted_at: new Date().toISOString(),
        }).eq("id", post.id);
        await supabase.from("post_logs").insert({
          id: crypto.randomUUID(), shop_id: post.shop_id, shop_name: post.shop_name,
          summary: post.summary, topic_type: post.topic_type,
          media_url: post.photo_url, search_url: result.searchUrl || null,
          gbp_post_name: result.name,
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
