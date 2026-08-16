/**
 * GET /api/cron/sync-activity
 * GBPの投稿一覧・写真一覧を同期して gbp_posts / media に保存する。
 * レポートの「先月の実施内容」ページの数字の元になる。
 *
 * Vercel Cron: 毎日 3:00 JST（UTC 18:00）
 *
 * 【なぜ毎日で、なぜ全店を1回で回さないのか】
 * 1店舗あたり localPosts + media の2リクエストで約1.5秒。GBP連携は759店舗あるので
 * 全店で約19分かかり、Vercelの maxDuration(300秒) には収まらない。
 * sync-reviews と同じ sync_progress のオフセット方式で毎日続きから処理し、
 * 数日で一巡させる。レポート表示時にも足りない店舗はその場で同期される
 * （lib/gbp-activity.ts の getMonthlyActivity）ので、遅れても数字は正しく出る。
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabase, verifyCron } from "@/lib/supabase";
import { createGbpFetcher, syncShopActivity, storeMissingPhotos, monthRangeIso, prevMonthLabel, type ShopRef } from "@/lib/gbp-activity";
import { jstNow } from "@/lib/jst-date";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const JOB = "sync-activity";
const TIME_LIMIT = 270_000;
/** 1店舗あたり写真の取り込みに使ってよい時間。20枚で約1秒なので余裕を見て6秒 */
const PHOTO_BUDGET_MS = 6_000;

async function getOffset(): Promise<number> {
  const supabase = getSupabase();
  try {
    const { data } = await supabase.from("sync_progress")
      .select("offset_value, updated_at").eq("job_name", JOB).maybeSingle();
    if (data) {
      // 24時間以上前のオフセットは信用しない（店舗の増減で位置がずれるため最初から）
      const age = Date.now() - new Date(data.updated_at).getTime();
      if (age < 24 * 60 * 60 * 1000) return data.offset_value || 0;
    }
  } catch (e: any) {
    console.log(`[cron/${JOB}] オフセット取得失敗:`, e?.message);
  }
  return 0;
}

async function saveOffset(offset: number): Promise<void> {
  const supabase = getSupabase();
  try {
    await supabase.from("sync_progress").upsert({
      job_name: JOB, offset_value: offset, updated_at: new Date().toISOString(),
    }, { onConflict: "job_name" });
  } catch (e: any) {
    console.log(`[cron/${JOB}] オフセット保存失敗:`, e?.message);
  }
}

export async function GET(request: NextRequest) {
  const cronErr = verifyCron(request);
  if (cronErr) return cronErr;

  const startTime = Date.now();
  const supabase = getSupabase();

  const { data: shops, error } = await supabase
    .from("shops")
    .select("id, name, gbp_location_name")
    .not("gbp_location_name", "is", null)
    .neq("gbp_location_name", "")
    .is("cancelled_at", null)
    .order("id", { ascending: true });

  if (error || !shops || shops.length === 0) {
    return NextResponse.json({ error: error?.message || "対象店舗なし" }, { status: 200 });
  }

  // 当月と前月をカバーする範囲を同期する（レポートは前月比を出すため2ヶ月必要）
  const now = jstNow();
  const curMonth = `${now.getUTCFullYear()}/${now.getUTCMonth() + 1}`;
  const since = monthRangeIso(prevMonthLabel(curMonth));
  if (!since) return NextResponse.json({ error: "月範囲の算出に失敗" }, { status: 500 });

  const gbpGet = await createGbpFetcher();
  if (!gbpGet) return NextResponse.json({ error: "OAuthトークンを取得できませんでした" }, { status: 500 });

  // force=true で先頭から、offset=N で位置を指定
  const forceParam = request.nextUrl.searchParams.get("force") === "true";
  const offsetParam = request.nextUrl.searchParams.get("offset");
  let offset = forceParam ? 0 : offsetParam ? parseInt(offsetParam, 10) || 0 : await getOffset();
  if (offset >= shops.length) offset = 0;

  let processed = 0;
  let posts = 0;
  let media = 0;
  let storedPhotos = 0;
  const failures: { shop: string; error: string }[] = [];
  let i = offset;

  for (; i < shops.length; i++) {
    if (Date.now() - startTime > TIME_LIMIT) break;
    const shop = shops[i] as ShopRef;
    try {
      const r = await syncShopActivity(shop, gbpGet, since.startIso);
      posts += r.posts;
      media += r.media;
      if (r.error) failures.push({ shop: shop.name, error: r.error });
      // 写真の実体を自前ストレージへ取り込む。ここが一周すると
      // レポート表示時にGBPを叩かなくて済む（＝速く、URL失効でも写真が消えない）
      storedPhotos += await storeMissingPhotos(shop, since.startIso, r.postItems, r.mediaItems, PHOTO_BUDGET_MS);
    } catch (e: any) {
      failures.push({ shop: shop.name, error: e?.message || "unknown" });
    }
    processed++;
  }

  const nextOffset = i >= shops.length ? 0 : i;
  await saveOffset(nextOffset);

  // 失敗を握りつぶすと「投稿0件」と区別できなくなるのでログに残す
  if (failures.length > 0) {
    console.error(`[cron/${JOB}] ${failures.length}件失敗:`, failures.slice(0, 5));
  }
  console.log(`[cron/${JOB}] ${processed}店舗処理 (offset ${offset}→${nextOffset}) 投稿${posts}件 写真${media}件 画像保存${storedPhotos}枚 失敗${failures.length}件`);

  return NextResponse.json({
    success: true,
    total: shops.length,
    processed, posts, media, storedPhotos,
    offset, nextOffset,
    failed: failures.length,
    failures: failures.slice(0, 20),
    elapsedMs: Date.now() - startTime,
  });
}
