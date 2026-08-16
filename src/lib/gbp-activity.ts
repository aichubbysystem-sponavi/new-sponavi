/**
 * レポート「先月の実施内容」用のデータ取得。
 *
 * 出す数字は3つ:
 *   投稿数        … GBPの localPosts 一覧（gbp_posts テーブルに保存）
 *   口コミ返信件数 … reviews.reply_time（既存データ。追加同期は不要）
 *   写真投稿枚数   … GBPのメディア一覧（既存 media テーブルに保存）
 *
 * 【設計メモ】
 * 1. 投稿数を post_logs から出してはいけない。
 *    post_logs はこのシステム経由の投稿しか記録しておらず、2026-07は48件/10店舗しかない。
 *    同じ月にGBP側では投稿されている店舗が多数ある（実測）。GBPを正とする。
 * 2. 写真の閲覧数はGoogleが返さない（v4 media の insights は空、Performance APIにも指標なし）。
 *    2026-04の調査結論を2026-08-15に再実測して確認済み。閲覧数の欄は作らない。
 * 3. 画像URLは保存しても数日で403になり、リソース名すら付け替えられることがある
 *    （2026-08-09の調査）。よってDBには件数と本文だけを保存し、
 *    レポートに出す画像URLは表示のたびにGBPから取り直す。
 * 4. 一覧APIは新しい順に返る。対象月まで遡ったらページングを止める
 *    （1店舗あたり通常1ページ＝1リクエストで済む）。
 */

import { getSupabase } from "@/lib/supabase";
import { getOAuthToken, getAllOAuthTokens } from "@/lib/gbp-token";
import { resolveLocationName } from "@/lib/gbp-location";
import { monthRangeIso, prevMonthLabel } from "@/lib/month-utils";

export { monthRangeIso, prevMonthLabel };

const GBP_API_BASE = "https://mybusiness.googleapis.com/v4";
const PAGE_SIZE = 100;
/**
 * 遡りの上限。1ページ100件＝投稿なら約1年分あるので通常は1ページで終わる。
 * レポートAPIの maxDuration は60秒。1リクエスト12秒 × 2ページ × 2種(投稿/写真) = 最悪48秒に収める
 */
const MAX_PAGES = 2;
/** トークンから見えないロケーションの可能性がある応答（本番はGBPアカウントが15個ある） */
const TOKEN_RETRY_STATUSES = [401, 403, 404];

/** レポートに載せる写真1枚。投稿に添付した写真と、写真タブへ追加した写真の両方が入る */
export interface ActivityPhoto {
  /** 閲覧数の保存キー。投稿写真は gbp_posts.post_name、写真タブは media.media_name */
  key: string;
  source: "post" | "media";
  /** 表示時に取り直した有効なURL（保存済みURLは失効するので使わない） */
  url: string;
  /**
   * 一覧表示用の軽いURL。実測(2026-08-15):
   *   投稿の写真   … googleUrl+"=w400" で 49KB→27KB
   *   写真タブ     … thumbnailUrl で 101KB→23KB（こちらは =w400 を付けると400になる）
   * 22枚並ぶページで1.6MB→0.5MBになるので、読み込みの体感がここで決まる
   */
  thumbUrl: string;
  createTime: string;
  /** 手入力の閲覧数。null = 未計測（Googleは写真ごとの閲覧数を返さない） */
  viewCount: number | null;
}

/** 1レポートに載せる写真の上限。20枚/ページなので10ページぶん */
export const MAX_PHOTO_ITEMS = 200;

export interface MonthlyActivity {
  month: string;
  posts: number;
  postsPrev: number;
  photos: number;
  photosPrev: number;
  replies: number;
  repliesPrev: number;
  /** その月に公開した写真すべて（閲覧数の多い順・未計測は末尾）。最大 MAX_PHOTO_ITEMS 枚 */
  photoItems: ActivityPhoto[];
  /** 上限を超えて載せられなかった枚数。黙って切らずに件数を出す */
  photoTruncated: number;
  /** true = 件数だけ返した高速応答。写真は続けて取りに行く必要がある */
  photosPending: boolean;
  /** GBPから取り直せなかった場合の理由。数字はDB値で出しつつ画像だけ欠ける状態を隠さない */
  photoError: string | null;
}

/** 同期の戻り値。取得した一覧をそのまま返して、表示側で新鮮なURLを使い回す */
interface SyncResult {
  posts: number;
  media: number;
  postItems: LocalPostItem[];
  mediaItems: MediaItemLite[];
  error: string | null;
}

// ── GBP API ──

interface LocalPostItem {
  name?: string;
  createTime?: string;
  updateTime?: string;
  topicType?: string;
  state?: string;
  summary?: string;
  searchUrl?: string;
  media?: { name?: string; mediaFormat?: string; googleUrl?: string; thumbnailUrl?: string }[];
}

interface MediaItemLite {
  name?: string;
  createTime?: string;
  mediaFormat?: string;
  googleUrl?: string;
  thumbnailUrl?: string;
  description?: string;
  locationAssociation?: { category?: string };
}

/**
 * 既定トークンで叩き、401/403/404 のときだけ予備トークンで再試行する。
 * 予備トークンの取得は高価なので、1回の同期で最大1度しか取りに行かない。
 */
function makeGbpFetcher(primary: string) {
  let extras: string[] | null = null;
  const deadLocations = new Set<string>();

  return async function gbpGet(url: string, location: string): Promise<{ ok: boolean; status: number; body: any }> {
    const call = async (token: string) => {
      const res = await fetch(url, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(12000),
      });
      const body = res.ok ? await res.json().catch(() => ({})) : await res.text().catch(() => "");
      return { ok: res.ok, status: res.status, body };
    };

    let r = await call(primary);
    if (r.ok || !TOKEN_RETRY_STATUSES.includes(r.status) || deadLocations.has(location)) return r;

    if (extras === null) extras = (await getAllOAuthTokens().catch(() => [])).filter(t => t && t !== primary);
    for (const token of extras) {
      r = await call(token);
      if (r.ok) return r;
      if (!TOKEN_RETRY_STATUSES.includes(r.status)) return r;
    }
    deadLocations.add(location);
    return r;
  };
}

type GbpGet = ReturnType<typeof makeGbpFetcher>;

/**
 * 一覧を新しい順に取得する。sinceIso より古いページに入ったら打ち切る。
 * 打ち切りの判定はページ末尾の要素で行う（同一ページ内の古い分も返して呼び出し側で絞る）。
 */
async function fetchList<T extends { createTime?: string }>(
  gbpGet: GbpGet,
  fullPath: string,
  path: "localPosts" | "media",
  key: "localPosts" | "mediaItems",
  sinceIso: string,
): Promise<{ items: T[]; error: string | null }> {
  const items: T[] = [];
  let pageToken = "";
  const sinceMs = Date.parse(sinceIso);

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${GBP_API_BASE}/${fullPath}/${path}?pageSize=${PAGE_SIZE}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
    const r = await gbpGet(url, fullPath);
    if (!r.ok) {
      const detail = typeof r.body === "string" ? r.body.slice(0, 150) : "";
      // 1ページ目で失敗＝データなしと区別できないので、必ず理由を返す
      return { items, error: `${path} HTTP ${r.status}${detail ? `: ${detail}` : ""}` };
    }
    const batch: T[] = r.body?.[key] || [];
    items.push(...batch);
    pageToken = r.body?.nextPageToken || "";
    if (!pageToken || batch.length === 0) break;

    const oldest = batch[batch.length - 1]?.createTime;
    if (oldest && Date.parse(oldest) < sinceMs) break; // 対象期間より古い領域に入った
  }

  return { items, error: null };
}

// ── 同期（DB保存） ──

function inRange(iso: string | undefined, startIso: string, endIso: string): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t >= Date.parse(startIso) && t < Date.parse(endIso);
}

export interface ShopRef {
  id: string;
  name: string;
  gbp_location_name: string | null;
}

/**
 * 1店舗ぶんのGBP実績を sinceIso 以降について同期する。
 * @returns 保存した件数と、取得できなかった場合の理由
 */
export async function syncShopActivity(
  shop: ShopRef,
  gbpGet: GbpGet,
  sinceIso: string,
): Promise<SyncResult> {
  if (!shop.gbp_location_name) return { posts: 0, media: 0, postItems: [], mediaItems: [], error: "gbp_location_name未設定" };

  const fullPath = shop.gbp_location_name.startsWith("accounts/")
    ? shop.gbp_location_name
    : await resolveLocationName(shop.gbp_location_name);
  if (!fullPath) return { posts: 0, media: 0, postItems: [], mediaItems: [], error: "ロケーション解決失敗" };

  const supabase = getSupabase();
  const sinceMs = Date.parse(sinceIso);
  let postCount = 0;
  let mediaCount = 0;
  const errors: string[] = [];

  // 投稿一覧と写真一覧は独立しているので同時に取る（逐次だと実測1.3秒、並列で0.7秒）
  const [postRes, mediaRes] = await Promise.all([
    fetchList<LocalPostItem>(gbpGet, fullPath, "localPosts", "localPosts", sinceIso),
    fetchList<MediaItemLite>(gbpGet, fullPath, "media", "mediaItems", sinceIso),
  ]);

  // ── 投稿 ──
  if (postRes.error) errors.push(postRes.error);
  const postRows = postRes.items
    .filter(p => p.name && p.createTime && Date.parse(p.createTime) >= sinceMs)
    .map(p => {
      const m = (p.media || [])[0] || {};
      return {
        post_name: p.name!,
        shop_id: shop.id,
        shop_name: shop.name,
        create_time: p.createTime!,
        update_time: p.updateTime || null,
        topic_type: p.topicType || null,
        state: p.state || null,
        summary: p.summary || null,
        search_url: p.searchUrl || null,
        media_name: m.name || null,
        media_format: m.mediaFormat || null,
        media_url: m.googleUrl || m.thumbnailUrl || null,
        synced_at: new Date().toISOString(),
      };
    });
  for (let i = 0; i < postRows.length; i += 50) {
    const { error } = await supabase.from("gbp_posts").upsert(postRows.slice(i, i + 50), { onConflict: "post_name" });
    if (error) errors.push(`gbp_posts保存: ${error.message}`);
    else postCount += Math.min(50, postRows.length - i);
  }

  // ── 写真（既存 media テーブルを流用） ──
  if (mediaRes.error) errors.push(mediaRes.error);
  const mediaRows = mediaRes.items
    .filter(m => m.name && m.createTime && Date.parse(m.createTime) >= sinceMs)
    .map(m => ({
      shop_id: shop.id,
      shop_name: shop.name,
      media_name: m.name!,
      google_url: m.googleUrl || null,
      thumbnail_url: m.thumbnailUrl || null,
      category: m.locationAssociation?.category || "ADDITIONAL",
      // view_count は書かない。Googleは閲覧数を返さないので、この列は手動入力の置き場として使う。
      // ここで0を入れると同期のたびに手入力値を消してしまう（列の既定値は0なので新規行は0で入る）
      description: m.description || null,
      create_time: m.createTime || null,
      synced_at: new Date().toISOString(),
    }));
  for (let i = 0; i < mediaRows.length; i += 50) {
    const { error } = await supabase.from("media").upsert(mediaRows.slice(i, i + 50), { onConflict: "media_name" });
    if (error) errors.push(`media保存: ${error.message}`);
    else mediaCount += Math.min(50, mediaRows.length - i);
  }

  // 取得した一覧をそのまま返す。写真URLは失効するので、この場で得た新鮮なURLを
  // レポート表示にも使い回す（同じ一覧を2回叩かないため）
  return {
    posts: postCount, media: mediaCount,
    postItems: postRes.items, mediaItems: mediaRes.items,
    error: errors.length ? errors.join(" / ") : null,
  };
}

/** 同期用のfetcherを作る（トークン取得は呼び出し側で1回だけ） */
export async function createGbpFetcher(): Promise<GbpGet | null> {
  const token = await getOAuthToken();
  if (!token) return null;
  return makeGbpFetcher(token);
}

// ── 集計（レポート表示用） ──

async function countPosts(shopId: string, startIso: string, endIso: string): Promise<number> {
  const supabase = getSupabase();
  const { count, error } = await supabase
    .from("gbp_posts")
    .select("post_name", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .gte("create_time", startIso)
    .lt("create_time", endIso);
  if (error) throw new Error(`投稿数の集計に失敗: ${error.message}`);
  return count || 0;
}

async function countMedia(shopId: string, startIso: string, endIso: string): Promise<number> {
  const supabase = getSupabase();
  const { count, error } = await supabase
    .from("media")
    .select("media_name", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .gte("create_time", startIso)
    .lt("create_time", endIso);
  if (error) throw new Error(`写真枚数の集計に失敗: ${error.message}`);
  return count || 0;
}

/**
 * 口コミ返信件数。reply_time はGoogleが返す「返信の更新日時」なので、
 * 古い口コミに先月返信した分もその月に計上される（＝先月やった仕事の件数）。
 * 自動返信(cron/auto-reply)は reply_comment しか書かないが、
 * 毎時の sync-reviews がGoogle側の updateTime で reply_time を埋めるため実質ズレない。
 */
async function countReplies(shopId: string, startIso: string, endIso: string): Promise<number> {
  const supabase = getSupabase();
  const { count, error } = await supabase
    .from("reviews")
    .select("review_id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .gte("reply_time", startIso)
    .lt("reply_time", endIso);
  if (error) throw new Error(`返信件数の集計に失敗: ${error.message}`);
  return count || 0;
}

/**
 * レポートの「実施内容」＋「投稿写真一覧」に必要なデータを返す。
 *
 * 数字はDB（gbp_posts / media / reviews）から、写真URLはGBPから取り直したものを使う。
 * 保存済みURLは数日で403になるため、表示のたびに取り直すのが唯一確実な方法
 * （2026-08-09の調査。ルート側で10分キャッシュしているので毎回は叩かない）。
 */
export async function getMonthlyActivity(
  shop: ShopRef,
  month: string,
  opts: { fast?: boolean } = {},
): Promise<MonthlyActivity> {
  const range = monthRangeIso(month);
  const prev = prevMonthLabel(month);
  const prevRange = monthRangeIso(prev);
  if (!range || !prevRange) throw new Error(`月の指定が不正です: ${month}`);

  const supabase = getSupabase();
  let photoError: string | null = null;
  let postItems: LocalPostItem[] = [];
  let mediaItems: MediaItemLite[] = [];

  // fast: DBの件数だけ返す（GBPを一切叩かない＝実測3秒→0.3秒）。
  // 画面はまず件数を出し、写真は続けて通常モードで取りに行く。
  // 写真URLは数日で失効するため、写真を出すにはGBPを叩く以外に方法がない。
  if (!opts.fast) {
    // 前月分まで取り直して保存する。前月比を出すのと、過去月のレポートを開いたときに
    // 「まだ同期していないから0件」になるのを防ぐため
    const gbpGet = await createGbpFetcher();
    if (!gbpGet) {
      photoError = "GBPのトークンを取得できませんでした";
    } else {
      const r = await syncShopActivity(shop, gbpGet, prevRange.startIso);
      if (r.error) photoError = r.error;
      postItems = r.postItems;
      mediaItems = r.mediaItems;
    }
  }

  const [posts, postsPrev, photos, photosPrev, replies, repliesPrev] = await Promise.all([
    countPosts(shop.id, range.startIso, range.endIso),
    countPosts(shop.id, prevRange.startIso, prevRange.endIso),
    countMedia(shop.id, range.startIso, range.endIso),
    countMedia(shop.id, prevRange.startIso, prevRange.endIso),
    countReplies(shop.id, range.startIso, range.endIso),
    countReplies(shop.id, prevRange.startIso, prevRange.endIso),
  ]);

  if (opts.fast) {
    return {
      month, posts, postsPrev, photos, photosPrev, replies, repliesPrev,
      photoItems: [], photoTruncated: 0, photosPending: true, photoError: null,
    };
  }

  // ── 手入力の閲覧数を読む（Googleは閲覧数を返さないので、この2列だけが情報源） ──
  const [postViews, mediaViews] = await Promise.all([
    supabase.from("gbp_posts").select("post_name, view_count")
      .eq("shop_id", shop.id).gte("create_time", range.startIso).lt("create_time", range.endIso),
    supabase.from("media").select("media_name, view_count")
      .eq("shop_id", shop.id).gte("create_time", range.startIso).lt("create_time", range.endIso),
  ]);
  const viewOf = new Map<string, number | null>();
  for (const r of postViews.data || []) viewOf.set(r.post_name, r.view_count ?? null);
  for (const r of mediaViews.data || []) viewOf.set(r.media_name, r.view_count ?? null);

  // ── その月に公開した写真をすべて集める（投稿に添付した写真＋写真タブへの追加） ──
  const items: ActivityPhoto[] = [];
  for (const p of postItems) {
    if (!p.name || !inRange(p.createTime, range.startIso, range.endIso)) continue;
    const m = (p.media || [])[0];
    const url = m?.googleUrl || m?.thumbnailUrl;
    if (!url) continue; // 文章だけの投稿
    items.push({
      key: p.name, source: "post", url,
      // 投稿由来のURLはサイズ指定を受け付ける（実測200）。メディア由来は400になるので付けない
      thumbUrl: m?.googleUrl ? `${m.googleUrl}=w400` : url,
      createTime: p.createTime!,
      viewCount: viewOf.get(p.name) ?? null,
    });
  }
  for (const m of mediaItems) {
    if (!m.name || !inRange(m.createTime, range.startIso, range.endIso)) continue;
    const url = m.googleUrl || m.thumbnailUrl;
    if (!url) continue;
    items.push({
      key: m.name, source: "media", url,
      thumbUrl: m.thumbnailUrl || url,
      createTime: m.createTime!,
      viewCount: viewOf.get(m.name) ?? null,
    });
  }

  // 閲覧数の多い順。未入力(未計測)は末尾へ。同数・未入力どうしは新しい順
  items.sort((a, b) => {
    const av = a.viewCount, bv = b.viewCount;
    if (av != null && bv != null && av !== bv) return bv - av;
    if (av != null && bv == null) return -1;
    if (av == null && bv != null) return 1;
    return Date.parse(b.createTime) - Date.parse(a.createTime);
  });

  return {
    month, posts, postsPrev, photos, photosPrev, replies, repliesPrev,
    photoItems: items.slice(0, MAX_PHOTO_ITEMS),
    photoTruncated: Math.max(0, items.length - MAX_PHOTO_ITEMS),
    photosPending: false,
    photoError,
  };
}
