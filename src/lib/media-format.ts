/**
 * GBPメディア（写真 / 動画）の形式判定。
 *
 * GBP Media API は mediaFormat を "PHOTO" / "VIDEO" で受け取る。
 * 動画を PHOTO として送ると弾かれるため、投稿する経路すべてでこの判定を使う。
 *
 * 注意: Dropboxの get_temporary_link が返すURLはファイル名を含まないことがある。
 * URLから判定できるのは
 *   - シートF列に直接書かれたURL（拡張子つき）
 *   - image-proxy が Supabase Storage に保存したURL（拡張子を保って保存している）
 * の場合。Dropbox一時リンクを使うときは、必ずファイル一覧側の名前で判定して持ち回すこと。
 */

export type GbpMediaFormat = "PHOTO" | "VIDEO";

const PHOTO_EXT = /\.(jpg|jpeg|png|gif|webp|bmp)$/i;
// GBPの動画対応形式。AVI/WMV等は非対応なので広げない
const VIDEO_EXT = /\.(mp4|mov|m4v)$/i;

/** URLならパス部分を、ファイル名ならそのまま返す（クエリ・フラグメントを落とす） */
function pathPart(nameOrUrl: string): string {
  const s = (nameOrUrl || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) {
    try {
      return decodeURIComponent(new URL(s).pathname);
    } catch {
      return s.split(/[?#]/)[0];
    }
  }
  return s.split(/[?#]/)[0];
}

/** 写真・動画のどちらでもなければ null */
export function detectMediaFormat(nameOrUrl: string): GbpMediaFormat | null {
  const p = pathPart(nameOrUrl);
  if (!p) return null;
  if (VIDEO_EXT.test(p)) return "VIDEO";
  if (PHOTO_EXT.test(p)) return "PHOTO";
  return null;
}

/** GBPに投稿できるファイルか（写真 or 動画） */
export function isSupportedMediaFile(nameOrUrl: string): boolean {
  return detectMediaFormat(nameOrUrl) !== null;
}

export function isVideoFile(nameOrUrl: string): boolean {
  return detectMediaFormat(nameOrUrl) === "VIDEO";
}

/** Content-Type から保存用の拡張子を決める（image-proxy用） */
export function extFromContentType(contentType: string, fallbackName = ""): string {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("quicktime")) return "mov";
  if (ct.includes("mp4")) return "mp4";
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  // Dropboxが application/octet-stream を返すことがあるので元のファイル名から拾う
  const m = pathPart(fallbackName).match(/\.([A-Za-z0-9]+)$/);
  if (m && (PHOTO_EXT.test(`.${m[1]}`) || VIDEO_EXT.test(`.${m[1]}`))) return m[1].toLowerCase();
  return "jpg";
}
