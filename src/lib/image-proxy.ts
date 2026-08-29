/**
 * 画像プロキシ: Dropbox等の一時URLから画像をダウンロード → Supabase Storageにアップロード → 公開URL返却
 * GBP APIは sourceUrl から画像をfetchするため、安定した公開URLが必要
 */
import { getSupabase } from "@/lib/supabase";
import { extFromContentType, isVideoFile } from "@/lib/media-format";


const BUCKET = "post-images";
// GBPの動画上限は仕様上75MBだが、このシステムは sourceUrl（URLをGoogleに取りに来させる）方式のため
// Google側の取得上限 25MB（26,214,400B）が実際の壁。超えると
// 「Media fetch response bytes too large (max: 26214400B)」で400になる（2026-08-28 羊座 40MB/38MBで実証）。
// 75MBまで通したい場合は media:startUpload（バイト直送）への切替が必要
export const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
// 写真は後段で JPEG 化・縮小して 5MB 以下に落とすので、DL前の上限は元の 75MB のまま（30MBのカメラJPEGは縮小して通す）
const MAX_PHOTO_SOURCE_BYTES = 75 * 1024 * 1024;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // GBP写真上限

function sizeOverMessage(bytes: number, isVideo: boolean): string {
  const mb = (bytes / 1024 / 1024).toFixed(1);
  return isVideo
    ? `動画が大きすぎます（${mb}MB > Googleが取得できる上限25MB）。解像度720p・30秒以内に圧縮して25MB以下にしてから入れ直してください`
    : `写真が大きすぎます（${mb}MB > 取り込み上限75MB）。長辺2000px程度に縮小して入れ直してください`;
}


/**
 * 画像URLをGBP APIがfetch可能な公開URLに変換
 * - Dropbox一時URL → ダウンロード → Supabase Storage → 公開URL
 * - 既にpublic URLの場合はそのまま返す
 */
// SSRF防止: 実ホスト名がDropboxの正規ドメインの場合のみサーバー側fetchを許可
function isDropboxHost(rawUrl: string): boolean {
  let host: string;
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    host = u.hostname.toLowerCase();
  } catch {
    return false;
  }
  const allowed = ["dropbox.com", "dropboxusercontent.com"];
  return allowed.some((d) => host === d || host.endsWith("." + d));
}

/**
 * @param imageUrl 変換元URL（Dropbox一時リンク等）
 * @param postId   Storage上のファイル名に使う一意なID
 * @param sourceName 元のファイル名。Dropboxが application/octet-stream を返したときの拡張子判定に使う
 */
/** 失敗理由も返す版。画面に「なぜ変換できなかったか」を出すために使う */
export async function resolveMediaUrl(
  imageUrl: string,
  postId: string,
  sourceName = "",
): Promise<{ url: string | null; error?: string; bytes?: number }> {
  if (!imageUrl) return { url: null, error: "URLが空" };

  // Dropboxの正規ホストのみサーバー側でダウンロード（SSRF防止）。それ以外はそのまま返す
  if (!isDropboxHost(imageUrl)) return { url: imageUrl };

  try {
    // 1. ダウンロード（動画は数十MBになるので写真より長めに待つ）
    const res = await fetch(imageUrl, {
      signal: AbortSignal.timeout(90000),
      redirect: "follow",
    });
    if (!res.ok) {
      const msg = `Dropboxからのダウンロードに失敗 (HTTP ${res.status})`;
      console.error(`[image-proxy] ${msg}: ${imageUrl.slice(0, 80)}`);
      return { url: null, error: msg };
    }

    let contentType = res.headers.get("content-type") || "image/jpeg";

    // 本体を読む前にサイズを見る。167MBの動画をVercel関数のメモリに載せてから捨てるのは
    // 無駄なうえ、90秒のダウンロード待ちも丸ごと無駄になる（2026-08-15 実例）
    const declared = Number(res.headers.get("content-length") || 0);
    // 種別はDL前にファイル名/URLの拡張子で判定（Content-Type は octet-stream のことがある）
    // 動画判定は media-format（GBPが受け付ける mp4/mov/m4v）に統一。auto-post の事前チェックと同じ基準にする
    const looksVideo = isVideoFile(sourceName || imageUrl.split("?")[0]) || /^video\//.test(contentType);
    const MAX_BYTES = looksVideo ? MAX_VIDEO_BYTES : MAX_PHOTO_SOURCE_BYTES;
    if (declared > MAX_BYTES) {
      const msg = sizeOverMessage(declared, looksVideo);
      console.error(`[image-proxy] ${msg}: ${sourceName || imageUrl.slice(0, 60)}`);
      return { url: null, error: msg };
    }

    let buffer: Buffer = Buffer.from(await res.arrayBuffer());

    if (buffer.length < 1000) {
      const msg = `ファイルが小さすぎる (${buffer.length} bytes) — HTMLが返っている可能性`;
      console.error(`[image-proxy] ${msg}`);
      return { url: null, error: msg };
    }
    // Content-Lengthが無いDropboxリンク用の保険（Google取得上限25MB）
    if (buffer.length > MAX_BYTES) {
      const msg = sizeOverMessage(buffer.length, looksVideo);
      console.error(`[image-proxy] ${msg}: ${sourceName || imageUrl.slice(0, 60)}`);
      return { url: null, error: msg };
    }
    // 写真はGBPの上限が5MB（10KB〜5MB・250px以上）。超過分をGBPに投げると
    // 「400 Request contains an invalid argument」としか返らず原因が画面から分からないため、ここで弾く
    const isPhoto = !looksVideo;
    let ext = extFromContentType(contentType, sourceName);

    if (isPhoto) {
      // GBPが受け付ける写真は JPG/PNG のみ。WebP/GIF/BMP/HEIC をそのまま投げると
      // 「400 Request contains an invalid argument」で落ちる（2026-08-21 ワイロ: .webp の2枚が失敗）。
      // 5MB超も同じエラーになる。どちらもここで JPEG に変換・縮小して吸収する
      const unsupported = !/^(jpg|jpeg|png)$/i.test(ext) || /image\/(webp|gif|bmp|heic|heif|avif)/i.test(contentType);
      if (unsupported || buffer.length > MAX_PHOTO_BYTES) {
        const converted = await toGbpJpeg(buffer);
        if (!converted) {
          const msg = unsupported
            ? `GBP非対応の画像形式（${ext} / ${contentType}）をJPEGに変換できませんでした。JPG/PNGで保存し直してください`
            : `写真が大きすぎます（${(buffer.length / 1024 / 1024).toFixed(1)}MB > GBPの上限5MB）。縮小にも失敗しました`;
          console.error(`[image-proxy] ${msg}: ${sourceName || imageUrl.slice(0, 60)}`);
          return { url: null, error: msg };
        }
        console.log(`[image-proxy] 画像変換: ${ext}/${contentType} ${(buffer.length / 1024).toFixed(0)}KB → jpeg ${(converted.length / 1024).toFixed(0)}KB (${sourceName})`);
        buffer = converted;
        contentType = "image/jpeg";
        ext = "jpg";
      }
    }

    // 2. Supabase Storageにアップロード
    // 拡張子を保つこと: 予約投稿は実行時にこのURLの拡張子で PHOTO / VIDEO を判定する
    const fileName = `${postId}.${ext}`;
    const supabase = getSupabase();

    // バケット存在確認 & 作成
    const { data: buckets } = await supabase.storage.listBuckets();
    if (!buckets?.find(b => b.name === BUCKET)) {
      await supabase.storage.createBucket(BUCKET, { public: true });
    }

    // アップロード（同名ファイルは上書き）
    const { error } = await supabase.storage.from(BUCKET).upload(fileName, buffer, {
      contentType,
      upsert: true,
    });
    if (error) {
      console.error(`[image-proxy] アップロード失敗:`, error.message);
      return { url: null, error: `Storageへの保存に失敗: ${error.message}` };
    }

    // 3. 公開URLを返す
    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(fileName);
    console.log(`[image-proxy] 変換成功: ${imageUrl.slice(0, 50)}... → ${urlData.publicUrl}`);
    return { url: urlData.publicUrl, bytes: buffer.length };
  } catch (e: any) {
    const msg = e?.name === "TimeoutError"
      ? "Dropboxからのダウンロードが90秒以内に終わらなかった（ファイルが大きい可能性）"
      : (e?.message || "不明なエラー");
    console.error(`[image-proxy] エラー:`, msg);
    return { url: null, error: msg };
  }
}

/**
 * 任意の画像をGBP向けJPEGにする。5MBに収まるまで品質→長辺の順で段階的に落とす。
 * sharp は動的importにして、動画だけの経路や未対応環境で読み込み失敗しても他が巻き込まれないようにする
 */
async function toGbpJpeg(input: Buffer): Promise<Buffer | null> {
  try {
    const sharp = (await import("sharp")).default;
    const attempts: { maxSide: number; quality: number }[] = [
      { maxSide: 4096, quality: 90 },
      { maxSide: 3000, quality: 85 },
      { maxSide: 2048, quality: 82 },
      { maxSide: 1600, quality: 80 },
    ];
    for (const a of attempts) {
      const out = await sharp(input, { failOn: "none" })
        .rotate() // EXIFの向きを反映してから（GBPはEXIFを見ない）
        .resize({ width: a.maxSide, height: a.maxSide, fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#ffffff" }) // 透過PNG/WebPの背景を白に
        .jpeg({ quality: a.quality, mozjpeg: true })
        .toBuffer();
      if (out.length <= MAX_PHOTO_BYTES) return out;
    }
    return null;
  } catch (e: any) {
    console.error("[image-proxy] JPEG変換失敗:", e?.message);
    return null;
  }
}

/** 従来インターフェース（URLだけ必要な呼び出し用） */
export async function resolveImageUrl(imageUrl: string, postId: string, sourceName = ""): Promise<string | null> {
  return (await resolveMediaUrl(imageUrl, postId, sourceName)).url;
}

/**
 * 投稿後にStorageから一時画像を削除（オプション）
 */
export async function cleanupImage(postId: string): Promise<void> {
  try {
    const supabase = getSupabase();
    const { data: files } = await supabase.storage.from(BUCKET).list("", { search: postId });
    if (files && files.length > 0) {
      await supabase.storage.from(BUCKET).remove(files.map(f => f.name));
    }
  } catch {}
}
