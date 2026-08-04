import { describe, it, expect } from "vitest";
import { buildPmaxAdvice, type PmaxAdviceInput } from "./pmax-advice";

/** 全条件が発火しないベース入力 */
const base: PmaxAdviceInput = {
  impressions: 100_000,
  prevImpressions: 100_000,
  clicks: 500,
  prevClicks: 500,
  ctr: 0.005,
  prevCtr: 0.005,
  cpcYen: 8,
  prevCpcYen: 8,
  mapActionsTotal: 10,
  mapsSearchSharePct: 60,
  langCpcs: [{ language: "Japanese", cpcYen: 8 }],
  saveShare: 0,
  prevSaveShare: 0,
};

describe("buildPmaxAdvice", () => {
  it("どの条件にも合致しなければ空配列（ページ非表示）", () => {
    expect(buildPmaxAdvice(base)).toEqual([]);
  });

  it("クリック率0.8%以上で高水準の評価文が出る（業界平均0.3〜0.6%と同一基準）", () => {
    const out = buildPmaxAdvice({ ...base, ctr: 0.0184 });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("1.84%");
    expect(out[0]).toContain("0.3〜0.6%");
  });

  it("クリック単価が前月比+15%以上かつ+0.5円以上で競合参入の説明が出る", () => {
    const out = buildPmaxAdvice({ ...base, cpcYen: 4.92, prevCpcYen: 3.73 });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("¥3.7");
    expect(out[0]).toContain("¥4.9");
    expect(out[0]).toContain("1〜3社");
  });

  it("クリック単価5円以下で効率性の評価が出る（上昇時は排他で出ない）", () => {
    const low = buildPmaxAdvice({ ...base, cpcYen: 2.6, prevCpcYen: 2.8 });
    expect(low).toHaveLength(1);
    expect(low[0]).toContain("¥2.6");
    expect(low[0]).toContain("先行者利益");
    // 上昇条件に合致する場合は低単価文ではなく上昇文のみ
    const rose = buildPmaxAdvice({ ...base, cpcYen: 4.5, prevCpcYen: 3.0 });
    expect(rose).toHaveLength(1);
    expect(rose[0]).toContain("上昇");
  });

  it("前月データが無い月は単価上昇・表示減の前月比較文を出さない", () => {
    const out = buildPmaxAdvice({ ...base, prevImpressions: 0, cpcYen: 20, prevCpcYen: 0, impressions: 50_000 });
    expect(out.join("")).not.toContain("前月");
  });

  it("表示減+クリック率上昇で配信精度向上の文が出る", () => {
    const out = buildPmaxAdvice({ ...base, impressions: 90_000, ctr: 0.006, prevCtr: 0.005 });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("0.50%");
    expect(out[0]).toContain("0.60%");
  });

  it("マップ+検索85%以上で配信集中の説明が出る（チャネルデータnullでは出ない）", () => {
    const out = buildPmaxAdvice({ ...base, mapsSearchSharePct: 96.1 });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("96.1%");
    expect(buildPmaxAdvice({ ...base, mapsSearchSharePct: null })).toEqual([]);
  });

  it("2言語以上のクリック単価を日本語ラベルで列挙する（Unknownは除外）", () => {
    const out = buildPmaxAdvice({
      ...base,
      langCpcs: [
        { language: "Japanese", cpcYen: 2.6 },
        { language: "Korean", cpcYen: 10.2 },
        { language: "Unknown", cpcYen: 5 },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("日本語¥2.6");
    expect(out[0]).toContain("韓国語¥10.2");
    expect(out[0]).not.toContain("Unknown");
  });

  it("保存・共有の増加で見込み客の文が出る", () => {
    const out = buildPmaxAdvice({ ...base, saveShare: 2000, prevSaveShare: 1500 });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("1,500件");
    expect(out[0]).toContain("2,000件");
  });

  it("MAP行動0件で口コミ獲得の提案が出る（表示も0なら出ない）", () => {
    const out = buildPmaxAdvice({ ...base, mapActionsTotal: 0 });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("月5件程度の口コミ");
    expect(buildPmaxAdvice({ ...base, mapActionsTotal: 0, impressions: 0, clicks: 0, prevImpressions: 0 })).toEqual([]);
  });

  it("最大5段落に制限される", () => {
    const out = buildPmaxAdvice({
      ...base,
      ctr: 0.0184,
      prevCtr: 0.015,
      impressions: 90_000,
      cpcYen: 2.6,
      prevCpcYen: 2.8,
      mapsSearchSharePct: 96.1,
      langCpcs: [
        { language: "Japanese", cpcYen: 2.6 },
        { language: "Korean", cpcYen: 10.2 },
      ],
      saveShare: 2000,
      prevSaveShare: 1500,
      mapActionsTotal: 0,
    });
    expect(out).toHaveLength(5);
  });

  it("箇条書き記号を含まない（文章として出力）", () => {
    const out = buildPmaxAdvice({ ...base, ctr: 0.02, mapActionsTotal: 0 });
    for (const p of out) {
      expect(p).not.toMatch(/^[・\-*•]/);
      expect(p).not.toContain("\n・");
    }
  });
});
