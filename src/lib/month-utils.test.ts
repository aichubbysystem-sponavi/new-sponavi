import { describe, it, expect } from "vitest";
import { monthToNum, compareMonths, normalizeMonthLabel } from "./month-utils";

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
