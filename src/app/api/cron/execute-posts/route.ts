import { NextRequest, NextResponse } from "next/server";
import { getSupabase, verifyCron } from "@/lib/supabase";
import { getOAuthToken, getAllOAuthTokens } from "@/lib/gbp-token";
import { resolveLocationName } from "@/lib/gbp-location";
import { resolveImageUrl, cleanupImage } from "@/lib/image-proxy";
import { detectMediaFormat } from "@/lib/media-format";
import { explainGbpError, ERROR_DETAIL_MAX } from "@/lib/gbp-error-ja";
import { kickCron } from "@/lib/auto-post/worker-kick";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const GO_API_URL = process.env.NEXT_PUBLIC_API_URL || "";
const GBP_API_BASE = "https://mybusiness.googleapis.com/v4";

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
      cache: "no-store" as const,
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
    return { ok: false, error: explainGbpError("Go API", res.status, errText) };
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
    if (byName?.gbp_location_name) {
      shopLocName = byName.gbp_location_name;
    } else {
      // GBP上の店名で登録されているケース（GBP改名後にシート側を新名に直した場合）
      const { data: byGbpName } = await supabase.from("shops")
        .select("gbp_location_name").eq("gbp_shop_name", post.shop_name)
        .not("gbp_location_name", "is", null).limit(1).maybeSingle();
      if (byGbpName?.gbp_location_name) shopLocName = byGbpName.gbp_location_name;
    }
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
      cache: "no-store" as const,
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
        cache: "no-store" as const,
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
    return { ok: false, error: explainGbpError("GBP API", res.status, errText) };
  } catch (e: any) {
    return { ok: false, error: e?.message || "通信エラー" };
  }
}

/** 写真投稿: Go API media_direct 経由でMedia APIアップロード（「写真と動画」セクションに投稿） */
async function uploadPhotoViaGoApi(
  shopId: string, post: any
): Promise<{ ok: boolean; name?: string; error?: string }> {
  if (!post.photo_url) return { ok: false, error: "写真URLなし" };

  const body = {
    source_url: post.photo_url,
    category: "ADDITIONAL",
  };

  try {
    const res = await fetch(`${GO_API_URL}/api/shop/${shopId}/media_direct`, {
      cache: "no-store" as const,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    if (res.ok) {
      const result = await res.json().catch(() => ({}));
      return { ok: true, name: result?.name || "media-uploaded" };
    }
    const errText = await res.text().catch(() => "");
    return { ok: false, error: explainGbpError("Go API media_direct", res.status, errText, { isMedia: true }) };
  } catch (e: any) {
    return { ok: false, error: `Go API通信エラー: ${e?.message}` };
  }
}

/** 写真・動画投稿: 直接Media APIでアップロード（フォールバック） */
async function uploadPhotoDirectMediaApi(
  post: any, accessToken: string, locationName: string
): Promise<{ ok: boolean; name?: string; error?: string }> {
  if (!post.photo_url) return { ok: false, error: "写真URLなし" };

  try {
    const res = await fetch(`${GBP_API_BASE}/${locationName}/media`, {
      cache: "no-store" as const,
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      // 予約時に image-proxy が拡張子を保って保存しているのでURLから形式を判定できる
      body: JSON.stringify({ mediaFormat: detectMediaFormat(post.photo_url) || "PHOTO", sourceUrl: post.photo_url, locationAssociation: { category: "ADDITIONAL" } }),
      signal: AbortSignal.timeout(60000),
    });
    if (res.ok) {
      const result = await res.json().catch(() => ({}));
      return { ok: true, name: result?.name || "media-uploaded" };
    }
    const errText = await res.text().catch(() => "");
    return { ok: false, error: explainGbpError("GBP Media API", res.status, errText, { isMedia: true }) };
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
  const cronErr = verifyCron(request); if (cronErr) return cronErr;

  const supabase = getSupabase();
  const now = new Date().toISOString();

  // processing開始から5分以上経過したレコードをpendingに戻す（クラッシュリカバリ）
  const staleThreshold = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  await supabase
    .from("scheduled_posts")
    .update({ status: "pending", processing_started_at: null })
    .eq("status", "processing")
    .lt("processing_started_at", staleThreshold);

  const { data: rawPosts } = await supabase
    .from("scheduled_posts")
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_at", now)
    .order("scheduled_at", { ascending: true })
    // 300店舗×3枚=900行/回の運用。1分ずらしの2〜3枚目が同じcron回に600行まとまるため500では足りない
    .limit(1000);

  // 差戻し済み（approval_status=rejected）は実行対象から除外
  // ※NULL比較の罠を避けるためDBフィルタではなくJS側で除外（approval_statusはNULLの行が多い）
  const posts = (rawPosts || []).filter((p) => p.approval_status !== "rejected");

  if (posts.length === 0) {
    console.log("[cron/execute-posts] 実行対象なし");
    return NextResponse.json({ success: true, message: "実行対象なし", posted: 0 });
  }

  const goToken = await getOAuthToken();
  const startTime = Date.now();
  const CONCURRENCY = 10;
  let posted = 0, errors = 0;

  async function processPost(post: any): Promise<void> {
    try {
      // 二重実行防止: pending→processingにクレーム。他のcron実行と競合した場合は何もしない
      const { data: claimed } = await supabase
        .from("scheduled_posts")
        .update({ status: "processing", processing_started_at: new Date().toISOString() })
        .eq("id", post.id)
        .eq("status", "pending")
        .select("id");
      if (!claimed || claimed.length === 0) return; // 他の実行が先にクレーム済み

      if (!post.shop_id) {
        await supabase.from("scheduled_posts").update({
          status: "error", error_detail: "shop_idなし",
        }).eq("id", post.id);
        errors++; return;
      }

      // Dropbox一時URLを安定した公開URLに変換
      if (post.photo_url) {
        // 拡張子を保つためファイル名代わりに元URLを渡す（動画/写真の判定に使う）
        const resolvedUrl = await resolveImageUrl(post.photo_url, post.id, post.photo_url);
        if (resolvedUrl) {
          post.photo_url = resolvedUrl;
        } else {
          console.log(`[cron] ${post.shop_name}: 画像URL解決失敗、写真なしで投稿`);
          post.photo_url = null;
        }
      }

      let result: { ok: boolean; name?: string; error?: string };

      if (post.topic_type === "PHOTO") {
        // === 写真・動画投稿 ===
        // 動画は Go API media_direct が mediaFormat を写真固定で送るため使えない。直接Media APIに任せる
        const isVideo = detectMediaFormat(post.photo_url || "") === "VIDEO";
        // 1. Go API media_direct 経由（店舗別トークンで「写真と動画」セクションに投稿）
        result = isVideo
          ? { ok: false, error: "動画のためGo APIを経由せず直接Media APIを使う" }
          : await uploadPhotoViaGoApi(post.shop_id, post);

        // 2. Go API失敗 → 直接Media API（全トークンを順番に試す）
        if (!result.ok) {
          const locationName = await getLocationName(post, supabase);
          if (locationName) {
            console.log(`[cron] ${post.shop_name}: Go API失敗(${result.error?.slice(0, 60)})、直接Media APIにフォールバック`);
            const allTokens = await getAllOAuthTokens();
            for (const token of allTokens) {
              result = await uploadPhotoDirectMediaApi(post, token, locationName);
              if (result.ok) break;
            }
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
          status: "error", error_detail: result.error?.slice(0, ERROR_DETAIL_MAX),
        }).eq("id", post.id);
        errors++;
      }
    } catch (e: any) {
      try {
        await supabase.from("scheduled_posts").update({
          status: "error", error_detail: (e?.message || "不明な例外").slice(0, ERROR_DETAIL_MAX),
        }).eq("id", post.id);
      } catch (dbErr: any) {
        // DB更新自体が失敗した場合、ログ出力して次回のstaleリカバリに委ねる
        console.error(`[cron/execute-posts] DB更新失敗 post=${post.id}: ${dbErr?.message}`);
      }
      errors++;
    }
  }

  let carried = 0; // 時間切れで次回に持ち越した件数
  for (let i = 0; i < posts.length; i += CONCURRENCY) {
    // 打ち切りは210秒。Vercelの上限300秒に対し、走らせ始めた1バッチ（Media API直叩き最大60秒×フォールバック）が
    // 収まる余裕を残す。270秒だと関数ごとkillされて processing のまま固着→次回のstaleリカバリで再送（二重投稿の温床）になる
    if (Date.now() - startTime > 210_000) {
      carried = posts.length - i;
      console.log(`[cron] タイムアウト: ${carried}件を次回に持ち越し`);
      break;
    }
    const batch = posts.slice(i, i + CONCURRENCY);
    await Promise.allSettled(batch.map(processPost));
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const allFailed = posted === 0 && errors > 0;
  console.log(`[cron/execute-posts] posted: ${posted}, errors: ${errors}, elapsed: ${elapsed}s${allFailed ? " [ALL FAILED]" : ""}`);
  // 持ち越しがあれば5分後のcronを待たずに続きを起動する（300店舗×3枚=900行を数十分で消化するため）。
  // 各行は pending→processing の条件付き更新で占有するので、5分cronと重なっても二重投稿にはならない
  if (carried > 0 && !allFailed) await kickCron(request, "/api/cron/execute-posts");
  return NextResponse.json(
    { success: !allFailed, posted, errors, total: posts.length, carried, elapsed },
    { status: allFailed ? 500 : 200 }
  );
}
