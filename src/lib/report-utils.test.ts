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
  centerCell,
  gridLayoutLabel,
  diffColor,
  formatDiff,
  COLORS,
  CHART_COLORS,
  AI_COMMENT_HEADINGS,
  KPI,
  rankTrend,
  rankCoverage,
  parseStartMonth,
  isYoyComparable,
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

  it("前月0, 今月>0は%でなく実数表示（+∞は顧客向けに不適切）", () => {
    const r = pctChange(100, 0);
    expect(r.text).toBe("+100");
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

describe("centerCell", () => {
  const grid = (size: number) => {
    const pts: { row: number; col: number; rank: number }[] = [];
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) pts.push({ row: r, col: c, rank: r * size + c + 1 });
    return pts;
  };

  it("奇数グリッド(7×7)は中心(3,3)を返す", () => {
    const cell = centerCell(grid(7), 7);
    expect(cell).toEqual({ row: 3, col: 3, rank: 3 * 7 + 3 + 1 });
  });

  it("奇数グリッド(3×3)は中心(1,1)を返す", () => {
    expect(centerCell(grid(3), 3)).toEqual({ row: 1, col: 1, rank: 5 });
  });

  it("偶数グリッド(2×2=斜め4地点)は中心なし=undefined（(1,1)を誤って返さない）", () => {
    expect(centerCell(grid(2), 2)).toBeUndefined();
  });

  it("空配列・null・undefinedはundefined", () => {
    expect(centerCell([], 7)).toBeUndefined();
    expect(centerCell(null, 7)).toBeUndefined();
    expect(centerCell(undefined, 7)).toBeUndefined();
  });

  it("中心セルが結果に含まれない場合はundefined", () => {
    const pts = grid(3).filter(p => !(p.row === 1 && p.col === 1));
    expect(centerCell(pts, 3)).toBeUndefined();
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

describe("gridLayoutLabel", () => {
  it("gridSize=2は旧4地点計測", () => {
    expect(gridLayoutLabel(2, 4)).toBe("4地点");
  });

  it("gridSize=3かつ5点は5地点計測（中心＋外周4点）", () => {
    expect(gridLayoutLabel(3, 5)).toBe("5地点");
  });

  it("gridSize=3で9点（旧フル3×3）は3×3表記", () => {
    expect(gridLayoutLabel(3, 9)).toBe("3×3");
  });

  it("7×7はそのままN×N表記", () => {
    expect(gridLayoutLabel(7, 49)).toBe("7×7");
  });
});

describe("rankTrend（順位変動）", () => {
  it("通常の上昇: 前月5位→当月2位は↑3", () => {
    const r = rankTrend([8, 5, 2]);
    expect(r.text).toBe("↑3");
    expect(r.kind).toBe("up");
  });

  it("通常の下降: 前月2位→当月5位は↓3", () => {
    const r = rankTrend([8, 2, 5]);
    expect(r.text).toBe("↓3");
    expect(r.kind).toBe("down");
  });

  it("同順位は→", () => {
    expect(rankTrend([3, 3]).text).toBe("→");
  });

  it("【回帰】当月データなしのとき過去2点の差分を変動にしない（旧バグ: ↑6と表示）", () => {
    // 一社イタリアン 2026: 1月3位/2月7位/3月-/4月1位/6月データなし
    const r = rankTrend([3, 7, null, 1, null]);
    expect(r.text).not.toBe("↑6");
    expect(r.kind).not.toBe("up");
  });

  it("計測済みで順位が付かなければ「圏外へ」（赤）", () => {
    const r = rankTrend([3, 7, null, 1, null], [true, true, false, true, true]);
    expect(r.text).toBe("圏外へ");
    expect(r.kind).toBe("out");
    expect(r.color).toBe("#c0392b");
  });

  it("未計測なら圏外と断定せず「未計測」（灰）", () => {
    const r = rankTrend([3, 7, null, 1, null], [true, true, false, true, false]);
    expect(r.text).toBe("未計測");
    expect(r.color).toBe("#888");
  });

  it("measured未指定なら圏外と断定しない", () => {
    expect(rankTrend([1, null]).text).toBe("未計測");
  });

  it("【回帰】当月のみ実測・過去なしは「初計測」で→ではない（旧バグ: 横ばい扱い）", () => {
    const r = rankTrend([null, null, null, null, 2]);
    expect(r.text).toBe("初計測");
    expect(r.kind).toBe("first");
  });

  it("比較相手は直近の順位ありの月（間の欠測を飛ばす）", () => {
    const r = rankTrend([10, null, null, 4]);
    expect(r.text).toBe("↑6");
    expect(r.prevIndex).toBe(0);
  });

  it("小数1桁指定で多地点平均に対応", () => {
    const r = rankTrend([8.4, 13.1], undefined, 1);
    expect(r.text).toBe("↓4.7");
  });

  it("【回帰】多地点でも当月データなしなら↑6.2にならない", () => {
    // 一社イタリアン多地点: 1月10.3 / 2月14.5 / 4月8.3 / 6月データなし
    const r = rankTrend([10.3, 14.5, 8.3, null], undefined, 1);
    expect(r.text).not.toBe("↑6.2");
  });

  it("avgRank=0（全地点圏外）は順位ありとして扱わない", () => {
    const r = rankTrend([8.3, 0], [true, true], 1);
    expect(r.text).toBe("圏外へ");
  });

  it("空配列・全null", () => {
    expect(rankTrend([]).text).toBe("-");
    expect(rankTrend([null, null]).text).toBe("-");
  });
});

describe("rankCoverage（圏内率）", () => {
  it("49地点中16地点が圏内なら33%", () => {
    const results = Array.from({ length: 49 }, (_, i) => ({ rank: i < 16 ? i + 1 : 0 }));
    const c = rankCoverage(results)!;
    expect(c.ranked).toBe(16);
    expect(c.total).toBe(49);
    expect(c.pct).toBe(33);
  });

  it("全地点圏内は100%", () => {
    const c = rankCoverage([{ rank: 1 }, { rank: 2 }])!;
    expect(c.pct).toBe(100);
  });

  it("全地点圏外は0%", () => {
    const c = rankCoverage([{ rank: 0 }, { rank: 0 }])!;
    expect(c.ranked).toBe(0);
    expect(c.pct).toBe(0);
  });

  it("空・nullはnull", () => {
    expect(rankCoverage([])).toBeNull();
    expect(rankCoverage(null)).toBeNull();
  });
});

describe("parseStartMonth", () => {
  it("和暦風の「2025年8月」", () => {
    expect(parseStartMonth("2025年8月")).toBe("2025/8");
  });
  it("スラッシュ・ハイフン・日付付き", () => {
    expect(parseStartMonth("2025/8")).toBe("2025/8");
    expect(parseStartMonth("2025-08-01")).toBe("2025/8");
  });
  it("解釈できない値はnull", () => {
    expect(parseStartMonth("")).toBeNull();
    expect(parseStartMonth(null)).toBeNull();
    expect(parseStartMonth("未設定")).toBeNull();
    expect(parseStartMonth("2025年13月")).toBeNull();
  });
});

describe("isYoyComparable（前年比を出してよいか）", () => {
  it("【回帰】対策開始前の前年同月とは比較しない（旧バグ: +116325%）", () => {
    // patty rôti: 対策開始2025年8月、当月2026/6 → 前年同月2025/6は開始前
    expect(isYoyComparable(4, "2026/6", "2025年8月")).toBe(false);
  });

  it("【回帰】前年同月が0なら比較しない（旧バグ: +108,951と実数表示）", () => {
    expect(isYoyComparable(0, "2026/6", "2024年1月")).toBe(false);
    expect(isYoyComparable(null, "2026/6", "2024年1月")).toBe(false);
  });

  it("対策開始月と同月なら比較可", () => {
    expect(isYoyComparable(100, "2026/8", "2025年8月")).toBe(true);
  });

  it("対策開始より後の前年同月は比較可", () => {
    expect(isYoyComparable(100, "2026/6", "2024年3月")).toBe(true);
  });

  it("開始日が不明でも値があれば比較可", () => {
    expect(isYoyComparable(100, "2026/6", undefined)).toBe(true);
  });

  it("当月ラベルが不正なら比較しない", () => {
    expect(isYoyComparable(100, "", "2024/1")).toBe(false);
  });
});
