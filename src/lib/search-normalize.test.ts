import { describe, it, expect } from "vitest";
import { normalizeSearchText, searchMatch } from "./search-normalize";

describe("searchMatch", () => {
  it("異体字を吸収する（靱で検索して靭にヒット）", () => {
    expect(searchMatch("SIK eatery 靭公園", "靱")).toBe(true);
    expect(searchMatch("SIK eatery 靭公園", "靱公園")).toBe(true);
    expect(searchMatch("SIK eatery 靭公園", "靫公園")).toBe(true);
  });

  it("よくある異体字ペアを両方向で吸収する", () => {
    expect(searchMatch("髙橋精肉店", "高橋")).toBe(true);
    expect(searchMatch("山﨑酒場", "山崎")).toBe(true);
    expect(searchMatch("齋藤医院", "斉藤")).toBe(true);
    expect(searchMatch("渡邊商店", "渡辺")).toBe(true);
  });

  it("全角半角・大文字小文字・空白の揺れを吸収する", () => {
    expect(searchMatch("SIK eatery 靭公園", "sik")).toBe(true);
    expect(searchMatch("SIK eatery 靭公園", "ＳＩＫ")).toBe(true);
    expect(searchMatch("GRASS DOG&CAT てんしば", "grassdog")).toBe(true);
  });

  it("空の検索語は常にヒット", () => {
    expect(searchMatch("何でも", "")).toBe(true);
  });

  it("関係ない語はヒットしない", () => {
    expect(searchMatch("SIK eatery 靭公園", "蟹座")).toBe(false);
  });

  it("normalizeSearchTextは冪等", () => {
    const once = normalizeSearchText("ＳＩＫ 靱公園");
    expect(normalizeSearchText(once)).toBe(once);
  });
});
