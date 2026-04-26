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
  // 認証: JWT or Cron Secret
  const cronSecret = process.env.CRON_SECRET;
  const isCron = cronSecret && request.headers.get("x-cron-secret") === cronSecret;
  if (!isCron) {
    const { verifyAuth } = await import("@/lib/auth-verify");
    const auth = await verifyAuth(request.headers.get("authorization"));
    if (!auth.valid) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

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

  // Go APIを叩いてトークンリフレッシュ発火
  try { await fetch(`${goApiUrl}/api/gbp/account`, { signal: AbortSignal.timeout(15000) }); } catch {}

  // auto-postと同じ方式でOAuthトークン取得
  const accessToken = await getOAuthToken();
  if (!accessToken) {
    return NextResponse.json({ error: "OAuthトークンなし" }, { status: 500 });
  }

  for (const post of posts) {
    try {
      // shop_nameでSupabaseからgbp_location_nameを取得
      let shopLocName = "";
      const { data: shop } = await supabase.from("shops")
        .select("gbp_location_name").eq("id", post.shop_id).maybeSingle();
      if (shop?.gbp_location_name) {
        shopLocName = shop.gbp_location_name;
      } else if (post.shop_name) {
        const { data: byName } = await supabase.from("shops")
          .select("gbp_location_name")
          .eq("name", post.shop_name)
          .not("gbp_location_name", "is", null)
          .limit(1).maybeSingle();
        if (byName?.gbp_location_name) shopLocName = byName.gbp_location_name;
      }
      if (!shopLocName) {
        await supabase.from("scheduled_posts").update({ status: "error", error_detail: `GBP未接続: ${post.shop_name}` }).eq("id", post.id);
        errors++; continue;
      }

      // ロケーション名解決（auto-postと同じ）
      const { resolveLocationName } = await import("@/lib/gbp-location");
      const locationName = await resolveLocationName(shopLocName);
      if (!locationName) {
        await supabase.from("scheduled_posts").update({ status: "error", error_detail: `ロケーション解決失敗: ${shopLocName}` }).eq("id", post.id);
        errors++; continue;
      }

      // GBP API投稿（400エラー時は写真/CTAを外して自動リトライ）
      const postResult = await tryPostToGbp(locationName, post, accessToken);

      if (postResult.ok && postResult.name) {
        await supabase.from("scheduled_posts").update({
          status: "published", published_at: new Date().toISOString(),
          search_url: postResult.searchUrl || null,
        }).eq("id", post.id);

        await supabase.from("post_logs").insert({
          id: crypto.randomUUID(), shop_id: post.shop_id, shop_name: post.shop_name,
          summary: post.summary, topic_type: post.topic_type,
          media_url: post.photo_url, search_url: postResult.searchUrl || null,
          gbp_post_name: postResult.name,
        });
        executed++;
      } else {
        await supabase.from("scheduled_posts").update({
          status: "error",
          error_detail: postResult.error?.slice(0, 300) || "不明なエラー",
        }).eq("id", post.id);
        errors++;
      }
    } catch (e: any) {
      await supabase.from("scheduled_posts").update({ status: "error", error_detail: (e?.message || "不明な例外").slice(0, 300) }).eq("id", post.id);
      errors++;
    }
  }

  return NextResponse.json({ executed, errors, total: posts.length });
}

/**
 * GBP投稿を試行。400エラー時は写真→CTA→両方の順で外して自動リトライ
 */
async function tryPostToGbp(
  locationName: string,
  post: any,
  accessToken: string
): Promise<{ ok: boolean; name?: string; searchUrl?: string; error?: string }> {
  // 写真URL変換
  let photoUrl = post.photo_url || "";
  if (photoUrl && photoUrl.includes("dropbox.com") && !photoUrl.includes("dropboxusercontent")) {
    photoUrl = photoUrl.replace("www.dropbox.com", "dl.dropboxusercontent.com").replace(/[&?]dl=\d/g, "");
  }

  // CTA URLバリデーション（Dropboxフォルダ等は除外）
  let ctaType = post.action_type || "";
  let ctaUrl = post.action_url || "";
  if (ctaUrl && (ctaUrl.includes("dropbox.com/scl/fo/") || ctaUrl.includes("dropbox.com/sh/"))) {
    ctaType = "";
    ctaUrl = "";
  }

  // 試行パターン: 1. フル → 2. 写真なし → 3. CTAなし → 4. テキストのみ
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
      postBody.event = {
        title: post.offer_title,
        schedule: { startDate: post.offer_start_date, endDate: post.offer_end_date },
      };
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
        if (result?.name) {
          if (attempt.label !== "フル") {
            console.log(`[scheduled-posts] ${post.shop_name}: ${attempt.label}で投稿成功`);
          }
          return { ok: true, name: result.name, searchUrl: result.searchUrl };
        }
        return { ok: true, name: "unknown" };
      }

      const errText = await res.text().catch(() => "");
      lastError = `GBP API ${res.status}: ${errText.slice(0, 200)}`;

      // 400/422はリクエスト内容の問題 → 次のパターンで再試行
      if (res.status === 400 || res.status === 422) {
        console.log(`[scheduled-posts] ${post.shop_name}: ${attempt.label}で${res.status} → 次を試行`);
        continue;
      }

      // 401/403はトークンの問題 → リトライしても無駄
      // 500はサーバーエラー → リトライしても無駄
      return { ok: false, error: lastError };
    } catch (e: any) {
      lastError = e?.message || "通信エラー";
      return { ok: false, error: lastError };
    }
  }

  return { ok: false, error: `全パターン失敗: ${lastError}` };
}
