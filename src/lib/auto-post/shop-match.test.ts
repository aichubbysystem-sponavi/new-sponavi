import { describe, it, expect } from "vitest";
import { normName, matchShopName, looseKey, buildShopResolver } from "./shop-match";

describe("looseKey（末尾英語名の吸収）", () => {
  it("空白＋英語名の末尾を落とす", () => {
    expect(looseKey("カネマス弥平とうふ店 KANEMASU YAHEI TOFU")).toBe(normName("カネマス弥平とうふ店"));
    expect(looseKey("鮨 赫 sushi AKA Tokyo")).toBe(normName("鮨 赫"));
  });
  it("空白なしで続く英字・全部英字・末尾が日本語は対象外", () => {
    expect(looseKey("個室シーシャLuxia")).toBe("");
    expect(looseKey("KYOTO SAMURAI WALK")).toBe("");
    expect(looseKey("アイブロウ専門店iBROW.浜松駅前店")).toBe("");
    expect(looseKey("カネマス弥平とうふ店")).toBe("");
  });
  it("英語部分が2文字以下なら落とさない", () => {
    expect(looseKey("居酒屋 B")).toBe("");
  });
});

describe("buildShopResolver", () => {
  const shops = [
    { id: "1", name: "カネマス弥平とうふ店 KANEMASU YAHEI TOFU", gbp_shop_name: null },
    { id: "2", name: "焼肉 太郎 TOKYO", gbp_shop_name: null },
    { id: "3", name: "焼肉 太郎 OSAKA", gbp_shop_name: null },
    { id: "4", name: "アイブロウ専門店iBROW.浜松駅前店", gbp_shop_name: "iBROW. 浜松駅前店" },
    { id: "5", name: "個室シーシャLuxia", gbp_shop_name: null },
  ];
  const resolve = buildShopResolver(shops);

  it("完全一致（空白・全角半角の揺れは吸収）が最優先", () => {
    expect(resolve("アイブロウ専門店iBROW.浜松駅前店")?.id).toBe("4");
    expect(resolve("ｉBROW. 浜松駅前店")?.id).toBe("4"); // GBP店名・全角
    expect(matchShopName("焼肉　太郎 TOKYO", "焼肉 太郎 tokyo")).toBe(true);
  });
  it("シート側に英語名が無くても、候補が1店舗なら一致", () => {
    expect(resolve("カネマス弥平とうふ店")?.id).toBe("1");
  });
  it("シート側に英語名があり、マスタ側に無い場合も一致", () => {
    const r = buildShopResolver([{ id: "9", name: "麺屋 優光", gbp_shop_name: null }]);
    expect(r("麺屋 優光 MENYA YUKO")?.id).toBe("9");
  });
  it("吸収後の名前に候補が2店舗以上あれば不一致（取り違え防止）", () => {
    expect(resolve("焼肉 太郎")).toBeNull();
  });
  it("空白なしの英字は吸収しない", () => {
    expect(resolve("個室シーシャ")).toBeNull();
  });
  it("完全一致の別店舗が実在すれば、吸収照合はそちらと衝突して止まる", () => {
    const r = buildShopResolver([
      { id: "1", name: "カネマス弥平とうふ店 KANEMASU YAHEI TOFU", gbp_shop_name: null },
      { id: "2", name: "カネマス弥平とうふ店", gbp_shop_name: null },
    ]);
    expect(r("カネマス弥平とうふ店")?.id).toBe("2"); // 完全一致が勝つ
    expect(r("カネマス弥平とうふ店 KANEMASU YAHEI TOFU")?.id).toBe("1");
  });
  it("無関係な名前は不一致", () => {
    expect(resolve("存在しない店")).toBeNull();
  });
});
