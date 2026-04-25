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
 * PATCH /api/report/scheduled-posts
 * 予約投稿を更新（編集・リトライ）
 */
export async function PATCH(request: NextRequest) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const body = await request.json();
  const { id, summary, scheduledAt, status } = body;
  if (!id) return NextResponse.json({ error: "idが必要です" }, { status: 400 });

  const supabase = getSupabase();
  const update: Record<string, any> = {};
  if (summary !== undefined) update.summary = summary;
  if (scheduledAt !== undefined) update.scheduled_at = scheduledAt;
  if (status !== undefined) update.status = status;
  if (status === "pending") {
    update.error_detail = null;
    update.approval_status = "pending";
  }

  const { error } = await supabase.from("scheduled_posts").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

/**
 * PUT /api/report/scheduled-posts
 * 予約投稿を実行（cronから呼ばれる or 手動実行）
 */
export async function PUT(request: NextRequest) {
  const supabase = getSupabase();
  const now = new Date().toISOString();
  const goApiUrl = process.env.NEXT_PUBLIC_API_URL || "";

  // force=trueの場合、pending/on_hold両方を時刻制限なしで実行（「今すぐ実行」ボタン用）
  let body: any = {};
  try { body = await request.json(); } catch {}
  const force = body?.force === true;

  let query = supabase.from("scheduled_posts").select("*");
  if (force) {
    query = query.in("status", ["pending", "on_hold"]);
  } else {
    query = query.eq("status", "pending").lte("scheduled_at", now);
  }
  const { data: posts } = await query;

  if (!posts || posts.length === 0) {
    return NextResponse.json({ message: "実行対象なし", executed: 0 });
  }

  let executed = 0;
  let errors = 0;

  // Go APIの店舗一覧を取得（Go APIが認識するshop_idを取得するため）
  let goShops: any[] = [];
  try {
    const goShopRes = await fetch(`${goApiUrl}/api/shop`, { signal: AbortSignal.timeout(15000) });
    if (goShopRes.ok) {
      const goShopData = await goShopRes.json();
      goShops = Array.isArray(goShopData) ? goShopData : goShopData?.shops || goShopData?.data || [];
    }
  } catch {}

  for (const post of posts) {
    try {
      // Go APIが認識するshop_idを店舗名で検索
      let shopId = post.shop_id;
      if (post.shop_name && goShops.length > 0) {
        const goShop = goShops.find((s: any) =>
          s.name === post.shop_name || s.gbp_shop_name === post.shop_name
          || s.name?.includes(post.shop_name) || post.shop_name.includes(s.name || "")
        );
        if (goShop) shopId = goShop.id;
      }

      // Go API経由でGBP投稿（OAuth管理はGo API側）
      const goBody: any = {
        summary: (post.summary || "").slice(0, 1500),
        topicType: post.topic_type || "STANDARD",
      };
      if (post.action_type && post.action_url) {
        goBody.callToAction = { actionType: post.action_type, url: post.action_url };
      }
      if (post.topic_type === "OFFER" && post.offer_title) {
        goBody.event = { title: post.offer_title, schedule: { startDate: post.offer_start_date, endDate: post.offer_end_date } };
      }

      const res = await fetch(`${goApiUrl}/api/shop/${shopId}/local_post`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(goBody),
        signal: AbortSignal.timeout(30000),
      });

      if (res.ok) {
        let result: any = null;
        try { result = await res.json(); } catch {}
        const searchUrl = result?.searchUrl || result?.search_url || null;

        await supabase.from("scheduled_posts").update({
          status: "published",
          published_at: new Date().toISOString(),
          search_url: searchUrl,
        }).eq("id", post.id);

        await supabase.from("post_logs").insert({
          id: crypto.randomUUID(),
          shop_id: post.shop_id,
          shop_name: post.shop_name,
          summary: post.summary,
          topic_type: post.topic_type,
          media_url: post.photo_url,
          action_type: post.action_type,
          action_url: post.action_url,
          search_url: searchUrl,
        });
        executed++;
      } else {
        const err = await res.text().catch(() => "");
        await supabase.from("scheduled_posts").update({ status: "error", error_detail: `Go API ${res.status}: ${err.slice(0, 200)}` }).eq("id", post.id);
        errors++;
      }
    } catch (e: any) {
      await supabase.from("scheduled_posts").update({ status: "error", error_detail: (e?.message || "不明な例外").slice(0, 300) }).eq("id", post.id);
      errors++;
    }
  }

  return NextResponse.json({ executed, errors, total: posts.length });
}
