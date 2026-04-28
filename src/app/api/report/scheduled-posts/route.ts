import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const GO_API_URL = process.env.NEXT_PUBLIC_API_URL || "";
const GBP_API_BASE = "https://mybusiness.googleapis.com/v4";
const GBP_CLIENT_ID = process.env.GBP_CLIENT_ID || "";
const GBP_CLIENT_SECRET = process.env.GBP_CLIENT_SECRET || "";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
}

/** 全OAuthトークンを取得 */
async function getAllOAuthTokens(): Promise<string[]> {
  const supabase = getSupabase();
  const tokens: string[] = [];
  // system_oauth_tokens
  const { data: oauthTokens } = await supabase.from("system_oauth_tokens")
    .select("access_token, refresh_token, expiry");
  if (oauthTokens) {
    for (const row of oauthTokens) {
      if (new Date(row.expiry).getTime() - Date.now() > 5 * 60 * 1000) {
        tokens.push(row.access_token);
      } else if (row.refresh_token && GBP_CLIENT_ID) {
        try {
          const res = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ client_id: GBP_CLIENT_ID, client_secret: GBP_CLIENT_SECRET,
              refresh_token: row.refresh_token, grant_type: "refresh_token" }),
            signal: AbortSignal.timeout(10000),
          });
          if (res.ok) { const t = await res.json(); if (t.access_token) tokens.push(t.access_token); }
        } catch {}
      }
    }
  }
  // system.tokens (PERSONALアカウント含む)
  try {
    const { data: sysTokens } = await supabase.rpc("get_valid_tokens");
    if (sysTokens) {
      for (const row of sysTokens) {
        if (row.refresh_token && GBP_CLIENT_ID) {
          try {
            const res = await fetch("https://oauth2.googleapis.com/token", {
              method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({ client_id: GBP_CLIENT_ID, client_secret: GBP_CLIENT_SECRET,
                refresh_token: row.refresh_token, grant_type: "refresh_token" }),
              signal: AbortSignal.timeout(10000),
            });
            if (res.ok) { const t = await res.json(); if (t.access_token) tokens.push(t.access_token); }
          } catch {}
        } else if (row.access_token) {
          tokens.push(row.access_token);
        }
      }
    }
  } catch {}
  // 重複排除
  return tokens.filter((v, i, a) => a.indexOf(v) === i);
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

  for (const post of posts) {
    try {
      if (!post.shop_id) {
        await supabase.from("scheduled_posts").update({ status: "error", error_detail: "shop_idなし" }).eq("id", post.id);
        errors++; continue;
      }

      let postOk = false;
      let postName = "unknown";
      let postError = "";

      if (post.topic_type === "PHOTO") {
        // === 写真投稿: Media API経由で「写真と動画」セクションに投稿 ===
        if (!post.photo_url) {
          await supabase.from("scheduled_posts").update({ status: "error", error_detail: "写真URLなし" }).eq("id", post.id);
          errors++; continue;
        }

        // 1. Go API media_direct を試す
        try {
          const mdRes = await fetch(`${GO_API_URL}/api/shop/${post.shop_id}/media_direct`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ source_url: post.photo_url, category: "ADDITIONAL" }),
            signal: AbortSignal.timeout(30000),
          });
          if (mdRes.ok) {
            const r = await mdRes.json().catch(() => ({}));
            postOk = true; postName = r?.name || "media-uploaded";
          } else {
            postError = await mdRes.text().catch(() => "");
          }
        } catch (e: any) { postError = e?.message || "通信エラー"; }

        // 2. Go API失敗 → 全トークンで直接Media API
        if (!postOk) {
          const { resolveLocationName } = await import("@/lib/gbp-location");
          const { data: shop } = await supabase.from("shops")
            .select("gbp_location_name").eq("id", post.shop_id).maybeSingle();
          const locName = shop?.gbp_location_name ? await resolveLocationName(shop.gbp_location_name) : null;
          if (locName) {
            const allTokens = await getAllOAuthTokens();
            for (const token of allTokens) {
              try {
                const mediaRes = await fetch(`${GBP_API_BASE}/${locName}/media`, {
                  method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                  body: JSON.stringify({ mediaFormat: "PHOTO", sourceUrl: post.photo_url, locationAssociation: { category: "ADDITIONAL" } }),
                  signal: AbortSignal.timeout(30000),
                });
                if (mediaRes.ok) {
                  const r = await mediaRes.json().catch(() => ({}));
                  postOk = true; postName = r?.name || "media-uploaded";
                  break;
                }
              } catch {}
            }
            if (!postOk) postError = `全トークン(${allTokens.length}件)でMedia API失敗`;
          } else {
            postError = "ロケーション解決失敗";
          }
        }
      } else {
        // === 通常投稿: Go API local_post ===
        const goBody: any = {
          summary: (post.summary || "").slice(0, 1500),
          topicType: post.topic_type || "STANDARD",
        };
        if (post.action_type && post.action_url) {
          const u = post.action_url;
          if (!u.includes("dropbox.com/scl/fo/") && !u.includes("dropbox.com/sh/")) {
            goBody.callToAction = { actionType: post.action_type, url: u };
          }
        }
        if (post.topic_type === "OFFER" && post.offer_title) {
          goBody.event = { title: post.offer_title, schedule: { startDate: post.offer_start_date, endDate: post.offer_end_date } };
        }
        if (post.photo_url) {
          let url = post.photo_url;
          if (url.includes("dropbox.com") && !url.includes("dropboxusercontent")) {
            url = url.replace("www.dropbox.com", "dl.dropboxusercontent.com").replace(/[&?]dl=\d/g, "");
          }
          goBody.media_urls = [url];
        }

        try {
          const res = await fetch(`${GO_API_URL}/api/shop/${post.shop_id}/local_post`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(goBody), signal: AbortSignal.timeout(30000),
          });
          if (res.ok) {
            const result = await res.json().catch(() => ({}));
            postOk = true; postName = result?.name || "unknown";
          } else {
            postError = `Go API ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`;
          }
        } catch (e: any) { postError = e?.message || "通信エラー"; }
      }

      if (postOk) {
        await supabase.from("scheduled_posts").update({
          status: "published", published_at: new Date().toISOString(),
        }).eq("id", post.id);
        await supabase.from("post_logs").insert({
          id: crypto.randomUUID(), shop_id: post.shop_id, shop_name: post.shop_name,
          summary: post.summary, topic_type: post.topic_type,
          media_url: post.photo_url, gbp_post_name: postName,
        });
        executed++;
      } else {
        await supabase.from("scheduled_posts").update({
          status: "error", error_detail: postError.slice(0, 300),
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
