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
  kind: "rank_mismatch" | "average_mismatch" | "continuity_mismatch" | "exclusivity_mismatch" | "out_of_range_mismatch"
    | "seasonality_claim" | "deletion_claim" | "small_sample_claim";
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
    if (/^(以[内上下]|上昇|上げ|アップ|改善|浮上|回復|下落|下降|低下|ダウン|後退|悪化|下げ|転落|分|圏外|圏内|台)/.test(after)) continue;
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

/**
 * 「圏外へ転落」「圏外が継続」のような圏外の主張を、順位の時系列と突き合わせる。
 *
 * 【なぜ必要か】
 * 2026-08-02 patty rôtiのレポートP6で実際に発生:
 *   表: 一社 イタリアン = 前回1位 → 当月「未計測」 / 名東区 パスタ = 前回1位 → 当月「圏外」
 *   AI: 「一社 イタリアン」が前回1位から圏外へ転落しており、同様に「名東区 パスタ」も圏外が継続している
 * 転落したのはパスタ、イタリアンは未計測なのに、2つのキーワードの状態が入れ替わっていた。
 * 「1位」は両KWの実データに存在するため数値照合(validateRankMentions)では通過してしまう。
 * 誤っているのは順位ではなく「圏外」という状態の帰属の方。
 *
 * 【誤検知を避ける方針】
 * - series（未計測=null / 圏外=0 / 順位=正数）を持つキーワードだけ検証する
 * - 同じ文の中でキーワードの直後に出た「圏外」だけをそのキーワードの主張とみなす
 * - 「圏外転落を防ぐ」「圏外にならないよう」等の予防・仮定表現は主張ではないので除外
 * - 確実に矛盾するものだけ違反にする:
 *   a) 全計測に圏外の月が1つも無いのに圏外と書いた
 *   b) 「転落」と書いたが「順位→圏外」の推移が計測上存在しない
 *   c) 「継続」と書いたが直近2計測が圏外×2になっていない
 */
export function validateOutOfRangeClaims(
  text: string,
  facts: KeywordRankFacts[],
): { word: string; claim: string; reason: string }[] {
  if (!text || facts.length === 0) return [];
  const normalized = toHalfWidthDigits(text);
  // 注意: mentionsが空でも早期returnしない。「圏外転落のキーワードはなく」のような
  // 全体への不在の主張はキーワード名を含まないため、ここで返すと検証できない
  const mentions = findKeywordMentions(normalized, facts);

  const bad: { word: string; claim: string; reason: string }[] = [];
  const re = /圏外/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalized)) !== null) {
    const pos = m.index;
    const sentStart = Math.max(normalized.lastIndexOf("。", pos), normalized.lastIndexOf("\n", pos)) + 1;
    let sentEnd = normalized.indexOf("。", pos);
    if (sentEnd < 0) sentEnd = normalized.length;

    // 予防・仮定・否定の文脈は「圏外である/圏外が無い」という事実主張ではない。
    // 【判定順が重要】2026-08-02のレビューで発覚: この除外を下の不在主張チェックより
    // 後ろに置いていたため、「圏外に転落しないよう対策を継続する」という正しい予防文が、
    // 不在主張の alternation「ない」に部分一致して違反になっていた
    // （転落KWが実在する月に、正しい総評ごとkeywordページが空欄化される実害があった）。
    // 事実主張でないものは、どの判定より先に落とす
    const around = normalized.slice(Math.max(sentStart, pos - 12), Math.min(sentEnd, pos + 20));
    if (/(防|回避|避け|リスク|懸念|恐れ|注意|可能性|ないよう|しないよう|せず|なければ|しないため|ないため)/.test(around)) continue;

    // 「圏外転落のキーワードはなく」のような不在の主張。
    // 2026-08-02 patty rôti再分析で発生: 「名東区 パスタ」が4月1位→当月圏外なのに
    // 「今月は圏外転落のキーワードはなく、全キーワードが順位圏内を維持」と書かれた。
    // （当月のグリッド未計測KWはAIの当月ブロックに載らず、推移系列だけで渡るため見落とされる）
    // 直近計測が「順位→圏外」のKWがいれば、不在の主張は確実に矛盾する
    const tail = normalized.slice(pos, Math.min(sentEnd, pos + 30));
    if (/[へに]?転落[^。]{0,12}(なく|なかった|ない|無く|無い|見られず|見られない|おらず|ゼロ|発生していない|起きていない)/.test(tail)) {
      // 同じ文の直前にKWがあればそのKW限定の主張、無ければ全KWへの主張とみなす
      let subj: KeywordRankFacts | null = null;
      for (const mention of mentions) {
        if (mention.index >= sentStart && mention.index < pos) subj = mention.fact;
        if (mention.index >= pos) break;
      }
      const fellNow = (f: KeywordRankFacts) => {
        const ms = (f.series || []).filter((r): r is number => r !== null);
        return ms.length >= 2 && ms[ms.length - 1] === 0 && ms[ms.length - 2] > 0;
      };
      const fallen = subj ? [subj].filter(fellNow) : facts.filter(fellNow);
      if (fallen.length > 0) {
        bad.push({
          word: fallen.map((f) => f.word).join("・"),
          claim: normalized.slice(sentStart, Math.min(sentEnd, pos + 20)).trim(),
          reason: `実際には${fallen.map((f) => `「${f.word}」`).join("")}が直近の計測で順位から圏外へ転落している（推移データの最終計測を確認すること）`,
        });
      }
      continue;
    }

    // 帰属: 同じ文の中で直前に登場したキーワード
    let owner: KeywordRankFacts | null = null;
    let ownerIndex = -1;
    for (const mention of mentions) {
      if (mention.index >= sentStart && mention.index < pos) { owner = mention.fact; ownerIndex = mention.index; }
      if (mention.index >= pos) break;
    }
    if (!owner || !owner.series || owner.series.length === 0) continue;
    // キーワードと圏外の間に別のキーワードが挟まっていないことは
    // 「直前に登場したもの」を採ることで保証される（最後の出現が帰属先）

    const measured = owner.series.filter((r): r is number => r !== null);
    if (measured.length === 0) continue;
    const claim = normalized.slice(Math.max(sentStart, ownerIndex), Math.min(sentEnd, pos + 12)).trim();

    // a) 計測データに圏外の月が1つも無い（未計測を圏外扱いした典型パターン）
    if (!measured.some((r) => r === 0)) {
      const last = measured[measured.length - 1];
      bad.push({
        word: owner.word,
        claim,
        reason: `計測データに圏外の月が存在しない（未計測はデータが無いだけで圏外ではない。直近の計測値は${last > 0 ? `${last}位` : "不明"}）`,
      });
      continue;
    }

    const after = normalized.slice(pos, Math.min(sentEnd, pos + 10));
    // b) 「圏外へ転落」: 順位→圏外の推移が計測上存在するか
    if (/^圏外[へにと]?\s*(転落|後退|沈|落ち)/.test(after)) {
      const fell = measured.some((r, i) => i > 0 && measured[i - 1] > 0 && r === 0);
      if (!fell) {
        bad.push({ word: owner.word, claim, reason: "順位から圏外に落ちた推移が計測上存在しない" });
      }
      continue;
    }
    // c) 「圏外が継続/圏外のまま」: 直近2計測がともに圏外か
    if (/^圏外(が|の|状態)?\s*(継続|まま|続い|続き)/.test(after) || /(引き続き|依然|変わらず)/.test(normalized.slice(Math.max(sentStart, pos - 12), pos))) {
      const lastTwo = measured.slice(-2);
      if (!(lastTwo.length === 2 && lastTwo[0] === 0 && lastTwo[1] === 0)) {
        const prev = lastTwo.length === 2 ? lastTwo[0] : null;
        bad.push({
          word: owner.word,
          claim,
          reason: prev !== null && prev > 0
            ? `前回の計測は${prev}位であり、圏外の継続ではない（今回が転落）`
            : "直近2計測がともに圏外になっていないため「継続」とは言えない",
        });
      }
      continue;
    }
  }
  return bad;
}

/**
 * 「季節変動」等による説明の検出。
 * 季節性の判断には前年同時期のデータが要るが、AIに渡していない（2026-08-16のレビューで
 * 実際に「直近の減少は季節変動の範囲内とみられる」という根拠のない断定が出荷された）。
 * プロンプトでも禁止しているが、破られた場合にここで止める。
 */
export function validateSeasonalityClaims(text: string): string[] {
  const m = text.match(/季節(変動|性|要因)/g);
  return m ? Array.from(new Set(m)) : [];
}

/**
 * 「削除・非表示が相殺している」系の主張の検証。
 * 累計が実際に減った月が無い（= 月間増減に負の値が無い）のに削除・非表示を
 * 持ち出すと、単に新規投稿が無かっただけの月で「消されているかも」という
 * 不要な不安をクライアントに与える（2026-08-16のレビューで実際に発生）。
 */
export function validateDeletionClaims(text: string, reviewDeltas: number[]): boolean {
  if (!/削除|非表示/.test(text)) return false;
  const hasNegativeMonth = reviewDeltas.some((d) => typeof d === "number" && d < 0);
  return !hasNegativeMonth;
}

/**
 * 少数サンプルからの断定の検証（言語別分析向け）。
 * 文中で件数付きで言及された最大件数が5件未満なのに、満足度・課題などを
 * 断定している場合を違反とする（例: 外国語口コミ3件から「インバウンド顧客の
 * 満足度には課題」— 2026-08-16のレビューで実際に発生）。
 * %のみで件数が書かれていない文は判定できないため通す（プロンプト側で抑制）。
 */
export function validateSmallSampleClaims(text: string): boolean {
  const counts = Array.from(text.matchAll(/(\d+)\s*件/g)).map((m) => parseInt(m[1], 10));
  if (counts.length === 0) return false;
  if (Math.max(...counts) >= 5) return false;
  // 「傾向は判断できない」のような断定回避の文は模範解答なので違反にしない。
  // これを許容しないと、correction が提案する書き直し自体が再び違反になり、
  // 再生成上限まで直らず総評が空にされるループになる（クインシー 2026-08-16 で発生）
  if (/(判断|評価|断定)(は|が|も)?\s*(でき(ない|ず|かね)|難しい|困難)/.test(text)) return false;
  return /(課題|満足度|不満|懸念|傾向)/.test(text);
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
    const kpiFields = ["monthly", "overall", "map", "search", "reactions", "summary"];
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
  const rankFields = ["keyword", "rankingHistory", "grid", "summary", "monthly", "overall"];
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

  // 圏外の主張はキーワードの状態を語るページのみ対象にする。
  // grid（多地点）ページの「9地点中圏外が5地点」は地点の話であり、KWの中心順位系列とは別物なので対象外
  for (const field of ["keyword", "rankingHistory"]) {
    const v = pageComments[field];
    if (typeof v !== "string" || !v) continue;
    for (const b of validateOutOfRangeClaims(v, ctx.keywordFacts)) {
      violations.push({
        field,
        kind: "out_of_range_mismatch",
        message: `「${b.word}」について「${b.claim}」と書いているが、${b.reason}`,
      });
    }
  }

  // 季節変動の断定（KPIを語りうる全ページが対象）
  for (const field of ["monthly", "overall", "map", "search", "reactions"]) {
    const v = pageComments[field];
    if (typeof v !== "string" || !v) continue;
    const words = validateSeasonalityClaims(v);
    if (words.length > 0) {
      violations.push({
        field,
        kind: "seasonality_claim",
        message: `「${words.join("」「")}」による説明が含まれるが、季節性を確認できる前年同時期データは提供していない。理由が不明な変動は理由を書かず、減少幅と水準の事実だけを書くこと`,
      });
    }
  }

  // 削除・非表示の相殺主張（累計が減った月が無いのに書いている）
  const countText = pageComments["reviewCount"];
  if (typeof countText === "string" && countText && validateDeletionClaims(countText, ctx.reviewDeltas)) {
    violations.push({
      field: "reviewCount",
      kind: "deletion_claim",
      message: "削除・非表示の可能性に言及しているが、提供された推移に累計が減った月は無い。削除・非表示への言及を削り、新規投稿の状況だけを書くこと",
    });
  }

  // 少数サンプルからの断定（言語別分析）
  const langText = pageComments["language"];
  if (typeof langText === "string" && langText && validateSmallSampleClaims(langText)) {
    violations.push({
      field: "language",
      kind: "small_sample_claim",
      message: "5件未満の件数を根拠に満足度・課題を断定している。件数が少ない言語は「件数が少なく傾向は判断できない」に留めるか、言及しないこと",
    });
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
  const hasOutOfRange = violations.some((v) => v.kind === "out_of_range_mismatch");
  return [
    "直前の出力に、提供データと一致しない記述が含まれていた。以下を必ず修正すること。",
    ...lines,
    "",
    "重要: 順位・件数は提供データに書かれている数字をそのまま使うこと。",
    "似た名前のキーワードが複数ある場合、別のキーワードの数字を混同しないよう、",
    "各キーワードの行を1つずつ確認してから書くこと。",
    ...(hasOutOfRange
      ? [
          "",
          "「圏外」と書いてよいのは、提供データでそのキーワードに「圏外」と明記されている場合だけ。",
          "「未計測」は計測データが無いだけで圏外という意味ではない。未計測のキーワードの当月変動には言及しないこと。",
          "「圏外へ転落」はデータ上で順位→圏外の推移があるキーワードにだけ、「圏外が継続」は直近2計測とも圏外のキーワードにだけ使うこと。",
        ]
      : []),
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
