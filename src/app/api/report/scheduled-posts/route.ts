import { NextRequest, NextResponse } from "next/server";
import { getSupabase, verifyAuth, requireShopAccessById, getUserAllowedShops, safeEqual } from "@/lib/supabase";
import { withAudit, requireCtxShopAccess, requireCtxShopAccessById, type AuditContext } from "@/lib/audit";
import { getAllOAuthTokens } from "@/lib/gbp-token";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const GO_API_URL = process.env.NEXT_PUBLIC_API_URL || "";
const GBP_API_BASE = "https://mybusiness.googleapis.com/v4";

/**
 * GET /api/report/scheduled-posts?shopId=xxx
 * 予約投稿一覧を取得
 */
export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid || !auth.sub) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  const shopId = request.nextUrl.searchParams.get("shopId");

  const supabase = getSupabase();
  let query = supabase.from("scheduled_posts").select("*").order("scheduled_at", { ascending: true });

  // 認可チェック
  if (shopId) {
    const access = await requireShopAccessById(request, shopId);
    if (access.error) return access.error;
    query = query.eq("shop_id", shopId);
  } else {
    // shopId省略時: president以外は許可店舗のみに絞る（全店舗漏洩を防止）
    const allowedShops = await getUserAllowedShops(auth.sub);
    if (allowedShops !== "all") {
      if (allowedShops.length === 0) return NextResponse.json([]);
      query = query.in("shop_name", allowedShops);
    }
  }

  const { data } = await query;
  return NextResponse.json(data || []);
}

/**
 * POST /api/report/scheduled-posts
 * 予約投稿を登録
 */
export const POST = withAudit("予約投稿作成", "DATA_OP", async (request, ctx) => {
  const body = await request.json();
  const { shopId, summary, topicType, photoUrl, actionType, actionUrl, scheduledAt } = body;

  // 写真投稿（topicType=PHOTO）は本文不要・写真URL必須（cronがMedia APIで「写真と動画」に投稿する）
  const isPhotoPost = topicType === "PHOTO";
  if (!shopId || !scheduledAt || (!summary && !isPhotoPost)) {
    return NextResponse.json({ error: "shopId, summary, scheduledAtが必要です" }, { status: 400 });
  }
  if (isPhotoPost && !photoUrl) {
    return NextResponse.json({ error: "写真投稿にはphotoUrlが必要です" }, { status: 400 });
  }

  const shopRes = await requireCtxShopAccessById(ctx, shopId);
  if (shopRes.error) return shopRes.error;

  const supabase = getSupabase();

  const { error } = await supabase.from("scheduled_posts").insert({
    id: crypto.randomUUID(),
    shop_id: shopId,
    shop_name: shopRes.shopName,
    summary: summary || "",
    topic_type: topicType || "STANDARD",
    photo_url: photoUrl || null,
    action_type: actionType || null,
    action_url: actionUrl || null,
    scheduled_at: scheduledAt,
    status: "pending",
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  ctx.detail = `${shopRes.shopName}: ${scheduledAt}に予約${isPhotoPost ? "（写真投稿）" : `「${String(summary).slice(0, 50)}」`}`;
  return NextResponse.json({ success: true });
});

/**
 * DELETE /api/report/scheduled-posts
 * 予約投稿を削除
 */
export const DELETE = withAudit("予約投稿削除", "DATA_OP", async (request, ctx) => {
  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: "idが必要です" }, { status: 400 });

  const supabase = getSupabase();
  // 認可: 投稿のshop_nameから店舗アクセス権を検証
  const { data: post } = await supabase.from("scheduled_posts").select("shop_name").eq("id", id).maybeSingle();
  if (post?.shop_name) {
    const shopErr = await requireCtxShopAccess(ctx, post.shop_name);
    if (shopErr) return shopErr;
  }

  await supabase.from("scheduled_posts").delete().eq("id", id);
  ctx.detail = `${post?.shop_name || "店舗不明"}: id=${id} を削除`;
  return NextResponse.json({ success: true });
});

/**
 * PATCH /api/report/scheduled-posts
 * 予約投稿を更新（編集・リトライ）
 */
export const PATCH = withAudit("予約投稿更新", "DATA_OP", async (request, ctx) => {
  const body = await request.json();
  const { id, summary, scheduledAt, status, approvalStatus } = body;
  if (!id) return NextResponse.json({ error: "idが必要です" }, { status: 400 });

  // 状態値のホワイトリスト（任意文字列の書き込みを防ぐ）
  const ALLOWED_STATUS = ["pending", "on_hold", "rejected", "approved", "posted", "failed"];
  const ALLOWED_APPROVAL = ["pending", "approved", "rejected"];
  if (status !== undefined && !ALLOWED_STATUS.includes(status)) {
    return NextResponse.json({ error: "statusの値が不正です" }, { status: 400 });
  }
  if (approvalStatus !== undefined && !ALLOWED_APPROVAL.includes(approvalStatus)) {
    return NextResponse.json({ error: "approvalStatusの値が不正です" }, { status: 400 });
  }

  const supabase = getSupabase();

  // 認可: 投稿のshop_nameから店舗アクセス権を検証
  const { data: post } = await supabase.from("scheduled_posts").select("shop_name").eq("id", id).maybeSingle();
  if (post?.shop_name) {
    const shopErr = await requireCtxShopAccess(ctx, post.shop_name);
    if (shopErr) return shopErr;
  }

  // 監査ログ: 承認・差戻しは操作名で区別
  if (approvalStatus === "approved") ctx.actionOverride = "予約投稿承認";
  else if (approvalStatus === "rejected") ctx.actionOverride = "予約投稿差戻し";

  const update: Record<string, any> = {};
  if (summary !== undefined) update.summary = summary;
  if (scheduledAt !== undefined) update.scheduled_at = scheduledAt;
  if (status !== undefined) update.status = status;
  if (approvalStatus !== undefined) update.approval_status = approvalStatus;
  if (status === "pending") {
    update.error_detail = null;
    update.approval_status = "pending";
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "更新項目がありません" }, { status: 400 });
  }

  const { error } = await supabase.from("scheduled_posts").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  ctx.detail = `${post?.shop_name || "店舗不明"}: id=${id} 更新項目[${Object.keys(update).join(", ")}]`;
  return NextResponse.json({ success: true });
});

/**
 * PUT /api/report/scheduled-posts
 * 予約投稿を実行（cronから呼ばれる or 手動実行）
 * - cron: x-cron-secret 認証（JWT無し）のため withAudit を通さない
 * - 手動: withAudit("予約投稿一括実行", EXTERNAL_OP) で認可+監査
 */
const PUT_MANUAL = withAudit("予約投稿一括実行", "EXTERNAL_OP", async (request, ctx) => {
  // 手動実行はアクセス権のある店舗の投稿だけを対象にする
  const allowedShops = await getUserAllowedShops(ctx.sub);
  return executeScheduledPosts(request, allowedShops, false, ctx);
});

export async function PUT(request: NextRequest) {
  // 認証: Cron Secret（定数時間比較） or JWT
  const cronSecret = process.env.CRON_SECRET;
  const isCron = !!cronSecret && safeEqual(request.headers.get("x-cron-secret") || "", cronSecret);
  if (isCron) return executeScheduledPosts(request, "all", true, null);
  return PUT_MANUAL(request);
}

async function executeScheduledPosts(
  request: NextRequest,
  allowedShops: string[] | "all",
  isCron: boolean,
  ctx: AuditContext | null,
): Promise<NextResponse> {
  const supabase = getSupabase();
  const now = new Date().toISOString();

  // force=trueの場合、pending/on_hold両方を時刻制限なしで実行（「今すぐ実行」ボタン用）
  let body: any = {};
  try { body = await request.json(); } catch {}
  const force = body?.force === true;

  let query = supabase.from("scheduled_posts").select("*");
  if (force) {
    // UI上「保留（on_hold）は自動実行されません」と案内しているため、
    // 「今すぐ実行」でもpendingのみ対象。保留は「承認→予約」でpendingにしてから実行する
    query = query.eq("status", "pending");
  } else {
    query = query.eq("status", "pending").lte("scheduled_at", now);
  }
  // 手動実行時はアクセス権のある店舗に限定（全店舗一斉公開を防止）
  if (!isCron && allowedShops !== "all") {
    if (allowedShops.length === 0) {
      if (ctx) ctx.detail = "実行対象なし（許可店舗0件）";
      return NextResponse.json({ message: "実行対象なし", executed: 0 });
    }
    query = query.in("shop_name", allowedShops);
  }
  const { data: rawPosts } = await query;

  // 差戻し済み（approval_status=rejected）は実行対象から除外
  // ※NULL比較の罠を避けるためDBフィルタではなくJS側で除外（approval_statusはNULLの行が多い）
  const posts = (rawPosts || []).filter((p) => p.approval_status !== "rejected");

  if (posts.length === 0) {
    if (ctx) ctx.detail = force ? "実行対象なし（今すぐ実行）" : "実行対象なし";
    return NextResponse.json({ message: "実行対象なし", executed: 0 });
  }

  let executed = 0;
  let errors = 0;

  for (const post of posts) {
    try {
      // 二重投稿防止: 現在のstatusからprocessingにクレーム。競合実行が先に取っていたらスキップ
      const { data: claimed } = await supabase
        .from("scheduled_posts")
        .update({ status: "processing", processing_started_at: new Date().toISOString() })
        .eq("id", post.id)
        .eq("status", post.status)
        .select("id");
      if (!claimed || claimed.length === 0) continue; // 他の実行が先にクレーム済み

      if (!post.shop_id) {
        await supabase.from("scheduled_posts").update({ status: "error", error_detail: "shop_idなし" }).eq("id", post.id);
        errors++; continue;
      }

      // 写真URLをGBPがfetch可能な公開URLに変換（cron/execute-postsと同じ方式）
      // Dropbox共有リンク(www.dropbox.com)のままだとGBPがHTMLを取得して失敗する
      if (post.photo_url) {
        const { resolveImageUrl } = await import("@/lib/image-proxy");
        const resolvedUrl = await resolveImageUrl(post.photo_url, post.id);
        if (resolvedUrl) {
          post.photo_url = resolvedUrl;
        } else if (post.topic_type === "PHOTO") {
          await supabase.from("scheduled_posts").update({ status: "error", error_detail: "写真URL変換失敗（Dropboxから画像取得不可）" }).eq("id", post.id);
          errors++; continue;
        } else {
          post.photo_url = null; // 通常投稿は写真なしで続行
        }
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

  if (ctx) ctx.detail = `${force ? "今すぐ実行: " : ""}実行${executed}件/エラー${errors}件（対象${posts.length}件）`;
  return NextResponse.json({ executed, errors, total: posts.length });
}
