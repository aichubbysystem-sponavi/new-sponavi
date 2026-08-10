import { describe, it, expect } from "vitest";
import {
  monthToNum,
  compareMonths,
  normalizeMonthLabel,
  isCompetitorFetchAllowed,
  COMPETITOR_FETCH_MONTHS_BACK,
  reportMonthFromMeasuredAt,
} from "./month-utils";

/**
 * このテストが守っているもの:
 * 月ラベルを文字列比較すると "2026/10" < "2026/9" になり、10〜12月で
 * 「最新月が9月に固定される」「順位が月とずれる」バグが必ず出る。
 * 過去に search-query-fetch / spreadsheet / client.tsx の3箇所で発生した。
 */
describe("月比較（10月以降の破綻を防ぐ）", () => {
  it("文字列比較なら壊れる並びを、正しく昇順にできる", () => {
    const months = ["2025/9", "2025/10", "2025/11", "2025/12"];

    // 文字列比較（＝過去のバグ）では9月が最後に来てしまう
    const byString = [...months].sort((a, b) => a.localeCompare(b));
    expect(byString[byString.length - 1]).toBe("2025/9");

    // compareMonths なら12月が最後
    const byNum = [...months].sort(compareMonths);
    expect(byNum).toEqual(["2025/9", "2025/10", "2025/11", "2025/12"]);
    expect(byNum[byNum.length - 1]).toBe("2025/12");
  });

  it("10月は9月より新しい", () => {
    expect(compareMonths("2026/10", "2026/9")).toBeGreaterThan(0);
    expect(compareMonths("2026/9", "2026/10")).toBeLessThan(0);
  });

  it("年をまたぐ比較", () => {
    expect(compareMonths("2027/1", "2026/12")).toBeGreaterThan(0);
    expect(compareMonths("2026/12", "2027/1")).toBeLessThan(0);
  });

  it("同じ月は0", () => {
    expect(compareMonths("2026/7", "2026/7")).toBe(0);
    expect(compareMonths("2026/7", "2026/07")).toBe(0);
  });

  it("対象月以下のフィルタが10月以降でも連続したprefixになる", () => {
    // client.tsx の月フィルタが依存している性質。
    // 文字列比較だと非連続になり ranks と月の対応がずれる
    const labels = ["2026/7", "2026/8", "2026/9", "2026/10", "2026/11"];
    const target = monthToNum("2026/9");
    const kept = labels.filter((l) => monthToNum(l) <= target);
    expect(kept).toEqual(["2026/7", "2026/8", "2026/9"]);
    // prefix であること（slice(0, n) が使える前提）
    expect(labels.slice(0, kept.length)).toEqual(kept);
  });
});

describe("monthToNum の表記ゆれ吸収", () => {
  it.each([
    ["2026/7", 202607],
    ["2026/07", 202607],
    ["2026-07", 202607],
    ["2026年7月", 202607],
    ["2026.7", 202607],
    ["202607", 202607],
    ["2026/12", 202612],
  ])("%s → %i", (input, expected) => {
    expect(monthToNum(input)).toBe(expected);
  });

  it.each(["", "  ", "不明", "abc"])("解釈できない %s は0", (v) => {
    expect(monthToNum(v)).toBe(0);
  });

  it("null/undefinedでも落ちない", () => {
    expect(monthToNum(null as unknown as string)).toBe(0);
    expect(monthToNum(undefined as unknown as string)).toBe(0);
  });
});

describe("normalizeMonthLabel", () => {
  it.each([
    ["2026/07", "2026/7"],
    ["2026-04", "2026/4"],
    ["2026年10月", "2026/10"],
    ["2026/7", "2026/7"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeMonthLabel(input)).toBe(expected);
  });

  it("解釈できない値は空文字", () => {
    expect(normalizeMonthLabel("")).toBe("");
    expect(normalizeMonthLabel(null)).toBe("");
  });
});

describe("競合比較の取得可否（月が変わってもページが消えないこと）", () => {
  /** JST基準の日時を作る（内部でUTC getterを使うため、その前提で組み立てる） */
  const jst = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 12, 0, 0));

  it("8月に6月レポートを開いても取得できる", () => {
    // 2026-08-01 発見: パフォーマンスの提供遅れで8月初旬の「最新の確定月」は6月。
    // 以前は当月・前月のみ取得だったため、6月レポートから競合比較が消えていた
    expect(isCompetitorFetchAllowed("2026/6", jst(2026, 8, 1))).toBe(true);
  });

  it("当月・前月も従来どおり取得できる", () => {
    expect(isCompetitorFetchAllowed("2026/8", jst(2026, 8, 1))).toBe(true);
    expect(isCompetitorFetchAllowed("2026/7", jst(2026, 8, 1))).toBe(true);
  });

  it("4か月以上前は取得しない（古いレポートを開くたびに課金しない）", () => {
    expect(isCompetitorFetchAllowed("2026/5", jst(2026, 8, 15))).toBe(true);
    expect(isCompetitorFetchAllowed("2026/4", jst(2026, 8, 15))).toBe(false);
    expect(isCompetitorFetchAllowed("2025/8", jst(2026, 8, 15))).toBe(false);
  });

  it("未来月は取得しない", () => {
    expect(isCompetitorFetchAllowed("2026/9", jst(2026, 8, 1))).toBe(false);
  });

  it("年をまたいでも正しく数える", () => {
    expect(isCompetitorFetchAllowed("2025/12", jst(2026, 1, 10))).toBe(true);
    expect(isCompetitorFetchAllowed("2025/10", jst(2026, 1, 10))).toBe(true);
    expect(isCompetitorFetchAllowed("2025/9", jst(2026, 1, 10))).toBe(false);
  });

  it("不正な月表記は取得しない", () => {
    expect(isCompetitorFetchAllowed("", jst(2026, 8, 1))).toBe(false);
    expect(isCompetitorFetchAllowed("不明", jst(2026, 8, 1))).toBe(false);
  });

  it("遡り月数の定数が意図した値", () => {
    expect(COMPETITOR_FETCH_MONTHS_BACK).toBe(3);
  });
});

/**
 * このテストが守っているもの:
 * 順位は毎月1日に「前月末時点」を計測する運用のため、7/1計測は6月分レポートの値。
 * measured_at の月をそのまま使うと7月分に載る（2026-08-10修正の旧バグ）。
 * 境界はJST。UTCで判定すると 7/1 08:59 JST（6/30 23:59 UTC）が6月扱いになる等ずれる。
 */
describe("reportMonthFromMeasuredAt（帰属月: 1〜3日は前月）", () => {
  it("月初1〜3日(JST)の計測は前月に帰属する", () => {
    expect(reportMonthFromMeasuredAt("2026-07-01T09:00:00+09:00")).toBe("2026/6");
    expect(reportMonthFromMeasuredAt("2026-07-03T23:59:59+09:00")).toBe("2026/6");
    expect(reportMonthFromMeasuredAt("2026-08-01T07:28:52+09:00")).toBe("2026/7");
  });

  it("4日以降(JST)の計測は当月のまま（月中の臨時計測を前月に入れない）", () => {
    expect(reportMonthFromMeasuredAt("2026-07-04T00:00:00+09:00")).toBe("2026/7");
    expect(reportMonthFromMeasuredAt("2026-06-06T10:00:00+09:00")).toBe("2026/6");
    expect(reportMonthFromMeasuredAt("2026-07-15T12:00:00+09:00")).toBe("2026/7");
  });

  it("1月1〜3日は前年12月に帰属する（年またぎ）", () => {
    expect(reportMonthFromMeasuredAt("2027-01-01T09:00:00+09:00")).toBe("2026/12");
    expect(reportMonthFromMeasuredAt("2027-01-04T09:00:00+09:00")).toBe("2027/1");
  });

  it("判定はJST基準（UTC入力でも正しい日に丸める）", () => {
    // 6/30 16:00 UTC = 7/1 01:00 JST → 1日計測なので6月分
    expect(reportMonthFromMeasuredAt("2026-06-30T16:00:00Z")).toBe("2026/6");
    // 7/3 15:30 UTC = 7/4 00:30 JST → 4日なので7月分
    expect(reportMonthFromMeasuredAt("2026-07-03T15:30:00Z")).toBe("2026/7");
  });

  it("SQL backfillと同一ルール（月フォーマットはゼロパディングなし）", () => {
    expect(reportMonthFromMeasuredAt("2026-05-01T09:00:00+09:00")).toBe("2026/4");
    expect(reportMonthFromMeasuredAt("2026-10-05T09:00:00+09:00")).toBe("2026/10");
  });
});
