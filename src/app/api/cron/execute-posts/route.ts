import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const GO_API_URL = process.env.NEXT_PUBLIC_API_URL || "";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
}

/**
 * Go API経由でGBP投稿を作成
 * Go APIは自身のOAuth設定で確実にGBP APIを呼べる
 */
async function postViaGoApi(
  shopId: string, post: any
): Promise<{ ok: boolean; name?: string; error?: string }> {
  const body: any = {
    summary: (post.summary || "").slice(0, 1500),
    topicType: post.topic_type || "STANDARD",
  };

  if (post.action_type && post.action_url) {
    // DropboxフォルダURLはCTAに使えない
    let ctaUrl = post.action_url;
    if (ctaUrl.includes("dropbox.com/scl/fo/") || ctaUrl.includes("dropbox.com/sh/")) {
      // skip CTA
    } else {
      body.callToAction = { actionType: post.action_type, url: ctaUrl };
    }
  }

  if (post.topic_type === "OFFER" && post.offer_title) {
    body.event = {
      title: post.offer_title,
      schedule: { startDate: post.offer_start_date, endDate: post.offer_end_date },
    };
  }

  // 写真URL対応（Dropbox URLは直リンクに変換）
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
 * GET /api/cron/execute-posts
 * 予約投稿の自動実行（毎時5分）— Go API経由
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

  let posted = 0, errors = 0;

  for (const post of posts) {
    try {
      if (!post.shop_id) {
        await supabase.from("scheduled_posts").update({
          status: "error", error_detail: "shop_idなし",
        }).eq("id", post.id);
        errors++; continue;
      }

      const result = await postViaGoApi(post.shop_id, post);

      if (result.ok) {
        await supabase.from("scheduled_posts").update({
          status: "published", posted_at: new Date().toISOString(),
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
