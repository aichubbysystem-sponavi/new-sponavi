import { describe, it, expect } from "vitest";
import { matchShopNames, type MatchShop } from "./shop-name-match";

// 実データ: sql/2026-08-01_rpa_sheet_shop_check.sql の店舗名から抜粋
// （紛らわしい類似店舗をわざと多く含めている）
const REAL_NAMES = [
  "不用品回収のキラキらっこ 栃木店",
  "不用品買取のキラキらっこ 宮崎店",
  "不用品回収のキラキらっきー 岐阜",
  "不用品買取のキラキらいと滋賀",
  "不用品回収サニークリーン宮城",
  "不用品回収のオリーブクリーン",
  "キラキらふてる石川",
  "不用品回収のキラキらっこ 群馬店",
  "不用品買取のリーフクリーン熊本店",
  "不用品買取のキラキらっこ 鹿児島店",
  "_WHITE 栄店【アンダーバーホワイト】",
  "_WHITE 鳳店",
  "_WHITE 泉佐野店 アンダーバーホワイト",
  "アイブロウサロン WHITE EYE いわき 眉毛専門店 ホワイトアイ",
  "WHITE EYE 栄店 アイブロウ まつ毛パーマ専門店【ホワイトアイ】",
  "アイブロウサロン WHITE EYE まつ毛と眉毛専門店 堺北花田店 ホワイトアイ",
  "アイブロウサロン WHITE EYE 上本町 眉毛専門店",
  "アイブロウサロン WHITE EYE 新潟駅前 眉毛専門店",
  "ジェルネイル専門 WHITE NAIL 高崎店",
  "アイブロウサロン WHITE EYE 佐賀 まつ毛と眉毛の専門店 ホワイトアイ",
  // 以下は「貼り付けリストに無い」紛らわしい店舗（誤チェック検出用）
  "アイブロウサロン WHITE EYE 心斎橋 眉毛専門店【ホワイトアイ】",
  "アイブロウサロン WHITE EYE 倉敷 眉毛専門店 ホワイトアイ",
  "アイブロウサロン WHITE EYE 小倉 眉毛専門店 ホワイトアイ",
  "アイブロウサロン WHITE EYE 前橋 眉毛専門店 ホワイトアイ",
  "眉毛とまつ毛の専門店 WHITE EYE 福岡博多店 ホワイトアイ",
  "WHITE NAIL 難波店 ホワイトネイル",
  "WHITE NAIL 名駅店 ホワイトネイル",
  "WHITE NAIL 栄店 ホワイトネイル",
  "セルフホワイトニング専門店WHITE金沢店",
  "歯のホワイトニング専門店 WHITE 岐阜店",
  "歯のホワイトニング専門店WHITE 奈良桜井店",
  "Whitening salon WHITE 津山店",
  "Whitening salon WHITE 前橋店",
];

const SHOPS: MatchShop[] = REAL_NAMES.map((name, i) => ({ id: `shop-${i}`, name }));

// LINEで実際に送られてきた20店舗
const PASTED = `不用品回収のキラキらっこ 栃木店
不用品買取のキラキらっこ 宮崎店
不用品回収のキラキらっきー 岐阜
不用品買取のキラキらいと滋賀
不用品回収サニークリーン宮城
不用品回収のオリーブクリーン
キラキらふてる石川
不用品回収のキラキらっこ 群馬店
不用品買取のリーフクリーン熊本店
不用品買取のキラキらっこ 鹿児島店
_WHITE 栄店【アンダーバーホワイト】
_WHITE 鳳店
_WHITE 泉佐野店 アンダーバーホワイト
アイブロウサロン WHITE EYE いわき 眉毛専門店 ホワイトアイ
WHITE EYE 栄店 アイブロウ まつ毛パーマ専門店【ホワイトアイ】
アイブロウサロン WHITE EYE まつ毛と眉毛専門店 堺北花田店 ホワイトアイ
アイブロウサロン WHITE EYE 上本町 眉毛専門店
アイブロウサロン WHITE EYE 新潟駅前 眉毛専門店
ジェルネイル専門 WHITE NAIL 高崎店
アイブロウサロン WHITE EYE 佐賀 まつ毛と眉毛の専門店 ホワイトアイ`;

describe("matchShopNames", () => {
  it("LINEの20店舗リストが過不足なく一致する", () => {
    const r = matchShopNames(PASTED, SHOPS);
    expect(r.matched.length).toBe(20);
    expect(r.unmatched).toEqual([]);
    expect(r.ambiguous).toEqual([]);
    // 貼り付けリストに無い紛らわしい店舗を巻き込んでいないこと
    const names = r.matched.map(m => m.shop.name).sort();
    expect(names).toEqual(PASTED.split("\n").sort());
  });

  it("空行・行頭の箇条書き記号・番号・全角空白を無視する", () => {
    const r = matchShopNames(
      "\n・_WHITE 鳳店\n\n1. キラキらふてる石川\n  　_WHITE 泉佐野店　アンダーバーホワイト  \n",
      SHOPS,
    );
    expect(r.matched.map(m => m.shop.name)).toEqual([
      "_WHITE 鳳店",
      "キラキらふてる石川",
      "_WHITE 泉佐野店 アンダーバーホワイト",
    ]);
    expect(r.unmatched).toEqual([]);
  });

  it("全角英数・半角カナの表記ゆれを吸収する", () => {
    const r = matchShopNames("ジェルネイル専門 ＷＨＩＴＥ ＮＡＩＬ 高崎店\n_WHITE 鳳店", SHOPS);
    expect(r.matched.length).toBe(2);
  });

  it("括弧の有無だけの違いは一致扱いにする", () => {
    const r = matchShopNames("_WHITE 栄店 アンダーバーホワイト", SHOPS);
    expect(r.matched.map(m => m.shop.name)).toEqual(["_WHITE 栄店【アンダーバーホワイト】"]);
  });

  it("存在しない店舗は未検出として返し、勝手にチェックしない", () => {
    const r = matchShopNames("不用品回収のキラキらっこ 沖縄店\n存在しない店舗ABC", SHOPS);
    expect(r.matched).toEqual([]);
    expect(r.unmatched.map(u => u.input)).toEqual(["不用品回収のキラキらっこ 沖縄店", "存在しない店舗ABC"]);
    // 惜しい行には候補を提示する
    expect(r.unmatched[0].suggestions.length).toBeGreaterThan(0);
    expect(r.unmatched[1].suggestions).toEqual([]);
  });

  it("部分一致では自動チェックしない（別店舗の巻き込み防止）", () => {
    const r = matchShopNames("WHITE EYE", SHOPS);
    expect(r.matched).toEqual([]);
    expect(r.unmatched.length).toBe(1);
  });

  it("同名店舗が複数ある場合は要確認に回す", () => {
    const dup: MatchShop[] = [
      { id: "a", name: "テスト店舗 本店" },
      { id: "b", name: "テスト店舗　本店" }, // 全角空白違い＝正規化後は同一
    ];
    const r = matchShopNames("テスト店舗 本店", dup);
    expect(r.matched).toEqual([]);
    expect(r.ambiguous.length).toBe(1);
    expect(r.ambiguous[0].candidates.map(c => c.id)).toEqual(["a", "b"]);
  });

  it("重複行は1件として扱う", () => {
    const r = matchShopNames("_WHITE 鳳店\n_WHITE 鳳店\n_WHITE　鳳店", SHOPS);
    expect(r.matched.length).toBe(1);
    expect(r.duplicated.length).toBe(2);
  });
});
