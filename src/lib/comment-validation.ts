/**
 * AI総評の「数値」を元データと突き合わせて検証する。
 *
 * 【なぜ必要か】
 * AIに渡すデータを正しくしても、AIが文章を書く瞬間に数字を取り違えることがある。
 * 2026-08-01 デザインフードマーケット名古屋駅店のレポートで実際に発生:
 *   表示: 「名古屋 バル」15位 → 10位
 *   AI  : 「名古屋 バル」が前回15位から9位へ5ランク上昇
 * 隣の「名古屋駅 バル」の9位を引っ張っていた（キーワード名が酷似しているため）。
 * データ側は一貫して10位で正しく、壊れていたのは生成された文章だけだった。
 *
 * LLMの出力はぶれるため、テストを増やしても消えない。生成後に照合して
 * 食い違ったら出荷しない、という関門を置くのが唯一の確実な対策。
 *
 * 【誤検知を出さない方針】
 * 「確実に間違いと言えるもの」だけを違反とする。判断がつかないものは通す。
 * 総評が過去月の順位に言及するのは正当なので、そのキーワードの
 * 全期間の順位のどれかに一致すれば正しいとみなす。
 */

import { normalizeKw } from "./keyword-normalize";

export interface KeywordRankFacts {
  /** キーワード名（表示に使われている文字列） */
  word: string;
  /** そのキーワードについて言及が許される順位の集合（当月・前回・推移の全月） */
  allowedRanks: number[];
  /**
   * 順位の時系列（古い順）。null=未計測 / 0=圏外 / 1以上=順位。
   * 「一度も下げていない」のような継続性の主張を検証するために使う。
   */
  series?: (number | null)[];
}

export interface CommentViolation {
  /** 違反が見つかったページ（pageCommentsのキー） */
  field: string;
  /** 違反の種類 */
  kind: "rank_mismatch" | "average_mismatch" | "continuity_mismatch" | "exclusivity_mismatch";
  /** 人間が読める説明。再生成時にAIへ渡す */
  message: string;
}

/** KPI指標の前月比・前年比（%）。「唯一の前年超え」等の排他的主張の検証に使う */
export interface MetricFact {
  label: string;
  /** 前月比% (例: +14.2 → 14.2)。前月データなしは null */
  momPct: number | null;
  /** 前年比%。前年データなしは null */
  yoyPct: number | null;
}

/** 全角数字を半角に寄せる */
function toHalfWidthDigits(s: string): string {
  return s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

/**
 * 文中のキーワード出現位置を、長いキーワード優先で検出する。
 * 「名古屋 バル」と「名古屋駅 バル」のように一方が他方に紛らわしい場合、
 * 短い方に誤って帰属させないため、各位置で最長一致を採る。
 */
function findKeywordMentions(
  text: string,
  facts: KeywordRankFacts[],
): { index: number; fact: KeywordRankFacts }[] {
  const mentions: { index: number; fact: KeywordRankFacts }[] = [];
  // 表記ゆれを吸収するため、空白を除去した比較用の文字列を作る。
  // 位置対応を保つため、除去した文字ぶんのオフセット表を持つ
  const stripped: string[] = [];
  const offsets: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/[\s　]/.test(ch)) continue;
    stripped.push(ch);
    offsets.push(i);
  }
  const flat = stripped.join("");

  const normalizedFacts = facts
    .map((f) => ({ fact: f, key: (f.word || "").replace(/[\s　]/g, "") }))
    .filter((f) => f.key.length > 0)
    // 長い順に試すことで最長一致にする
    .sort((a, b) => b.key.length - a.key.length);

  const taken = new Array(flat.length).fill(false);
  for (const { fact, key } of normalizedFacts) {
    let from = 0;
    while (true) {
      const at = flat.indexOf(key, from);
      if (at < 0) break;
      // 既に長いキーワードが占有している範囲は飛ばす
      let overlaps = false;
      for (let i = at; i < at + key.length; i++) if (taken[i]) { overlaps = true; break; }
      if (!overlaps) {
        for (let i = at; i < at + key.length; i++) taken[i] = true;
        mentions.push({ index: offsets[at], fact });
      }
      from = at + 1;
    }
  }
  return mentions.sort((a, b) => a.index - b.index);
}

/**
 * 「〜位」の記述が、そのキーワードの実データに存在する順位かを検証する。
 *
 * 帰属ルール: ある「N位」は、その直前に登場したキーワードのものとみなす。
 * キーワードが一度も登場しない文中の「N位」は帰属先が決められないため検証しない。
 */
export function validateRankMentions(
  text: string,
  facts: KeywordRankFacts[],
): { rank: number; word: string }[] {
  if (!text || facts.length === 0) return [];
  const normalized = toHalfWidthDigits(text);
  const mentions = findKeywordMentions(normalized, facts);
  if (mentions.length === 0) return [];

  const bad: { rank: number; word: string }[] = [];
  const rankRe = /(\d{1,3})\s*位/g;
  let m: RegExpExecArray | null;
  while ((m = rankRe.exec(normalized)) !== null) {
    const pos = m.index;
    // 「12.4位」「平均17.3位」のような小数の順位は、正規表現が小数点以下だけを
    // 拾って「4位」「3位」と誤検知する。数字の直前が数字か小数点なら実順位ではない
    const before = pos > 0 ? normalized[pos - 1] : "";
    if (/[\d.．]/.test(before)) continue;
    // 直前のキーワード出現を探す
    let owner: KeywordRankFacts | null = null;
    for (const mention of mentions) {
      if (mention.index < pos) owner = mention.fact;
      else break;
    }
    if (!owner) continue; // 帰属先不明 → 検証しない
    const rank = parseInt(m[1], 10);
    if (!Number.isFinite(rank)) continue;
    const after = normalized.slice(m.index + m[0].length, m.index + m[0].length + 4);
    // 「10位以内」のような閾値表現は実順位ではないので除外。
    // 「5位上昇」「3位下落」のような変動幅表現も順位ではない（実例: 15位→10位を
    // 「5位上昇」と書いた文で、5位が実データに無いとして誤検知した）
    if (/^(以[内上下]|上昇|上げ|アップ|改善|浮上|回復|下落|下降|低下|ダウン|後退|悪化|下げ|転落|分)/.test(after)) continue;
    if (!owner.allowedRanks.includes(rank)) {
      bad.push({ rank, word: owner.word });
    }
  }
  return bad;
}

/**
 * 「直近Nヶ月の月平均は+X件」形式の主張を検証する。
 *
 * 2026-08-01 に「直近6ヶ月の月平均は+4.3件」と書かれたが、
 * 実際の直近6ヶ月は +19,+1,+1,-1,+1,+2 = 23件 → 3.8件だった。
 * 明示的なパターンなので誤検知が起きにくく、機械的に検証できる。
 *
 * @param deltas 月次増減（古い順）
 */
export function validateMonthlyAverage(
  text: string,
  deltas: number[],
): { claimed: number; actual: number; months: number }[] {
  if (!text || deltas.length === 0) return [];
  const normalized = toHalfWidthDigits(text);
  const re = /直近\s*(\d{1,2})\s*[ヶかケ]?月[^。]{0,12}?月?平均[^0-9+\-]{0,8}([+\-]?\d+(?:\.\d+)?)\s*件/g;
  const bad: { claimed: number; actual: number; months: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalized)) !== null) {
    const months = parseInt(m[1], 10);
    const claimed = parseFloat(m[2]);
    if (!Number.isFinite(months) || months <= 0 || !Number.isFinite(claimed)) continue;
    if (deltas.length < months) continue; // 期間ぶんのデータが無い → 検証しない
    const window = deltas.slice(-months);
    const actual = window.reduce((a, b) => a + b, 0) / months;
    // 小数第1位までの表記ゆれを許容（3.83 と +3.8 は一致とみなす）
    if (Math.abs(actual - claimed) > 0.15) {
      bad.push({ claimed, actual: Math.round(actual * 10) / 10, months });
    }
  }
  return bad;
}

/**
 * 「一度も下げていない」のような継続性の主張を、順位の時系列と突き合わせる。
 *
 * 【なぜ必要か】
 * 2026-08-01 _WHITE 鳳店のレポートP7で発生:
 *   表: 鳳 美容室 = 1月圏外 / 2月1位 / 3月圏外 / 4月1位 / 5月1位 / 6月1位
 *   AI: 「一度も1位を下げることなく安定している」
 * 3月に圏外へ落ちているので事実と違う。
 * ただし文中の「1位」は実データに存在するため、数値照合では通過してしまう。
 * 誤っているのは数字ではなく「ずっと続いている」という主張の方。
 *
 * 【誤検知を避ける方針】
 * 断定的な表現（一度も〜ない / 常に / 全期間）だけを対象にする。
 * 「安定している」「維持」単体は、多少の上下でも自然に使える表現なので対象外。
 * 対象キーワードが特定できない文も検証しない。
 */
export function validateContinuityClaims(
  text: string,
  facts: KeywordRankFacts[],
): { word: string; claim: string; reason: string }[] {
  if (!text || facts.length === 0) return [];
  const normalized = toHalfWidthDigits(text);
  const mentions = findKeywordMentions(normalized, facts);
  if (mentions.length === 0) return [];

  // 「一度も」「常に」「全期間」など、例外を許さない断定表現のみ拾う
  const ABSOLUTE = /(一度も|常に|全期間|終始|ずっと)/g;
  const bad: { word: string; claim: string; reason: string }[] = [];

  let m: RegExpExecArray | null;
  while ((m = ABSOLUTE.exec(normalized)) !== null) {
    // 断定表現を含む「文」を特定する（。または改行区切り）
    const sentStart = Math.max(normalized.lastIndexOf("。", m.index), normalized.lastIndexOf("\n", m.index)) + 1;
    let sentEnd = normalized.indexOf("。", m.index);
    if (sentEnd < 0) sentEnd = normalized.length;
    const sentence = normalized.slice(sentStart, sentEnd);

    // 順位の話をしている文だけを対象にする。
    // 「口コミは常に増加している」のような順位と無関係な文を、
    // 直前に出たキーワードの順位主張として誤検知していた（2026-08-01）
    if (!/(順位|\d\s*位|上位|下位|首位|圏内|圏外|ランク)/.test(sentence)) continue;

    // キーワードは同じ文の中に登場している場合のみ帰属させる。
    // 文をまたいだ帰属は「別の話題の断定表現」を拾う誤検知のもと
    let owner: KeywordRankFacts | null = null;
    for (const mention of mentions) {
      if (mention.index >= sentStart && mention.index < m.index) owner = mention.fact;
      if (mention.index >= m.index) break;
    }
    if (!owner || !owner.series || owner.series.length === 0) continue;

    // 計測済みの月だけを見る（未計測は「下がった」ではない）
    const measured = owner.series.filter((r): r is number => r !== null);
    if (measured.length < 2) continue;

    const hasOutOfRange = measured.some((r) => r === 0);
    const ranks = measured.filter((r) => r > 0);
    const worsened = ranks.some((r, i) => i > 0 && r > ranks[i - 1]);

    if (hasOutOfRange || worsened) {
      const claim = normalized.slice(Math.max(0, m.index - 20), m.index + 30).trim();
      bad.push({
        word: owner.word,
        claim,
        reason: hasOutOfRange
          ? "計測期間中に圏外の月がある"
          : "計測期間中に順位が下がった月がある",
      });
    }
  }
  return bad;
}

/**
 * 「唯一の前年超え」のような排他的主張を、全指標の実データと突き合わせる。
 *
 * 【なぜ必要か】
 * 2026-08-02 Queencyのレポートで実際に発生:
 *   AI: 「ウェブサイトクリックは前年同月比+12%と唯一の前年超え」
 *   実際: フードメニュークリックも前年比+43.7%で前年超え（しかも伸び率はこちらが上）
 * 「唯一」はAIが全指標を数えた結果の主張であり、数え間違えると
 * レポート内の他ページ（KPIカード）と矛盾してクライアントの信頼を損なう。
 *
 * 【誤検知を避ける方針】
 * 「唯一」を含む文のうち、比較基準（前年/前月）と方向（超え/プラス/増 等）が
 * 明確に読み取れるものだけを検証する。判断がつかない文は通す。
 */
export function validateExclusivityClaims(
  text: string,
  metrics: MetricFact[],
): { claim: string; others: string[] }[] {
  if (!text || metrics.length === 0) return [];
  const normalized = toHalfWidthDigits(text);
  const bad: { claim: string; others: string[] }[] = [];

  const re = /唯一/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalized)) !== null) {
    const sentStart = Math.max(normalized.lastIndexOf("。", m.index), normalized.lastIndexOf("\n", m.index)) + 1;
    let sentEnd = normalized.indexOf("。", m.index);
    if (sentEnd < 0) sentEnd = normalized.length;
    const sentence = normalized.slice(sentStart, sentEnd);

    // 比較基準: 前年 or 前月。どちらも無い文は検証しない
    const basis: "yoy" | "mom" | null = /前年/.test(sentence) ? "yoy" : /前月/.test(sentence) ? "mom" : null;
    if (!basis) continue;
    // 方向: プラス系のみ対象（「唯一のマイナス」等は稀で、誤検知リスクの方が大きい）
    if (!/(超え|上回|プラス|増加|増)/.test(sentence)) continue;

    const positives = metrics.filter((mt) => {
      const pct = basis === "yoy" ? mt.yoyPct : mt.momPct;
      return typeof pct === "number" && pct > 0;
    });
    if (positives.length >= 2) {
      bad.push({
        claim: sentence.trim().slice(0, 60),
        others: positives.map((p) => `${p.label}(${basis === "yoy" ? "前年比" : "前月比"}${(basis === "yoy" ? p.yoyPct : p.momPct)!.toFixed(1)}%)`),
      });
    }
  }
  return bad;
}

/** pageComments 全体を検証して違反リストを返す */
export function validatePageComments(
  pageComments: Record<string, unknown> | null | undefined,
  ctx: { keywordFacts: KeywordRankFacts[]; reviewDeltas: number[]; metricFacts?: MetricFact[] },
): CommentViolation[] {
  if (!pageComments) return [];
  const violations: CommentViolation[] = [];

  // 排他的主張（「唯一の前年超え」等）はKPIに言及しうる全ページで検証する
  if (ctx.metricFacts && ctx.metricFacts.length > 0) {
    const kpiFields = ["monthly", "map", "search", "reactions", "summary"];
    for (const field of kpiFields) {
      const v = pageComments[field];
      if (typeof v !== "string" || !v) continue;
      for (const b of validateExclusivityClaims(v, ctx.metricFacts)) {
        violations.push({
          field,
          kind: "exclusivity_mismatch",
          message: `「${b.claim}」と書いているが、条件を満たす指標は複数ある: ${b.others.join(" / ")}。「唯一」は使えない`,
        });
      }
    }
  }

  // 順位に言及しうるページのみ対象にする（口コミ系の文中の「位」は順位ではない可能性がある）
  const rankFields = ["keyword", "rankingHistory", "grid", "summary", "monthly"];
  for (const field of rankFields) {
    const v = pageComments[field];
    if (typeof v !== "string" || !v) continue;
    for (const b of validateContinuityClaims(v, ctx.keywordFacts)) {
      violations.push({
        field,
        kind: "continuity_mismatch",
        message: `「${b.word}」について「${b.claim}」と書いているが、${b.reason}`,
      });
    }
    for (const b of validateRankMentions(v, ctx.keywordFacts)) {
      violations.push({
        field,
        kind: "rank_mismatch",
        message: `「${b.word}」を${b.rank}位と書いているが、そのキーワードの計測値に${b.rank}位は存在しない（実際の値: ${
          ctx.keywordFacts.find((f) => f.word === b.word)?.allowedRanks.join("位, ") || "不明"
        }位）`,
      });
    }
  }

  const deltaText = pageComments["reviewDelta"];
  if (typeof deltaText === "string" && deltaText) {
    for (const b of validateMonthlyAverage(deltaText, ctx.reviewDeltas)) {
      violations.push({
        field: "reviewDelta",
        kind: "average_mismatch",
        message: `直近${b.months}ヶ月の月平均を${b.claimed}件と書いているが、実際は${b.actual}件`,
      });
    }
  }

  return violations;
}

/** 違反内容を、再生成時にAIへ渡す修正指示文にする */
export function buildCorrectionPrompt(violations: CommentViolation[]): string {
  const lines = violations.map((v) => `- ${v.field}: ${v.message}`);
  const hasContinuity = violations.some((v) => v.kind === "continuity_mismatch");
  return [
    "直前の出力に、提供データと一致しない記述が含まれていた。以下を必ず修正すること。",
    ...lines,
    "",
    "重要: 順位・件数は提供データに書かれている数字をそのまま使うこと。",
    "似た名前のキーワードが複数ある場合、別のキーワードの数字を混同しないよう、",
    "各キーワードの行を1つずつ確認してから書くこと。",
    ...(hasContinuity
      ? [
          "",
          "「一度も下げていない」「常に」「全期間」のような例外を許さない表現は、",
          "推移データの全ての月を確認し、圏外や順位低下が1つも無い場合にだけ使うこと。",
          "1か月でも圏外や下落があるなら、その事実を含めて書くこと。",
        ]
      : []),
  ].join("\n");
}

/** キーワードの許容順位集合を、当月データと推移データから組み立てる */
export function buildKeywordFacts(
  current: { word: string; rank: number; prevRank: number }[],
  history?: { labels: string[]; datasets: { word: string; ranks: (number | null)[] }[] } | null,
): KeywordRankFacts[] {
  const byNorm = new Map<string, { word: string; ranks: Set<number> }>();
  const put = (word: string, rank: number | null | undefined) => {
    if (!word) return;
    const key = normalizeKw(word);
    if (!byNorm.has(key)) byNorm.set(key, { word, ranks: new Set() });
    if (typeof rank === "number" && rank > 0) byNorm.get(key)!.ranks.add(rank);
  };
  for (const k of current || []) {
    put(k.word, k.rank);
    put(k.word, k.prevRank);
  }
  // 継続性の主張を検証するため、順位の時系列も保持する
  // （null=未計測 / 0=圏外 / 1以上=順位。outOfRangeがあれば圏外を0で表す）
  const seriesByNorm = new Map<string, (number | null)[]>();
  for (const ds of history?.datasets || []) {
    for (const r of ds.ranks || []) put(ds.word, r);
    const oor = (ds as { outOfRange?: boolean[] }).outOfRange;
    const series = (ds.ranks || []).map((r, i) => {
      if (typeof r === "number" && r > 0) return r;
      if (oor?.[i] === true) return 0; // 明示的な圏外
      return null; // 未計測
    });
    seriesByNorm.set(normalizeKw(ds.word), series);
  }

  return Array.from(byNorm.entries())
    .filter(([, v]) => v.ranks.size > 0)
    .map(([key, v]) => ({
      word: v.word,
      allowedRanks: Array.from(v.ranks).sort((a, b) => a - b),
      series: seriesByNorm.get(key),
    }));
}
