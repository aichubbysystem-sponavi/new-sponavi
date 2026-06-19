import { describe, it, expect } from "vitest";
import {
  pctChange,
  monthToNum,
  rankColor,
  rankTextColor,
  rankColorModal,
  reviewDeltaColor,
  reorderKpis,
  formatAIComment,
  splitCommentPages,
  diffColor,
  formatDiff,
  COLORS,
  CHART_COLORS,
  AI_COMMENT_HEADINGS,
  KPI,
} from "./report-utils";

describe("pctChange", () => {
  it("正常な増加", () => {
    const r = pctChange(110, 100);
    expect(r.pct).toBeCloseTo(10);
    expect(r.text).toBe("+10.0%");
    expect(r.isUp).toBe(true);
    expect(r.isFlat).toBe(false);
  });

  it("正常な減少", () => {
    const r = pctChange(90, 100);
    expect(r.pct).toBeCloseTo(-10);
    expect(r.text).toBe("-10.0%");
    expect(r.isUp).toBe(false);
  });

  it("変化なし", () => {
    const r = pctChange(100, 100);
    expect(r.isFlat).toBe(true);
    expect(r.text).toBe("+0.0%");
  });

  it("前月0, 今月0", () => {
    const r = pctChange(0, 0);
    expect(r.pct).toBe(0);
    expect(r.isFlat).toBe(true);
  });

  it("前月0, 今月>0", () => {
    const r = pctChange(100, 0);
    expect(r.text).toBe("+∞");
    expect(r.isUp).toBe(true);
  });
});

describe("monthToNum", () => {
  it("通常の月", () => {
    expect(monthToNum("2026/5")).toBe(202605);
    expect(monthToNum("2025/12")).toBe(202512);
  });

  it("不正な入力", () => {
    expect(monthToNum("")).toBe(0);
    expect(monthToNum("abc")).toBe(0);
  });

  it("ソート順", () => {
    expect(monthToNum("2026/1")).toBeGreaterThan(monthToNum("2025/12"));
    expect(monthToNum("2025/10")).toBeGreaterThan(monthToNum("2025/9"));
  });
});

describe("rankColor", () => {
  it("1-3位は青", () => {
    expect(rankColor(1)).toBe(COLORS.rank1to3);
    expect(rankColor(3)).toBe(COLORS.rank1to3);
  });

  it("4-10位は緑", () => {
    expect(rankColor(4)).toBe(COLORS.rank4to10);
    expect(rankColor(10)).toBe(COLORS.rank4to10);
  });

  it("11-20位は黄", () => {
    expect(rankColor(11)).toBe(COLORS.rank11to20);
    expect(rankColor(20)).toBe(COLORS.rank11to20);
  });

  it("21位以上は赤", () => {
    expect(rankColor(21)).toBe(COLORS.rank21plus);
    expect(rankColor(100)).toBe(COLORS.rank21plus);
  });

  it("圏外(0以下)はグレー", () => {
    expect(rankColor(0)).toBe(COLORS.rankOut);
    expect(rankColor(-1)).toBe(COLORS.rankOut);
  });
});

describe("rankTextColor", () => {
  it("1-3位はダーク青", () => {
    expect(rankTextColor(1)).toBe(COLORS.rank1to3Dark);
    expect(rankTextColor(3)).toBe(COLORS.rank1to3Dark);
  });

  it("4-10位はダーク緑", () => {
    expect(rankTextColor(4)).toBe(COLORS.rank4to10Dark);
  });
});

describe("rankColorModal", () => {
  it("1-3位の背景は青系", () => {
    const r = rankColorModal(1);
    expect(r.color).toBe("#2563eb");
    expect(r.bg).toContain("37,99,235");
  });

  it("4-10位の背景は緑系", () => {
    const r = rankColorModal(5);
    expect(r.color).toBe("#16a34a");
  });
});

describe("reviewDeltaColor", () => {
  it("20件以上は緑", () => {
    expect(reviewDeltaColor(20)).toBe(CHART_COLORS.deltaGreen);
    expect(reviewDeltaColor(30)).toBe(CHART_COLORS.deltaGreen);
  });

  it("10-19件は黄", () => {
    expect(reviewDeltaColor(10)).toBe(CHART_COLORS.deltaYellow);
    expect(reviewDeltaColor(19)).toBe(CHART_COLORS.deltaYellow);
  });

  it("1-9件は赤", () => {
    expect(reviewDeltaColor(1)).toBe(CHART_COLORS.deltaRed);
    expect(reviewDeltaColor(9)).toBe(CHART_COLORS.deltaRed);
  });

  it("0件はグレー", () => {
    expect(reviewDeltaColor(0)).toBe(CHART_COLORS.deltaGray);
  });
});

describe("reorderKpis", () => {
  const makeKpis = (labels: string[]): KPI[] =>
    labels.map(label => ({ label, value: 100, prevValue: 90, unit: "回" }));

  it("検索→マップの順ならマップを先にする", () => {
    const kpis = makeKpis(["Google検索 合計", "Googleマップ 合計", "ウェブサイトクリック"]);
    const result = reorderKpis(kpis);
    expect(result[0].label).toBe("Googleマップ 合計");
    expect(result[1].label).toBe("Google検索 合計");
    expect(result[2].label).toBe("ウェブサイトクリック");
  });

  it("既にマップ→検索の順なら変更しない", () => {
    const kpis = makeKpis(["Googleマップ 合計", "Google検索 合計", "ウェブサイトクリック"]);
    const result = reorderKpis(kpis);
    expect(result[0].label).toBe("Googleマップ 合計");
    expect(result[1].label).toBe("Google検索 合計");
  });

  it("元の配列を変更しない（イミュータブル）", () => {
    const kpis = makeKpis(["Google検索 合計", "Googleマップ 合計"]);
    const original = [...kpis];
    reorderKpis(kpis);
    expect(kpis[0].label).toBe(original[0].label);
  });

  it("マップ・検索がない場合はそのまま返す", () => {
    const kpis = makeKpis(["ウェブサイトクリック", "通話"]);
    const result = reorderKpis(kpis);
    expect(result).toEqual(kpis);
  });

  it("検索が先頭でない場合は並べ替えない", () => {
    const kpis = makeKpis(["ウェブサイトクリック", "Google検索 合計", "Googleマップ 合計"]);
    const result = reorderKpis(kpis);
    expect(result[0].label).toBe("ウェブサイトクリック");
    expect(result[1].label).toBe("Google検索 合計");
  });

  it("空配列", () => {
    expect(reorderKpis([])).toEqual([]);
  });
});

describe("formatAIComment", () => {
  it("先頭の【見出し】を除去", () => {
    expect(formatAIComment("【数値分析】マップ表示数は...", 0)).not.toContain("【数値分析】");
  });

  it("箇条書き「・」を改行に変換", () => {
    const result = formatAIComment("内容1・内容2・内容3", 0);
    expect(result).toContain("<br>・内容2");
    expect(result).toContain("<br>・内容3");
  });

  it("a) b) c) を改行に変換", () => {
    const result = formatAIComment("施策a) 口コミ促進b) 投稿強化", 0);
    expect(result).toContain("<br>a)");
    expect(result).toContain("<br>b)");
  });

  it("評価値を置換", () => {
    const result = formatAIComment("評価4.5 / 5.0です", 3.9);
    expect(result).toContain("3.9 / 5.0");
  });

  it("先頭の<br>を除去", () => {
    const result = formatAIComment("・項目1・項目2", 0);
    expect(result).not.toMatch(/^<br>/);
  });
});

describe("splitCommentPages", () => {
  it("短いコメントは1ページ", () => {
    const pages = splitCommentPages(["短い", "コメント", "3つ"], 800);
    expect(pages).toEqual([{ start: 0, end: 3 }]);
  });

  it("長いコメントは分割", () => {
    const long = "あ".repeat(500);
    const pages = splitCommentPages([long, long, long], 600);
    expect(pages.length).toBeGreaterThan(1);
  });

  it("空配列でも1ページ返す", () => {
    const pages = splitCommentPages([]);
    expect(pages).toEqual([{ start: 0, end: 0 }]);
  });

  it("最低1コメントは1ページに入る", () => {
    const veryLong = "あ".repeat(2000);
    const pages = splitCommentPages([veryLong], 100);
    expect(pages[0].end).toBe(1); // 制限超えても1件は入る
  });
});

describe("diffColor / formatDiff", () => {
  it("正の差分は緑", () => {
    expect(diffColor(5)).toBe(COLORS.positive);
    expect(formatDiff(5)).toBe("+5");
  });

  it("負の差分は赤", () => {
    expect(diffColor(-3)).toBe(COLORS.negative);
    expect(formatDiff(-3)).toBe("-3");
  });

  it("差分0は→", () => {
    expect(diffColor(0)).toBe(COLORS.neutral);
    expect(formatDiff(0)).toBe("→");
  });

  it("nullは-", () => {
    expect(diffColor(null)).toBe("#ccc");
    expect(formatDiff(null)).toBe("-");
  });
});

describe("定数の整合性", () => {
  it("AI_COMMENT_HEADINGSが5つある", () => {
    expect(AI_COMMENT_HEADINGS.length).toBe(5);
  });

  it("ランク色の一貫性: rankColor(3)の色とrankColorModal(3)のcolorが同じ系統", () => {
    // rankColor: #2563EB, rankColorModal: #2563eb (大文字小文字の違い)
    expect(rankColor(3).toLowerCase()).toContain("2563eb");
    expect(rankColorModal(3).color).toBe("#2563eb");
  });
});
