import { describe, it, expect } from "vitest";
import {
  validateRankMentions,
  validateMonthlyAverage,
  validatePageComments,
  buildKeywordFacts,
  validateContinuityClaims,
} from "./comment-validation";

/**
 * 2026-08-01 デザインフードマーケット名古屋駅店のレポートで実際に出た誤りを固定する。
 * 表示は「名古屋 バル」15位→10位なのに、AI総評だけが9位と書いていた。
 * 隣の「名古屋駅 バル」の9位を引っ張ったものと見られる。
 */
const REAL_FACTS = buildKeywordFacts(
  [
    { word: "名古屋 バル", rank: 10, prevRank: 15 },
    { word: "名古屋駅 バル", rank: 9, prevRank: 9 },
    { word: "名駅 肉バル", rank: 5, prevRank: 8 },
  ],
  {
    labels: ["2025/12", "2026/1", "2026/2", "2026/4", "2026/5", "2026/6"],
    datasets: [
      { word: "名古屋 バル", ranks: [null, 11, 11, 2, 15, 10] },
      { word: "名古屋駅 バル", ranks: [35, 9, 9, 2, 9, 9] },
      { word: "名駅 肉バル", ranks: [46, 8, 8, 2, 8, 5] },
    ],
  },
);

describe("実際に出た誤りを検出できること", () => {
  it("P6: 「名古屋 バル」を9位と書いた誤りを検出する", () => {
    const text = "圏外転落キーワードはなく、「名古屋 バル」が前回15位から9位へ5ランク上昇したことが当月最大の改善点である";
    const bad = validateRankMentions(text, REAL_FACTS);
    expect(bad).toHaveLength(1);
    expect(bad[0]).toEqual({ rank: 9, word: "名古屋 バル" });
  });

  it("P7: 同一文に正しい9位と誤った9位が混在していても、誤りだけを検出する", () => {
    const text =
      "「名古屋駅 バル」は2026年1月から6月まで9位で安定しており、「名古屋 バル」は4月に2位を記録した後5月15位まで下げ、6月は9位へ回復基調にある";
    const bad = validateRankMentions(text, REAL_FACTS);
    // 名古屋駅 バルの9位は正しい / 名古屋 バルの2位・15位も実在する
    expect(bad).toHaveLength(1);
    expect(bad[0]).toEqual({ rank: 9, word: "名古屋 バル" });
  });

  it("P13: 直近6ヶ月の月平均の誤りを検出する", () => {
    const deltas = [2, 3, 2, 1, 3, 0, 1, 19, 1, 1, -1, 1, 2]; // 2025/6〜2026/6
    const text = "直近6ヶ月の月平均は+4.3件だが、2026年2月以降は月1〜2件と獲得ペースが低水準で推移しており、積極的な促進策が求められる";
    const bad = validateMonthlyAverage(text, deltas);
    expect(bad).toHaveLength(1);
    expect(bad[0].claimed).toBe(4.3);
    expect(bad[0].actual).toBe(3.8); // (19+1+1-1+1+2)/6
  });
});

describe("正しい記述を誤検知しないこと", () => {
  it("修正後の正しい文は違反ゼロ", () => {
    const text = "圏外転落キーワードはなく、「名古屋 バル」が前回15位から10位へ5ランク上昇したことが当月最大の改善点である";
    expect(validateRankMentions(text, REAL_FACTS)).toHaveLength(0);
  });

  it("過去月の順位への言及は正当（推移に存在すれば通す）", () => {
    const text = "「名古屋 バル」は1月11位、2月11位から4月に2位まで上げた";
    expect(validateRankMentions(text, REAL_FACTS)).toHaveLength(0);
  });

  it("「10位以内」のような閾値表現は順位として検証しない", () => {
    const text = "「名古屋駅 バル」は49地点中10位以内が8地点にとどまり改善余地が大きい";
    expect(validateRankMentions(text, REAL_FACTS)).toHaveLength(0);
  });

  it("キーワードが登場しない文は検証しない（帰属先が決められない）", () => {
    const text = "全体として上位表示は3位以内を目指したい";
    expect(validateRankMentions(text, REAL_FACTS)).toHaveLength(0);
  });

  it("平均が一致していれば違反なし（小数の丸めを許容）", () => {
    const deltas = [19, 1, 1, -1, 1, 2];
    expect(validateMonthlyAverage("直近6ヶ月の月平均は+3.8件", deltas)).toHaveLength(0);
  });

  it("データが足りない期間の主張は検証しない", () => {
    expect(validateMonthlyAverage("直近12ヶ月の月平均は+5.0件", [1, 2, 3])).toHaveLength(0);
  });
});

describe("キーワード名の取り違え防止", () => {
  it("長いキーワードを優先し、短い名前に誤って帰属させない", () => {
    // 「名古屋駅 バル」の記述を「名古屋 バル」のものと誤認すると、9位が違反になってしまう
    const text = "「名古屋駅 バル」は9位で安定している";
    expect(validateRankMentions(text, REAL_FACTS)).toHaveLength(0);
  });

  it("全角数字でも検出する", () => {
    const text = "「名古屋 バル」は６月に９位へ回復した";
    const bad = validateRankMentions(text, REAL_FACTS);
    expect(bad).toHaveLength(1);
    expect(bad[0].rank).toBe(9);
  });

  it("空白の有無が違っても同じキーワードとして扱う", () => {
    const text = "「名古屋バル」が9位へ上昇した";
    const bad = validateRankMentions(text, REAL_FACTS);
    expect(bad).toHaveLength(1);
  });
});

describe("validatePageComments", () => {
  it("ページ単位で違反を集約する", () => {
    const pc = {
      keyword: "「名古屋 バル」が前回15位から9位へ5ランク上昇した",
      rankingHistory: "「名古屋駅 バル」は9位で安定している",
      reviewDelta: "直近6ヶ月の月平均は+4.3件だが獲得ペースは低水準",
      reviews: ["これは配列なので対象外"],
    };
    const violations = validatePageComments(pc, {
      keywordFacts: REAL_FACTS,
      reviewDeltas: [2, 3, 2, 1, 3, 0, 1, 19, 1, 1, -1, 1, 2],
    });
    expect(violations).toHaveLength(2);
    expect(violations.map((v) => v.field).sort()).toEqual(["keyword", "reviewDelta"]);
  });

  it("問題が無ければ空", () => {
    const pc = { keyword: "「名古屋 バル」が前回15位から10位へ上昇した" };
    expect(
      validatePageComments(pc, { keywordFacts: REAL_FACTS, reviewDeltas: [] }),
    ).toHaveLength(0);
  });

  it("pageCommentsが無い場合も落ちない", () => {
    expect(validatePageComments(null, { keywordFacts: REAL_FACTS, reviewDeltas: [] })).toEqual([]);
    expect(validatePageComments(undefined, { keywordFacts: [], reviewDeltas: [] })).toEqual([]);
  });
});

describe("buildKeywordFacts", () => {
  it("当月・前回・推移の全順位を許容集合にまとめる", () => {
    const facts = buildKeywordFacts(
      [{ word: "テスト KW", rank: 5, prevRank: 8 }],
      { labels: ["2026/5", "2026/6"], datasets: [{ word: "テスト KW", ranks: [12, 5] }] },
    );
    expect(facts).toHaveLength(1);
    expect(facts[0].allowedRanks).toEqual([5, 8, 12]);
  });

  it("圏外(0)やnullは許容集合に入れない", () => {
    const facts = buildKeywordFacts([{ word: "KW", rank: 0, prevRank: 3 }], {
      labels: ["2026/6"],
      datasets: [{ word: "KW", ranks: [null] }],
    });
    expect(facts[0].allowedRanks).toEqual([3]);
  });

  it("順位が1つも無いキーワードは対象外（検証しようがない）", () => {
    expect(buildKeywordFacts([{ word: "KW", rank: 0, prevRank: 0 }], null)).toHaveLength(0);
  });
});

/**
 * 2026-08-01 _WHITE 鳳店のレポートP7で実際に出た誤り。
 * 表: 鳳 美容室 = 1月圏外 / 2月1位 / 3月圏外 / 4月1位 / 5月1位 / 6月1位
 * AI: 「一度も1位を下げることなく安定している」
 * 3月に圏外へ落ちているが、文中の「1位」は実在するため数値照合では通らない。
 */
const HOU_FACTS = buildKeywordFacts(
  [
    { word: "鳳 美容室", rank: 1, prevRank: 1 },
    { word: "鳳 美容院", rank: 1, prevRank: 1 },
  ],
  {
    labels: ["2026/1", "2026/2", "2026/3", "2026/4", "2026/5", "2026/6"],
    datasets: [
      // 1月圏外 / 3月圏外（outOfRangeで明示）
      {
        word: "鳳 美容室",
        ranks: [null, 1, null, 1, 1, 1],
        outOfRange: [true, false, true, false, false, false],
      } as any,
      // こちらは1月と3月が未計測（圏外ではない）
      {
        word: "鳳 美容院",
        ranks: [null, 1, null, 1, 1, 1],
        outOfRange: [false, false, false, false, false, false],
      } as any,
    ],
  },
);

describe("継続性の主張の検証（2026-08-01 P7の実例）", () => {
  it("圏外の月があるのに「一度も下げていない」と書いた誤りを検出する", () => {
    const text = "「鳳 美容室」は2026年2月の計測開始以降、一度も1位を下げることなく安定している";
    const bad = validateContinuityClaims(text, HOU_FACTS);
    expect(bad).toHaveLength(1);
    expect(bad[0].word).toBe("鳳 美容室");
    expect(bad[0].reason).toBe("計測期間中に圏外の月がある");
  });

  it("未計測の月があるだけなら誤りとしない（未計測は「下がった」ではない）", () => {
    const text = "「鳳 美容院」は一度も1位を下げていない";
    expect(validateContinuityClaims(text, HOU_FACTS)).toHaveLength(0);
  });

  it("順位が下がった月があれば検出する", () => {
    const facts = buildKeywordFacts([{ word: "テストKW", rank: 3, prevRank: 5 }], {
      labels: ["2026/4", "2026/5", "2026/6"],
      datasets: [{ word: "テストKW", ranks: [1, 5, 3] }],
    });
    const bad = validateContinuityClaims("「テストKW」は常に上位を維持している", facts);
    expect(bad).toHaveLength(1);
    expect(bad[0].reason).toBe("計測期間中に順位が下がった月がある");
  });

  it("本当に一度も下がっていなければ違反にしない", () => {
    const facts = buildKeywordFacts([{ word: "安定KW", rank: 1, prevRank: 1 }], {
      labels: ["2026/4", "2026/5", "2026/6"],
      datasets: [{ word: "安定KW", ranks: [1, 1, 1] }],
    });
    expect(validateContinuityClaims("「安定KW」は一度も1位を下げていない", facts)).toHaveLength(0);
  });

  it("順位が改善し続けている場合も違反にしない", () => {
    const facts = buildKeywordFacts([{ word: "改善KW", rank: 1, prevRank: 3 }], {
      labels: ["2026/4", "2026/5", "2026/6"],
      datasets: [{ word: "改善KW", ranks: [5, 3, 1] }],
    });
    expect(validateContinuityClaims("「改善KW」は常に改善している", facts)).toHaveLength(0);
  });

  it("断定表現でなければ対象外（多少の上下でも自然に使える表現）", () => {
    // 「安定している」単体は許容する。厳しくすると正しい文まで弾いてしまう
    const text = "「鳳 美容室」は安定している";
    expect(validateContinuityClaims(text, HOU_FACTS)).toHaveLength(0);
  });

  it("キーワードが登場しない文は検証しない（帰属先が決められない）", () => {
    expect(validateContinuityClaims("全体として一度も下がっていない", HOU_FACTS)).toHaveLength(0);
  });

  it("計測が1回しかない場合は継続性を判定しない", () => {
    const facts = buildKeywordFacts([{ word: "初回KW", rank: 1, prevRank: 0 }], {
      labels: ["2026/6"],
      datasets: [{ word: "初回KW", ranks: [1] }],
    });
    expect(validateContinuityClaims("「初回KW」は常に1位", facts)).toHaveLength(0);
  });

  it("pageComments経由でも検出される", () => {
    const violations = validatePageComments(
      { rankingHistory: "「鳳 美容室」は一度も1位を下げることなく安定している" },
      { keywordFacts: HOU_FACTS, reviewDeltas: [] },
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe("continuity_mismatch");
  });
});
