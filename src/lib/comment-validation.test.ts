import { describe, it, expect } from "vitest";
import {
  validateRankMentions,
  validateMonthlyAverage,
  validatePageComments,
  buildKeywordFacts,
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
