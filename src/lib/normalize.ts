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
 * 店舗名の同一判定用の正規化（NFKC + 空白除去 + 小文字化）
 * 全角半角・空白の有無・大文字小文字だけの違いは「同じ名前」とみなす。
 *
 * GBP店名の変更検出（lib/gbp-shop-sync.ts）と顧客マスタの「店名変更あり」バッジ
 * （app/customer-master）は必ずこれを共有すること。基準がズレると
 * 「28件検出」と言われて画面には25件しか出ない、という不一致が起きる。
 */
export function normShopName(s: string | null | undefined): string {
  return (s || "").normalize("NFKC").replace(/[\s　]+/g, "").toLowerCase();
}

/** 店舗名が実質同一か（表記ゆれを無視して比較） */
export function isSameShopName(a: string | null | undefined, b: string | null | undefined): boolean {
  return normShopName(a) === normShopName(b);
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
