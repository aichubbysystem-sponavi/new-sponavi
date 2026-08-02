import { describe, it, expect } from "vitest";
import {
  validateRankMentions,
  validateMonthlyAverage,
  validatePageComments,
  buildKeywordFacts,
  validateContinuityClaims,
  validateOutOfRangeClaims,
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

// ── 2026-08-02 実レポートで見つかった誤検知・誤りの再発防止 ──
import { validateExclusivityClaims, type MetricFact } from "./comment-validation";

describe("validateRankMentions 誤検知の再発防止", () => {
  const FACTS = buildKeywordFacts([{ word: "名古屋 バル", rank: 10, prevRank: 15 }], {
    labels: ["2026/5", "2026/6"],
    datasets: [{ word: "名古屋 バル", ranks: [15, 10] }],
  });

  it("「5位上昇」のような変動幅は順位として検証しない", () => {
    expect(validateRankMentions("「名古屋 バル」は前回15位から10位へ5位上昇した", FACTS)).toHaveLength(0);
  });

  it("「3位下落」も変動幅として除外する", () => {
    expect(validateRankMentions("「名古屋 バル」は前回から3位下落し", FACTS)).toHaveLength(0);
  });

  it("小数の平均順位「12.4位」の小数点以下を順位として拾わない", () => {
    expect(validateRankMentions("「名古屋 バル」の平均順位は12.4位だった", FACTS)).toHaveLength(0);
  });

  it("「平均17.3位」も誤検知しない", () => {
    expect(validateRankMentions("「名古屋 バル」は49地点中 平均17.3位", FACTS)).toHaveLength(0);
  });

  it("本物の誤り（存在しない9位）は引き続き検出する", () => {
    expect(validateRankMentions("「名古屋 バル」が9位へ上昇", FACTS)).toHaveLength(1);
  });
});

describe("validateContinuityClaims 話題違いの誤検知防止", () => {
  const FACTS = buildKeywordFacts([{ word: "鳳 美容室", rank: 1, prevRank: 1 }], {
    labels: ["2026/1", "2026/2", "2026/3", "2026/4"],
    datasets: [{ word: "鳳 美容室", ranks: [null, 1, null, 1], outOfRange: [true, false, true, false] } as any],
  });

  it("順位と無関係な文の「常に」は検証しない（口コミの話題）", () => {
    // 前の文に順位キーワードがあっても、「常に」の文が口コミの話なら対象外
    const text = "「鳳 美容室」は1位を維持。口コミは常に増加しており好調である";
    expect(validateContinuityClaims(text, FACTS)).toHaveLength(0);
  });

  it("同じ文で順位の継続性を偽って主張したら検出する", () => {
    const text = "「鳳 美容室」は常に1位を維持している";
    expect(validateContinuityClaims(text, FACTS)).toHaveLength(1);
  });

  it("別の文のキーワードには帰属させない", () => {
    const text = "「鳳 美容室」は好調。エリア全体では常に上位表示が続く order";
    // キーワードが「常に」と別の文にあるため帰属先なし → 検証しない
    expect(validateContinuityClaims(text, FACTS)).toHaveLength(0);
  });
});

describe("validateExclusivityClaims（唯一の◯◯）", () => {
  // 2026-08-02 Queency: Web +12.1% と メニュー +43.7% の両方が前年超えなのに
  // 「ウェブサイトクリックは唯一の前年超え」と書かれた
  const METRICS: MetricFact[] = [
    { label: "Google検索 合計", momPct: 14.2, yoyPct: -15.1 },
    { label: "Googleマップ 合計", momPct: -2.4, yoyPct: -67.4 },
    { label: "ウェブサイトクリック", momPct: -1.2, yoyPct: 12.1 },
    { label: "フードメニュークリック", momPct: 5.4, yoyPct: 43.7 },
    { label: "通話", momPct: -20.9, yoyPct: -20.3 },
  ];

  it("前年超えが2つあるのに「唯一の前年超え」と書いたら検出する", () => {
    const bad = validateExclusivityClaims("ウェブサイトクリックは前年同月比+12%と唯一の前年超えを示す", METRICS);
    expect(bad).toHaveLength(1);
    expect(bad[0].others.join()).toContain("フードメニュークリック");
  });

  it("本当に唯一なら通す", () => {
    const only: MetricFact[] = [
      { label: "A", momPct: 3, yoyPct: 5 },
      { label: "B", momPct: -1, yoyPct: -2 },
    ];
    expect(validateExclusivityClaims("Aは唯一の前年超えとなった", only)).toHaveLength(0);
  });

  it("比較基準が読み取れない「唯一」は検証しない", () => {
    expect(validateExclusivityClaims("唯一の強みは接客である", METRICS)).toHaveLength(0);
  });

  it("前月比の「唯一のプラス」も複数あれば検出する", () => {
    const bad = validateExclusivityClaims("Google検索は前月比で唯一のプラスとなった", METRICS);
    expect(bad).toHaveLength(1); // 検索+14.2 とメニュー+5.4 の2つある
  });

  it("pageComments経由（metricFacts付き）でも検出される", () => {
    const violations = validatePageComments(
      { reactions: "ウェブサイトクリックは前年同月比+12%と唯一の前年超えを示す" },
      { keywordFacts: [], reviewDeltas: [], metricFacts: METRICS },
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe("exclusivity_mismatch");
  });
});

describe("validateOutOfRangeClaims 圏外主張の照合（2026-08-02 patty rôtiで実際に出た誤り）", () => {
  // 表: 一社 イタリアン = 前回1位 → 当月「未計測」 / 名東区 パスタ = 前回1位 → 当月「圏外」
  const FACTS = buildKeywordFacts(
    [{ word: "名東区 パスタ", rank: 0, prevRank: 1 }],
    {
      labels: ["2026/1", "2026/4", "2026/6"],
      datasets: [
        { word: "一社 イタリアン", ranks: [1, 1, null], outOfRange: [false, false, false] } as any,
        { word: "名東区 パスタ", ranks: [2, 1, null], outOfRange: [false, false, true] } as any,
      ],
    },
  );

  it("未計測のキーワードを「圏外へ転落」と書いた誤りを検出する", () => {
    const text = "「一社 イタリアン」が前回1位から圏外へ転落しており、検索流入への影響が懸念される";
    const bad = validateOutOfRangeClaims(text, FACTS);
    expect(bad).toHaveLength(1);
    expect(bad[0].word).toBe("一社 イタリアン");
  });

  it("転落したキーワードを「圏外が継続」と書いた誤りを検出する", () => {
    const text = "「名東区 パスタ」も圏外が継続している";
    const bad = validateOutOfRangeClaims(text, FACTS);
    expect(bad).toHaveLength(1);
    expect(bad[0].word).toBe("名東区 パスタ");
    expect(bad[0].reason).toContain("1位");
  });

  it("実際に出た誤り（2主張が1文に混在）を両方検出する", () => {
    const text =
      "「一社 イタリアン」が前回1位から圏外へ転落しており、同様に「名東区 パスタ」も圏外が継続している。最優先で原因を特定し回復施策に着手する必要がある";
    const bad = validateOutOfRangeClaims(text, FACTS);
    expect(bad).toHaveLength(2);
    expect(bad.map((b) => b.word).sort()).toEqual(["一社 イタリアン", "名東区 パスタ"]);
  });

  it("正しい記述（パスタ=転落）は誤検知しない", () => {
    const text = "「名東区 パスタ」が前回1位から圏外へ転落しており、早期の回復施策が必要となる";
    expect(validateOutOfRangeClaims(text, FACTS)).toHaveLength(0);
  });

  it("予防・仮定の表現（圏外転落を防ぐ）は主張ではないので検証しない", () => {
    const text = "「一社 イタリアン」の上位維持を図り、圏外転落を防ぐ施策を継続したい";
    expect(validateOutOfRangeClaims(text, FACTS)).toHaveLength(0);
  });

  it("seriesを持たないキーワードは検証しない", () => {
    const noSeries = buildKeywordFacts([{ word: "一社 ランチ", rank: 2, prevRank: 2 }], null);
    const text = "「一社 ランチ」は圏外へ転落した";
    expect(validateOutOfRangeClaims(text, noSeries)).toHaveLength(0);
  });

  it("validatePageComments経由でkeywordページの圏外誤りを検出する", () => {
    const violations = validatePageComments(
      { keyword: "「一社 イタリアン」が前回1位から圏外へ転落した" },
      { keywordFacts: FACTS, reviewDeltas: [] },
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe("out_of_range_mismatch");
    expect(violations[0].field).toBe("keyword");
  });

  it("gridページの「9地点中圏外が5地点」は対象外（地点の話でありKWの状態ではない）", () => {
    const violations = validatePageComments(
      { grid: "「一社 イタリアン」は9地点中圏外が5地点あり、北側の商圏を取りこぼしている" },
      { keywordFacts: FACTS, reviewDeltas: [] },
    );
    expect(violations).toHaveLength(0);
  });
});
