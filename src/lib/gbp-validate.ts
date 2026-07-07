/**
 * GBPリソース名（localPost）の形式検証。
 * delete-post で受け取る postName を無検証で DELETE URL に連結すると、
 * パストラバーサル（../）やクエリ混入で意図しないGBPリソースを操作され得る。
 * 許可する形は「英数字・アンダースコア・ハイフン・スラッシュのみ」で、
 * 必ず /localPosts/ を含み、accounts/... または locations/... で始まるもの。
 */
export function isValidGbpPostName(postName: unknown): postName is string {
  if (typeof postName !== "string") return false;
  const s = postName.trim();
  if (!s) return false;
  // 許可文字以外（空白・?&#%・ドット・全角等）を含むものは拒否
  if (!/^[A-Za-z0-9/_-]+$/.test(s)) return false;
  // パストラバーサル・空セグメント（連続スラッシュ）を拒否
  if (s.includes("..") || s.includes("//")) return false;
  // 先頭/末尾スラッシュを拒否
  if (s.startsWith("/") || s.endsWith("/")) return false;
  // localPosts セグメントを必須にする（投稿以外のリソース削除を防ぐ）
  if (!s.includes("/localPosts/")) return false;
  // ルートは accounts/{id}/... か locations/{id}/... のみ許可
  if (!/^accounts\/[A-Za-z0-9_-]+\//.test(s) && !/^locations\/[A-Za-z0-9_-]+\//.test(s)) {
    return false;
  }
  return true;
}
