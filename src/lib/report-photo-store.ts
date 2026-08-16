/**
 * レポートに載せる写真を自前のストレージ（Supabase Storage）に保存する。
 *
 * 【なぜ必要か】
 * GBPが返す画像URLは永続ではなく数日で403になる（2026-08-09の実測。403でも
 * 「画像なし」の灰色PNGが200で返るので壊れたことに気づけない）。メディアの
 * リソース名すら付け替えられることがある。
 * そのためURLをDBに保存しても意味がなく、レポートを開くたびにGBPから取り直していた。
 *
 * 画像の「実体」を自前に持てば:
 *   - 表示時にGoogleを一切叩かない（1店舗あたり約1秒の短縮）
 *   - PDFに写真が必ず残る（後から開いても消えない）
 *   - GBP側で写真を削除されても過去のレポートは崩れない
 *
 * 【2種類保存する理由】実測(2026-08-16):
 *   一覧用サムネイル … 投稿=googleUrl+"=w400" 27KB / 写真タブ=thumbnailUrl 23KB(300px)
 *   拡大表示用       … 投稿=googleUrl 49KB(512px) / 写真タブ=googleUrl 101KB(785px)
 *   ※ 写真タブのURLはサイズ指定(=w800等)を付けると400になるため原寸を使う。
 *   一覧を原寸で並べると1ページ1.5MBになり読み込みが目に見えて遅くなるので分ける。
 *   合計で1枚あたり約100KB。全759店舗×月20枚で月1.5GB（Pro 100GB枠内）。
 */

import crypto from "crypto";
import { getSupabase } from "@/lib/supabase";

export const PHOTO_BUCKET = "report-photos";

/** 同時ダウンロード数。多くしてもGoogle側で詰まるだけなので控えめにする */
const CONCURRENCY = 6;
/** 1枚あたりの取得タイムアウト */
const FETCH_TIMEOUT_MS = 8000;
/** これを超えるものは想定外として保存しない */
const MAX_BYTES = 5 * 1024 * 1024;
/**
 * 失効したURLは403でも200x200の「画像なし」PNG(818バイト)を返す。
 * それを保存すると灰色の画像が永久に残るので、明らかに小さいものは弾く
 */
const MIN_BYTES = 2000;

/** 保存済み画像の公開URL。バケットは public なので署名不要 */
export function publicPhotoUrl(path: string): string {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  return `${base}/storage/v1/object/public/${PHOTO_BUCKET}/${path}`;
}

/**
 * 保存パス。GBPのリソース名は長すぎるのでハッシュにする。
 * 店舗・月で分けておくと、後から月単位で数える・消すのが楽になる。
 */
export function photoPath(shopId: string, month: string, key: string, full = false): string {
  const hash = crypto.createHash("sha1").update(key).digest("hex");
  const ym = month.replace("/", "-");
  return `${shopId}/${ym}/${hash}${full ? "_full" : ""}.jpg`;
}

export interface StorablePhoto {
  key: string;
  source: "post" | "media";
  /** 一覧用の軽い画像のURL（GBPの一時URL。失効前提） */
  fetchUrl: string;
  /** 拡大表示用の画像のURL。省略時は fetchUrl と同じ扱い */
  fullUrl?: string;
}

export interface StoredPaths {
  path: string;
  fullPath: string | null;
}

async function download(url: string): Promise<Buffer | null> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < MIN_BYTES || buf.length > MAX_BYTES) return null;
  return buf;
}

/**
 * まだ保存されていない写真をダウンロードしてストレージに入れ、DBにパスを記録する。
 * 締め切りを過ぎたら残りは諦める（レポートの表示を待たせないため）。
 *
 * @returns key → 保存パス のマップ（今回保存できたものだけ）
 */
export async function storePhotos(
  shopId: string,
  month: string,
  photos: StorablePhoto[],
  deadlineMs: number,
): Promise<Map<string, StoredPaths>> {
  const supabase = getSupabase();
  const saved = new Map<string, StoredPaths>();
  if (photos.length === 0) return saved;

  const deadline = Date.now() + deadlineMs;
  let cursor = 0;

  const worker = async () => {
    while (cursor < photos.length) {
      const photo = photos[cursor++];
      if (Date.now() > deadline) return; // 残りは次回の同期・次回の表示で保存される
      try {
        const thumb = await download(photo.fetchUrl);
        if (!thumb) continue;

        const path = photoPath(shopId, month, photo.key);
        const { error: upErr } = await supabase.storage.from(PHOTO_BUCKET)
          .upload(path, thumb, { contentType: "image/jpeg", upsert: true });
        if (upErr) { console.error("[photo-store] アップロード失敗:", upErr.message); continue; }

        // 拡大表示用。取れなくても一覧は出せるので失敗しても続行する
        let fullPath: string | null = null;
        const fullSrc = photo.fullUrl && photo.fullUrl !== photo.fetchUrl ? photo.fullUrl : null;
        if (fullSrc && Date.now() < deadline) {
          try {
            const full = await download(fullSrc);
            if (full) {
              const fp = photoPath(shopId, month, photo.key, true);
              const { error } = await supabase.storage.from(PHOTO_BUCKET)
                .upload(fp, full, { contentType: "image/jpeg", upsert: true });
              if (!error) fullPath = fp;
            }
          } catch { /* 拡大用は無くても表示できる */ }
        }

        const table = photo.source === "post" ? "gbp_posts" : "media";
        const keyCol = photo.source === "post" ? "post_name" : "media_name";
        const patch: Record<string, string> = { photo_path: path };
        if (fullPath) patch.photo_full_path = fullPath;
        const { error: dbErr } = await supabase
          .from(table).update(patch).eq(keyCol, photo.key).eq("shop_id", shopId);
        if (dbErr) { console.error("[photo-store] パス記録失敗:", dbErr.message); continue; }

        saved.set(photo.key, { path, fullPath });
      } catch (e: any) {
        // 1枚失敗してもレポート全体は出す。原因は残す
        console.error("[photo-store] 保存失敗:", photo.key.slice(-24), e?.message);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, photos.length) }, worker));
  return saved;
}
