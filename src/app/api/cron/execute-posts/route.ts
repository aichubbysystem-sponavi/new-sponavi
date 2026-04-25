import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveLocationName } from "@/lib/gbp-location";
import { getValidTokens } from "@/lib/gbp-token";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const GBP_API_BASE = "https://mybusiness.googleapis.com/v4";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
}

/**
 * GET /api/cron/execute-posts
 * 予約投稿の自動実行: scheduled_postsテーブルのpending投稿をGBPに投稿
 * 毎時0分に実行
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
    .limit(10); // Vercel Hobby 60秒制限: 1投稿約5秒 → 最大10件/実行

  if (fetchErr || !posts || posts.length === 0) {
    return NextResponse.json({ success: true, message: "実行対象なし", count: 0 });
  }

  const allTokens = await getValidTokens();
  if (allTokens.length === 0) {
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
        await supabase.from("scheduled_posts").update({ status: "error", error_detail: `GBP未接続: ${post.shop_name}` }).eq("id", post.id);
        errors++;
        continue;
      }

      const locationName = await resolveLocationName(shop.gbp_location_name);
      if (!locationName) {
        await supabase.from("scheduled_posts").update({ status: "error", error_detail: `ロケーション解決失敗: ${shop.gbp_location_name}` }).eq("id", post.id);
        errors++;
        continue;
      }

      const postBody: any = {
        summary: (post.summary || "").slice(0, 1500),
        topicType: post.topic_type || "STANDARD",
        languageCode: "ja",
      };
      // 特典投稿（OFFER）対応
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

      let res: Response | null = null;
      for (const token of allTokens) {
        res = await fetch(`${GBP_API_BASE}/${locationName}/localPosts`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(postBody),
          signal: AbortSignal.timeout(30000),
        });
        if (res.ok || (res.status !== 401 && res.status !== 403)) break;
      }

      if (res && res.ok) {
        const result = await res.json();
        await supabase.from("scheduled_posts").update({
          status: "published",
          posted_at: new Date().toISOString(),
        }).eq("id", post.id);

        await supabase.from("post_logs").insert({
          id: crypto.randomUUID(),
          shop_id: post.shop_id,
          shop_name: post.shop_name || shop.name,
          summary: post.summary,
          topic_type: post.topic_type || "STANDARD",
          search_url: result.searchUrl || null,
        });
        posted++;
      } else {
        const err = res ? await res.text().catch(() => "") : "レスポンスなし";
        await supabase.from("scheduled_posts").update({ status: "error", error_detail: `GBP API ${res?.status}: ${err.slice(0, 200)}` }).eq("id", post.id);
        errors++;
      }
    } catch (e: any) {
      await supabase.from("scheduled_posts").update({ status: "error", error_detail: (e?.message || "不明な例外").slice(0, 300) }).eq("id", post.id);
      errors++;
    }
  }

  console.log(`[cron/execute-posts] posted: ${posted}, errors: ${errors}`);
  return NextResponse.json({ success: true, posted, errors, total: posts.length });
}
