/**
 * 店舗名検索用の正規化。
 * NFKC（全角半角統一）+ 空白除去 + 小文字化に加え、店舗名で頻出する
 * 異体字を代表字に寄せる（例: 靭公園の「靭」はIMEだと「靱」が出やすく、
 * 単純一致だと検索にヒットしない実害があった 2026-08-06）。
 */
const KANJI_VARIANTS: [RegExp, string][] = [
  [/[靱靫]/g, "靭"],
  [/髙/g, "高"],
  [/﨑/g, "崎"],
  [/[齋齊斉]/g, "斎"],
  [/[邊邉]/g, "辺"],
  [/澤/g, "沢"],
  [/濵|濱/g, "浜"],
  [/國/g, "国"],
  [/萬/g, "万"],
  [/龍/g, "竜"],
  [/嶋|嶌/g, "島"],
];

export function normalizeSearchText(s: string): string {
  let t = (s || "").normalize("NFKC").replace(/[\s　]+/g, "").toLowerCase();
  for (const [re, rep] of KANJI_VARIANTS) t = t.replace(re, rep);
  return t;
}

/** 正規化した上での部分一致判定（needleが空なら常にtrue） */
export function searchMatch(haystack: string, needle: string): boolean {
  return normalizeSearchText(haystack).includes(normalizeSearchText(needle));
}
