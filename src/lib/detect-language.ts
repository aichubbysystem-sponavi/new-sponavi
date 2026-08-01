/**
 * 口コミテキストの言語を正規表現ベースで判定
 * franc等のMLライブラリより短文・混合言語に強い
 */

interface LangRule {
  lang: string;
  country: string;
  pattern: RegExp;
}

/**
 * 【重要】規則は2区画に分かれており、判定方法が異なる。混ぜてはいけない。
 * - SCRIPT_RULES: 文字種で一意に決まる規則。1文字でもマッチすれば確定してよい。
 * - WORD_RULES:   ラテン文字圏の単語ベース規則。英語と綴りが衝突する単語
 *                 （"die"(独) / 人名 "Dan"(尼) / "con"(西) / "sono"(伊) 等）を含むため、
 *                 1語のマッチで確定してはいけない（2語以上を要求する）。
 *
 * 以前は両区画を1つのループで単発マッチ判定しており、
 * "Dan was very helpful" がインドネシア語、"die-hard fans" がドイツ語に化けていた。
 * 口コミ言語比率レポート・AI総評・CSV出力の全てがこの判定に依存している。
 */
const SCRIPT_RULES: LangRule[] = [
  { lang: "日本語", country: "日本", pattern: /[぀-ゟ゠-ヿ]/ },           // ひらがな・カタカナ
  { lang: "韓国語", country: "韓国", pattern: /[가-힯ᄀ-ᇿ]/ },           // ハングル
  { lang: "中国語（簡体）", country: "中国", pattern: /[一-鿿]/ },                  // CJK統合漢字（日本語がない場合のみ）
  { lang: "タイ語", country: "タイ", pattern: /[฀-๿]/ },
  // â/ê/ô はフランス語・ポルトガル語にも現れるため使わない（"être" "você" が
  // ベトナム語に化ける）。ベトナム語固有の ă đ ơ ư のみで判定する
  { lang: "ベトナム語", country: "ベトナム", pattern: /[ăđơưĂĐƠƯ]/ },
  { lang: "ロシア語", country: "ロシア", pattern: /[Ѐ-ӿ]/ },
  { lang: "アラビア語", country: "中東", pattern: /[؀-ۿݐ-ݿ]/ },
  { lang: "ヒンディー語", country: "インド", pattern: /[ऀ-ॿ]/ },
];

/**
 * 単語ベース規則。
 * 件数を数えるため必ず /g を付けること。/g が無いと match() の戻り値が
 * [全体, キャプチャ] となり長さが常に2になるため、「2語以上」の判定が素通しになる。
 */
const WORD_RULES: LangRule[] = [
  { lang: "インドネシア語", country: "インドネシア", pattern: /\b(dan|dengan|yang|untuk|dari|ini|itu|tidak|sangat|saya)\b/gi },
  { lang: "フランス語", country: "フランス", pattern: /\b(très|beaucoup|c'est|merci|avec|mais|pour|dans|sont|nous)\b/gi },
  { lang: "ドイツ語", country: "ドイツ", pattern: /\b(und|ist|nicht|sehr|aber|auch|das|die|der|ein|eine|wir)\b/gi },
  { lang: "スペイン語", country: "スペイン", pattern: /\b(muy|pero|con|para|que|los|las|una|este|esta|más)\b/gi },
  { lang: "ポルトガル語", country: "ブラジル", pattern: /\b(muito|mas|com|para|não|são|uma|este|esta|mais)\b/gi },
  { lang: "イタリア語", country: "イタリア", pattern: /\b(molto|buono|grazie|questo|questa|sono|bene|tutto|anche)\b/gi },
];

// SCRIPT_RULES 内の位置
const RULE_JA = 0;
const RULE_KO = 1;
const RULE_ZH = 2;
const RULE_NON_LATIN_START = 3; // タイ語以降（漢字判定は中国語として最後に回すため除く）

/** 単語ベース規則にいくつマッチしたか（/g 前提。lastIndex を汚さないよう match を使う） */
function countWordMatches(text: string, pattern: RegExp): number {
  const m = text.match(pattern);
  return m ? m.length : 0;
}

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
  if (!text || typeof text !== "string" || text.trim().length === 0) return { lang: "不明", country: "不明" };

  // GBP口コミフォーマット: "(Translated by Google) [翻訳] (Original) [原文]"
  // → 原文（Original以降）があればそちらを判定対象にする
  const originalMatch = text.match(/\(Original\)\s*([\s\S]+)/i);
  const cleaned = originalMatch
    ? originalMatch[1].trim()  // 原文テキストを使用
    : text.replace(/\(Translated by Google\)/i, "").trim(); // マーカーなしのテキスト

  if (!cleaned) return { lang: "不明", country: "不明" };

  // 日本語チェック（ひらがな・カタカナが1文字でもあれば日本語）
  if (SCRIPT_RULES[RULE_JA].pattern.test(cleaned)) return { lang: "日本語", country: "日本" };

  // 韓国語チェック
  if (SCRIPT_RULES[RULE_KO].pattern.test(cleaned)) return { lang: "韓国語", country: "韓国" };

  // 非ラテン文字系チェック（タイ語、ベトナム語、ロシア語、アラビア語、ヒンディー語）
  // ※ここに単語ベース規則を混ぜないこと（英語が外国語に化ける）
  for (let i = RULE_NON_LATIN_START; i < SCRIPT_RULES.length; i++) {
    const rule = SCRIPT_RULES[i];
    if (rule.pattern.test(cleaned)) return { lang: rule.lang, country: rule.country };
  }

  // CJK漢字のみ（日本語文字なし）→ 中国語
  if (SCRIPT_RULES[RULE_ZH].pattern.test(cleaned)) return { lang: "中国語（簡体）", country: "中国" };

  // ラテン文字系の単語ベース判定。
  // 単語1つの一致は英語との綴り衝突が多いため、最も多くマッチした言語を2語以上で採用する
  let best: { rule: LangRule; count: number } | null = null;
  for (const rule of WORD_RULES) {
    const count = countWordMatches(cleaned, rule.pattern);
    if (count >= 2 && (!best || count > best.count)) best = { rule, count };
  }
  if (best) return { lang: best.rule.lang, country: best.rule.country };

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
