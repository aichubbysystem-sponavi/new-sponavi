import { describe, it, expect } from "vitest";
import {
  parseContractStatus,
  normalizeShopName,
  diffContractStatus,
  currentStatus,
  statusToColumns,
  parseMasterCsv,
} from "./shop-status";

describe("parseContractStatus", () => {
  it.each([
    ["契約中", "active"],
    ["解約", "cancelled"],
    ["停止中", "paused"],
    ["　契約中　", "active"],
    ["停止", "paused"],
  ])("%s → %s", (input, expected) => {
    expect(parseContractStatus(input)).toBe(expected);
  });

  it("未知の値は null（勝手に解約扱いにしない）", () => {
    expect(parseContractStatus("検討中")).toBeNull();
    expect(parseContractStatus("")).toBeNull();
    expect(parseContractStatus(null)).toBeNull();
  });
});

describe("normalizeShopName", () => {
  it("実データにある全角/半角スペースのゆれを吸収する", () => {
    // MEOマスタには両方の表記が実在する
    expect(normalizeShopName("エミナルクリニック 札幌院")).toBe(
      normalizeShopName("エミナルクリニック　札幌院"),
    );
  });

  it("英字の大文字小文字と全角英数を吸収する", () => {
    expect(normalizeShopName("ＷＨＩＴＥ 栄店")).toBe(normalizeShopName("white栄店"));
  });

  it("別店舗を同一視しない", () => {
    expect(normalizeShopName("エミナルクリニック 札幌院")).not.toBe(
      normalizeShopName("エミナルクリニック 旭川院"),
    );
    expect(normalizeShopName("渋谷店")).not.toBe(normalizeShopName("渋谷本店"));
  });
});

describe("diffContractStatus", () => {
  const shops = [
    { id: "1", name: "中華そば すすきの軒", cancelled_at: null, paused_at: null },
    { id: "2", name: "和牛EN yasaka.arakawa", cancelled_at: null, paused_at: null },
    { id: "3", name: "エミナルクリニック　札幌院", cancelled_at: null, paused_at: null },
  ];

  it("解約と停止中を検出する", () => {
    const diff = diffContractStatus(
      [
        { shopName: "中華そば すすきの軒", status: "cancelled" },
        { shopName: "和牛EN yasaka.arakawa", status: "paused" },
        { shopName: "エミナルクリニック 札幌院", status: "active" }, // 半角スペース違い
      ],
      shops,
    );
    expect(diff.changes).toHaveLength(2);
    expect(diff.changes.find((c) => c.shopId === "1")).toMatchObject({ from: "active", to: "cancelled" });
    expect(diff.changes.find((c) => c.shopId === "2")).toMatchObject({ from: "active", to: "paused" });
    // スペース表記が違っても照合できるので未一致にならない
    expect(diff.unmatched).toHaveLength(0);
  });

  it("既に反映済みなら変更なし", () => {
    const diff = diffContractStatus(
      [{ shopName: "中華そば すすきの軒", status: "cancelled" }],
      [{ id: "1", name: "中華そば すすきの軒", cancelled_at: "2026-07-01T00:00:00Z", paused_at: null }],
    );
    expect(diff.changes).toHaveLength(0);
  });

  it("解約からの復活（契約中に戻す）も検出する", () => {
    const diff = diffContractStatus(
      [{ shopName: "復活店", status: "active" }],
      [{ id: "9", name: "復活店", cancelled_at: "2026-01-01T00:00:00Z", paused_at: null }],
    );
    expect(diff.changes[0]).toMatchObject({ from: "cancelled", to: "active" });
  });

  it("DBに無い店舗は unmatched に入れる（黙って捨てない）", () => {
    const diff = diffContractStatus(
      [{ shopName: "存在しない店", status: "cancelled" }],
      shops,
    );
    expect(diff.changes).toHaveLength(0);
    expect(diff.unmatched).toEqual([{ shopName: "存在しない店", status: "cancelled" }]);
  });

  it("DBに同名が複数ある場合は触らない（誤った店舗を解約にしない）", () => {
    const diff = diffContractStatus(
      [{ shopName: "同名店", status: "cancelled" }],
      [
        { id: "a", name: "同名店", cancelled_at: null, paused_at: null },
        { id: "b", name: "同名店", cancelled_at: null, paused_at: null },
      ],
    );
    expect(diff.changes).toHaveLength(0);
    expect(diff.duplicatedInDb).toEqual(["同名店"]);
  });

  it("マスタに同名でステータス違いがある場合も触らない", () => {
    const diff = diffContractStatus(
      [
        { shopName: "ゆれ店", status: "cancelled" },
        { shopName: "ゆれ店", status: "active" },
      ],
      [{ id: "c", name: "ゆれ店", cancelled_at: null, paused_at: null }],
    );
    expect(diff.changes).toHaveLength(0);
    expect(diff.duplicatedInMaster).toEqual(["ゆれ店"]);
  });
});

describe("currentStatus", () => {
  it("解約は停止に優先する", () => {
    expect(
      currentStatus({ id: "1", name: "x", cancelled_at: "2026-01-01", paused_at: "2026-02-01" }),
    ).toBe("cancelled");
  });
  it("どちらも無ければ契約中", () => {
    expect(currentStatus({ id: "1", name: "x", cancelled_at: null, paused_at: null })).toBe("active");
  });
});

describe("statusToColumns", () => {
  const now = "2026-08-01T00:00:00Z";
  it("解約は cancelled_at のみ立てる", () => {
    expect(statusToColumns("cancelled", now)).toEqual({ cancelled_at: now, paused_at: null });
  });
  it("停止中は paused_at のみ立てる", () => {
    expect(statusToColumns("paused", now)).toEqual({ cancelled_at: null, paused_at: now });
  });
  it("契約中は両方クリアする（復活時に確実に戻す）", () => {
    expect(statusToColumns("active", now)).toEqual({ cancelled_at: null, paused_at: null });
  });
});

describe("parseMasterCsv", () => {
  it("A=顧客ID / B=ステータス / C=店舗名 を読む", () => {
    const rows = [
      ["顧客ID", "ステータス管理", "店舗名🥛", "カテゴリ🥛"],
      ["MJS001", "契約中", "焼肉こてつ 川口道合店", "焼肉"],
      ["MJS002", "解約", "鮨棗 本店", "寿司"],
      ["MJS003", "停止中", "和牛EN yasaka.arakawa", "焼肉"],
    ];
    const out = parseMasterCsv(rows);
    expect(out).toEqual([
      { shopName: "焼肉こてつ 川口道合店", status: "active" },
      { shopName: "鮨棗 本店", status: "cancelled" },
      { shopName: "和牛EN yasaka.arakawa", status: "paused" },
    ]);
  });

  it("空行・ステータス未記入・列不足の行は落とす", () => {
    const rows = [
      ["", "", ""],
      ["MJS010", "", "名前だけの店"],
      ["MJS011", "検討中", "未知ステータスの店"],
      ["MJS012", "契約中", ""],
      ["MJS013"],
    ];
    expect(parseMasterCsv(rows)).toEqual([]);
  });
});
