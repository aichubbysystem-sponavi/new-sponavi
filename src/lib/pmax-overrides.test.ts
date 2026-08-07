import { describe, it, expect } from "vitest";
import { applyAdsOverrides, applyGbpOverrides, parseReportSettings } from "./pmax-overrides";

const adsRow = () => ({
  impressions: 10000,
  clicks: 200,
  ctr: 0.02,
  averageCpc: 5_000_000, // ¥5
  costMicros: 1_000_000_000, // ¥1,000
});

describe("applyAdsOverrides", () => {
  it("上書きなしなら行は変わらない", () => {
    const row = adsRow();
    applyAdsOverrides(row, "m|Japanese|2026-07", {});
    expect(row).toEqual(adsRow());
  });

  it("表示回数を上書きするとCTRが再計算される", () => {
    const row = adsRow();
    applyAdsOverrides(row, "m|Japanese|2026-07", { "m|Japanese|2026-07|impressions": 20000 });
    expect(row.impressions).toBe(20000);
    expect(row.ctr).toBeCloseTo(200 / 20000);
    // クリック数・広告費は不変
    expect(row.clicks).toBe(200);
    expect(row.costMicros).toBe(1_000_000_000);
  });

  it("クリック数を上書きするとCTRとCPCが再計算される", () => {
    const row = adsRow();
    applyAdsOverrides(row, "d|Korean|2026-07-15", { "d|Korean|2026-07-15|clicks": 400 });
    expect(row.clicks).toBe(400);
    expect(row.ctr).toBeCloseTo(400 / 10000);
    expect(row.averageCpc).toBeCloseTo(1_000_000_000 / 400);
  });

  it("広告費は円で保存されmicrosに変換される", () => {
    const row = adsRow();
    applyAdsOverrides(row, "m|Japanese|2026-07", { "m|Japanese|2026-07|costYen": 2500 });
    expect(row.costMicros).toBe(2_500_000_000);
    expect(row.averageCpc).toBeCloseTo(2_500_000_000 / 200);
  });

  it("ctrPct/cpcYenの明示上書きは再計算より優先される", () => {
    const row = adsRow();
    applyAdsOverrides(row, "m|Japanese|2026-07", {
      "m|Japanese|2026-07|impressions": 20000,
      "m|Japanese|2026-07|ctrPct": 3.5,
      "m|Japanese|2026-07|cpcYen": 4.1,
    });
    expect(row.ctr).toBeCloseTo(0.035);
    expect(row.averageCpc).toBeCloseTo(4_100_000);
  });

  it("クリック0に上書きするとCPCは0（ゼロ除算しない）", () => {
    const row = adsRow();
    applyAdsOverrides(row, "m|Japanese|2026-07", { "m|Japanese|2026-07|clicks": 0 });
    expect(row.averageCpc).toBe(0);
    expect(row.ctr).toBe(0);
  });

  it("別プレフィックスのキーは適用されない", () => {
    const row = adsRow();
    applyAdsOverrides(row, "m|Japanese|2026-07", { "m|Japanese|2026-06|impressions": 1 });
    expect(row.impressions).toBe(10000);
  });
});

describe("applyGbpOverrides", () => {
  it("該当月のフィールドだけ上書きされる", () => {
    const row = { month: "2026/07", totalVisits: 10, phone: 5, directions: 3, website: 2, menuClicks: 1, saveShare: 4, reservation: 0 };
    applyGbpOverrides(row, { "g|2026/07|phone": 50, "g|2026/06|totalVisits": 999 });
    expect(row.phone).toBe(50);
    expect(row.totalVisits).toBe(10);
  });
});

describe("parseReportSettings", () => {
  it("nullやundefinedでも空設定を返す", () => {
    expect(parseReportSettings(null)).toEqual({ overrides: {}, sectionVisibility: {} });
    expect(parseReportSettings({})).toEqual({ overrides: {}, sectionVisibility: {} });
  });

  it("数値以外のoverrides・真偽以外のvisibilityは捨てる", () => {
    const r = parseReportSettings({
      overrides: { a: 1, b: "2", c: "abc", d: null },
      section_visibility: { x: false, y: "no", z: true },
    });
    expect(r.overrides).toEqual({ a: 1, b: 2 });
    expect(r.sectionVisibility).toEqual({ x: false, z: true });
  });
});
