/**
 * GBPリソース名（localPost）の形式検証。
 * delete-post で受け取る postName を無検証で DELETE URL に連結すると、
 * パストラバーサル（../）やクエリ混入で意図しないGBPリソースを操作され得る。
 * 許可する形は「英数字・アンダースコア・ハイフン・スラッシュのみ」で、
 * 必ず /localPosts/ を含み、accounts/... または locations/... で始まるもの。
 */
/** localPosts / media で共通の安全チェック（セグメント種別は見ない） */
function isSafeGbpResourceName(name: unknown): name is string {
  if (typeof name !== "string") return false;
  const s = name.trim();
  if (!s) return false;
  // 許可文字以外（空白・?&#%・ドット・全角等）を含むものは拒否
  if (!/^[A-Za-z0-9/_-]+$/.test(s)) return false;
  // パストラバーサル・空セグメント（連続スラッシュ）を拒否
  if (s.includes("..") || s.includes("//")) return false;
  // 先頭/末尾スラッシュを拒否
  if (s.startsWith("/") || s.endsWith("/")) return false;
  // ルートは accounts/{id}/... か locations/{id}/... のみ許可
  if (!/^accounts\/[A-Za-z0-9_-]+\//.test(s) && !/^locations\/[A-Za-z0-9_-]+\//.test(s)) {
    return false;
  }
  return true;
}

export function isValidGbpPostName(postName: unknown): postName is string {
  if (!isSafeGbpResourceName(postName)) return false;
  // localPosts セグメントを必須にする（投稿以外のリソース削除を防ぐ）
  return postName.trim().includes("/localPosts/");
}

/**
 * 写真（メディア）リソース名の検証。
 * 写真投稿は localPosts ではなく media として作られるため、
 * これを許可しないと「投稿はできるが削除できない」状態になる（2026-08-15）。
 */
export function isValidGbpMediaName(mediaName: unknown): mediaName is string {
  if (!isSafeGbpResourceName(mediaName)) return false;
  return mediaName.trim().includes("/media/");
}

/** delete-post が削除を許可するリソース名（通常投稿 または 写真） */
export function isValidGbpDeletableName(name: unknown): name is string {
  return isValidGbpPostName(name) || isValidGbpMediaName(name);
}
