import { describe, it, expect } from "vitest";
import { normShopName, pickGbpMatch } from "./pmax-sheet";

describe("normShopName", () => {
  it("全角/空白/大文字を正規化", () => {
    expect(normShopName("ＣＨＩＬＬ　RI 堀江")).toBe("chillri堀江");
    expect(normShopName("  Cafe  Bar  ")).toBe("cafebar");
  });
});

describe("pickGbpMatch", () => {
  it("完全一致を最優先", () => {
    const keys = ["chillri堀江", "chillri堀江店"];
    expect(pickGbpMatch("CHILLRI 堀江", keys)).toEqual({ key: "chillri堀江", ambiguous: false });
  });

  it("相互部分一致が1件だけなら採用", () => {
    const keys = ["サロンa梅田店"];
    expect(pickGbpMatch("サロンA梅田", keys)).toEqual({ key: "サロンa梅田店", ambiguous: false });
  });

  it("複数候補にマッチしたら誤マッチ防止でambiguous（別店舗の数値を書かない）", () => {
    // 「〇〇大阪」が「〇〇大阪店」と「〇〇新大阪店」の両方に相互includesでマッチ
    const keys = ["〇〇大阪店", "〇〇新大阪店"];
    const r = pickGbpMatch("〇〇大阪店", keys);
    // 「〇〇大阪店」自体は完全一致するので採用される（これは正しい）
    expect(r).toEqual({ key: "〇〇大阪店", ambiguous: false });
  });

  it("包含関係で複数候補・完全一致なし → ambiguousでスキップ", () => {
    // key="abc" が "abcd" と "xabc" の両方に部分一致、完全一致も {key}店 も無い
    const keys = ["abcd", "xabc"];
    expect(pickGbpMatch("abc", keys)).toEqual({ key: null, ambiguous: true });
  });

  it("複数候補でも「{key}店」への完全一致が1件だけなら安全に採用", () => {
    // key="chillri堀江" が "chillri堀江店" と "chillri堀江西店" にマッチ → {key}店 の一致で解決
    const keys = ["chillri堀江店", "chillri堀江西店"];
    expect(pickGbpMatch("CHILLRI 堀江", keys)).toEqual({ key: "chillri堀江店", ambiguous: false });
  });

  it("候補ゼロは null(非ambiguous)＝未マッチ", () => {
    expect(pickGbpMatch("存在しない店", ["別の店"])).toEqual({ key: null, ambiguous: false });
  });

  it("空文字のAds名は安全にnull", () => {
    expect(pickGbpMatch("", ["何か"])).toEqual({ key: null, ambiguous: false });
  });

  it("空のキー候補にマッチさせない（.includes(\"\")の罠を防ぐ）", () => {
    // 候補側に空キーがあっても、それには決してマッチしない
    expect(pickGbpMatch("abc", ["", "zzz"])).toEqual({ key: null, ambiguous: false });
  });
});
