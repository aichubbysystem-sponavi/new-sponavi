import { describe, it, expect } from "vitest";
import { monthRangeIso, prevMonthLabel } from "./month-utils";

describe("monthRangeIso", () => {
  it("JSTの月初〜翌月初をUTCのISOで返す", () => {
    // JST 2026-07-01 00:00 = UTC 2026-06-30 15:00
    expect(monthRangeIso("2026/7")).toEqual({
      startIso: "2026-06-30T15:00:00.000Z",
      endIso: "2026-07-31T15:00:00.000Z",
    });
  });

  it("年をまたぐ12月も翌年1月で閉じる", () => {
    expect(monthRangeIso("2026/12")).toEqual({
      startIso: "2026-11-30T15:00:00.000Z",
      endIso: "2026-12-31T15:00:00.000Z",
    });
  });

  it("ゼロ埋め・ハイフン区切りも受け付ける", () => {
    expect(monthRangeIso("2026/07")).toEqual(monthRangeIso("2026/7"));
    expect(monthRangeIso("2026-07")).toEqual(monthRangeIso("2026/7"));
  });

  it("解釈できない月は null", () => {
    expect(monthRangeIso("")).toBeNull();
    expect(monthRangeIso("あ")).toBeNull();
    expect(monthRangeIso("2026/13")).toBeNull();
  });
});

describe("prevMonthLabel", () => {
  it("前月を返す", () => {
    expect(prevMonthLabel("2026/7")).toBe("2026/6");
  });

  // 文字列比較で月を扱うと1月→12月で必ず壊れるため、年またぎを明示的に固定する
  it("1月の前月は前年12月", () => {
    expect(prevMonthLabel("2026/1")).toBe("2025/12");
  });

  it("解釈できない月は空文字", () => {
    expect(prevMonthLabel("")).toBe("");
  });
});
