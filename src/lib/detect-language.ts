/**
 * 口コミテキストの言語を正規表現ベースで判定
 * franc等のMLライブラリより短文・混合言語に強い
 */

interface LangRule {
  lang: string;
  country: string;
  pattern: RegExp;
}

const LANG_RULES: LangRule[] = [
  { lang: "日本語", country: "日本", pattern: /[\u3040-\u309F\u30A0-\u30FF]/ },           // ひらがな・カタカナ
  { lang: "韓国語", country: "韓国", pattern: /[\uAC00-\uD7AF\u1100-\u11FF]/ },           // ハングル
  { lang: "中国語（簡体）", country: "中国", pattern: /[\u4E00-\u9FFF]/ },                  // CJK統合漢字（日本語がない場合のみ）
  { lang: "タイ語", country: "タイ", pattern: /[\u0E00-\u0E7F]/ },
  { lang: "ベトナム語", country: "ベトナム", pattern: /[ăâđêôơưĂÂĐÊÔƠƯ]/ },
  { lang: "ロシア語", country: "ロシア", pattern: /[\u0400-\u04FF]/ },
  { lang: "アラビア語", country: "中東", pattern: /[\u0600-\u06FF\u0750-\u077F]/ },
  { lang: "ヒンディー語", country: "インド", pattern: /[\u0900-\u097F]/ },
  { lang: "インドネシア語", country: "インドネシア", pattern: /\b(dan|dengan|yang|untuk|dari|ini|itu|tidak|sangat|saya)\b/i },
  { lang: "フランス語", country: "フランス", pattern: /\b(très|beaucoup|c'est|merci|avec|mais|pour|dans|sont|nous)\b/i },
  { lang: "ドイツ語", country: "ドイツ", pattern: /\b(und|ist|nicht|sehr|aber|auch|das|die|der|ein|eine|wir)\b/i },
  { lang: "スペイン語", country: "スペイン", pattern: /\b(muy|pero|con|para|que|los|las|una|este|esta|más)\b/i },
  { lang: "ポルトガル語", country: "ブラジル", pattern: /\b(muito|mas|com|para|não|são|uma|este|esta|mais)\b/i },
  { lang: "イタリア語", country: "イタリア", pattern: /\b(molto|buono|grazie|questo|questa|sono|bene|tutto|anche)\b/i },
];

export interface LangDetectResult {
  lang: string;
  country: string;
}

/**
 * テキストから言語を判定
 * - 日本語文字がある場合は「日本語」
 * - CJK漢字のみの場合は「中国語（簡体）」
 * - 各言語の特徴的な文字・単語パターンでマッチ
 * - どれにも該当しない場合はラテン文字ベースなら「英語」、それ以外は「不明」
 */
export function detectLanguage(text: string | null | undefined): LangDetectResult {
  if (!text || text.trim().length === 0) return { lang: "不明", country: "不明" };

  const cleaned = text
    .replace(/\(Original\)[\s\S]*/i, "")     // GBP翻訳の原文マーカー以降を除去
    .replace(/\(Translated by Google\)/i, "") // 翻訳マーカー除去
    .trim();

  if (!cleaned) return { lang: "不明", country: "不明" };

  // 日本語チェック（ひらがな・カタカナが1文字でもあれば日本語）
  if (LANG_RULES[0].pattern.test(cleaned)) return { lang: "日本語", country: "日本" };

  // 韓国語チェック
  if (LANG_RULES[1].pattern.test(cleaned)) return { lang: "韓国語", country: "韓国" };

  // 非ラテン文字系チェック（タイ語、ロシア語、アラビア語、ヒンディー語）
  for (let i = 3; i < LANG_RULES.length; i++) {
    const rule = LANG_RULES[i];
    if (rule.pattern.test(cleaned)) return { lang: rule.lang, country: rule.country };
  }

  // CJK漢字のみ（日本語文字なし）→ 中国語
  if (LANG_RULES[2].pattern.test(cleaned)) return { lang: "中国語（簡体）", country: "中国" };

  // ラテン文字系の単語ベース判定
  for (let i = 8; i < LANG_RULES.length; i++) {
    const rule = LANG_RULES[i];
    const matches = cleaned.match(rule.pattern);
    if (matches && matches.length >= 2) return { lang: rule.lang, country: rule.country };
  }

  // ラテン文字が主体なら英語、それ以外は不明
  if (/[a-zA-Z]/.test(cleaned)) return { lang: "英語", country: "英語圏" };

  return { lang: "不明", country: "不明" };
}

/** 星評価テキスト（"ONE","TWO"等）を数値に変換 */
export function starToNum(rating: string): number {
  const map: Record<string, number> = {
    ONE: 1, ONE_STAR: 1, TWO: 2, TWO_STARS: 2,
    THREE: 3, THREE_STARS: 3, FOUR: 4, FOUR_STARS: 4,
    FIVE: 5, FIVE_STARS: 5,
  };
  return map[(rating || "").toUpperCase()] || 0;
}
