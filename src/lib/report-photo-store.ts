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
 * 【サイズ】
 * 保存するのは一覧用のサムネイル（実測 23〜27KB）。全759店舗×月20枚で月約375MB、
 * 年4.5GB。Supabase Pro（100GB込み）の範囲内で追加費用は発生しない。
 */

import crypto from "crypto";
import { getSupabase } from "@/lib/supabase";

export const PHOTO_BUCKET = "report-photos";

/** 同時ダウンロード数。多くしてもGoogle側で詰まるだけなので控えめにする */
const CONCURRENCY = 8;
/** 1枚あたりの取得タイムアウト */
const FETCH_TIMEOUT_MS = 8000;
/** 保存しない上限。サムネイルは25KB前後なので、これを超えるものは想定外 */
const MAX_BYTES = 5 * 1024 * 1024;

/** 保存済み画像の公開URL。バケットは public なので署名不要 */
export function publicPhotoUrl(path: string): string {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  return `${base}/storage/v1/object/public/${PHOTO_BUCKET}/${path}`;
}

/**
 * 保存パス。GBPのリソース名は長すぎるのでハッシュにする。
 * 店舗・月で分けておくと、後から月単位で消す・数えるのが楽になる。
 */
export function photoPath(shopId: string, month: string, key: string): string {
  const hash = crypto.createHash("sha1").update(key).digest("hex");
  const ym = month.replace("/", "-");
  return `${shopId}/${ym}/${hash}.jpg`;
}

export interface StorablePhoto {
  key: string;
  source: "post" | "media";
  /** 取得元URL（GBPの一時URL。失効前提） */
  fetchUrl: string;
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
): Promise<Map<string, string>> {
  const supabase = getSupabase();
  const saved = new Map<string, string>();
  if (photos.length === 0) return saved;

  const deadline = Date.now() + deadlineMs;
  let cursor = 0;

  const worker = async () => {
    while (cursor < photos.length) {
      const photo = photos[cursor++];
      if (Date.now() > deadline) return; // 残りは次回の同期・次回の表示で保存される
      try {
        const res = await fetch(photo.fetchUrl, {
          cache: "no-store",
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        // 失効したURLは403でも200x200の「画像なし」PNG(818バイト)を返す。
        // それを保存すると灰色の画像が永久に残るので、明らかに小さいものは弾く
        if (buf.length < 2000 || buf.length > MAX_BYTES) continue;

        const path = photoPath(shopId, month, photo.key);
        const { error: upErr } = await supabase.storage
          .from(PHOTO_BUCKET)
          .upload(path, buf, {
            contentType: res.headers.get("content-type") || "image/jpeg",
            upsert: true,
          });
        if (upErr) { console.error("[photo-store] アップロード失敗:", upErr.message); continue; }

        const table = photo.source === "post" ? "gbp_posts" : "media";
        const keyCol = photo.source === "post" ? "post_name" : "media_name";
        const { error: dbErr } = await supabase
          .from(table).update({ photo_path: path }).eq(keyCol, photo.key).eq("shop_id", shopId);
        if (dbErr) { console.error("[photo-store] パス記録失敗:", dbErr.message); continue; }

        saved.set(photo.key, path);
      } catch (e: any) {
        // 1枚失敗してもレポート全体は出す。原因は残す
        console.error("[photo-store] 保存失敗:", photo.key.slice(-24), e?.message);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, photos.length) }, worker));
  return saved;
}
