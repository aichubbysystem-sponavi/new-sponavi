/**
 * 検索用テキスト正規化
 * - 全角英数字 → 半角
 * - 半角カタカナ → 全角カタカナ
 * - 全角スペース → 半角スペース
 * - 大文字 → 小文字
 * - 連続スペース → 単一スペース
 * - 前後スペース除去
 */
export function normalize(str: string): string {
  return str
    // 全角英数字 → 半角
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) =>
      String.fromCharCode(s.charCodeAt(0) - 0xFEE0)
    )
    // 全角記号の一部 → 半角
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[＝]/g, "=")
    .replace(/[＆]/g, "&")
    .replace(/[・]/g, "・")
    .replace(/[ー]/g, "ー")
    // 半角カタカナ → 全角カタカナ
    .replace(/[\uFF65-\uFF9F]/g, (s) => {
      const kanaMap: Record<string, string> = {
        "ｦ": "ヲ", "ｧ": "ァ", "ｨ": "ィ", "ｩ": "ゥ", "ｪ": "ェ", "ｫ": "ォ",
        "ｬ": "ャ", "ｭ": "ュ", "ｮ": "ョ", "ｯ": "ッ", "ｰ": "ー", "ｱ": "ア",
        "ｲ": "イ", "ｳ": "ウ", "ｴ": "エ", "ｵ": "オ", "ｶ": "カ", "ｷ": "キ",
        "ｸ": "ク", "ｹ": "ケ", "ｺ": "コ", "ｻ": "サ", "ｼ": "シ", "ｽ": "ス",
        "ｾ": "セ", "ｿ": "ソ", "ﾀ": "タ", "ﾁ": "チ", "ﾂ": "ツ", "ﾃ": "テ",
        "ﾄ": "ト", "ﾅ": "ナ", "ﾆ": "ニ", "ﾇ": "ヌ", "ﾈ": "ネ", "ﾉ": "ノ",
        "ﾊ": "ハ", "ﾋ": "ヒ", "ﾌ": "フ", "ﾍ": "ヘ", "ﾎ": "ホ", "ﾏ": "マ",
        "ﾐ": "ミ", "ﾑ": "ム", "ﾒ": "メ", "ﾓ": "モ", "ﾔ": "ヤ", "ﾕ": "ユ",
        "ﾖ": "ヨ", "ﾗ": "ラ", "ﾘ": "リ", "ﾙ": "ル", "ﾚ": "レ", "ﾛ": "ロ",
        "ﾜ": "ワ", "ﾝ": "ン", "ﾞ": "゛", "ﾟ": "゜",
      };
      return kanaMap[s] || s;
    })
    // 全角スペース → 半角
    .replace(/　/g, " ")
    // 小文字化
    .toLowerCase()
    // 連続スペース → 単一
    .replace(/\s+/g, " ")
    // 前後スペース除去
    .trim();
}

/**
 * 検索マッチ判定
 * クエリの全単語がターゲット文字列のいずれかに含まれていればtrue
 */
export function fuzzyMatch(query: string, ...targets: string[]): boolean {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return true; // 空クエリは全件マッチ

  const words = normalizedQuery.split(" ");
  const normalizedTargets = targets.map((t) => normalize(t || ""));
  const joined = normalizedTargets.join(" ");

  // 全単語がいずれかのターゲットに含まれているか
  return words.every((word) => joined.includes(word));
}
