import { describe, it, expect } from "vitest";
import {
  parseContractStatus,
  normalizeShopName,
  diffContractStatus,
  diffRankTracking,
  currentStatus,
  statusToColumns,
  parseMasterCsv,
  parseMasterCsvDetailed,
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

describe("diffRankTracking（マスタの契約中だけを計測対象にする）", () => {
  const master = [
    { shopName: "契約中の店", status: "active" as const },
    { shopName: "解約した店", status: "cancelled" as const },
    { shopName: "停止中の店", status: "paused" as const },
    { shopName: "エミナルクリニック 札幌院", status: "active" as const },
  ];

  it("解約・停止中・マスタ未掲載を対象外にする", () => {
    const changes = diffRankTracking(master, [
      { id: "1", name: "契約中の店", cancelled_at: null },
      { id: "2", name: "解約した店", cancelled_at: null },
      { id: "3", name: "停止中の店", cancelled_at: null },
      { id: "4", name: "マスタに無い店", cancelled_at: null },
    ]);
    expect(changes.map((c) => c.shopId).sort()).toEqual(["2", "3", "4"]);
    expect(changes.every((c) => c.disable && c.reason === "master")).toBe(true);
    expect(changes.find((c) => c.shopId === "2")!.detail).toBe("マスタで解約");
    expect(changes.find((c) => c.shopId === "3")!.detail).toBe("マスタで停止中");
    expect(changes.find((c) => c.shopId === "4")!.detail).toBe("マスタ未掲載");
  });

  it("契約中の店は対象のまま（変更なし）", () => {
    const changes = diffRankTracking(master, [
      { id: "1", name: "契約中の店", cancelled_at: null, rank_tracking_disabled: false },
    ]);
    expect(changes).toHaveLength(0);
  });

  it("【最重要】手動指定（エミナル）は同期で対象に戻さない", () => {
    // マスタでは契約中だが、人が手動で対象外にしている。
    // ここを戻してしまうと、せっかく外した122件が毎回復活する
    const changes = diffRankTracking(master, [
      {
        id: "e1",
        name: "エミナルクリニック 札幌院",
        cancelled_at: null,
        rank_tracking_disabled: true,
        rank_tracking_reason: "manual",
      },
    ]);
    expect(changes).toHaveLength(0);
  });

  it("マスタ由来で外した店舗は、契約中に戻れば対象に復帰する", () => {
    const changes = diffRankTracking(master, [
      {
        id: "1",
        name: "契約中の店",
        cancelled_at: null,
        rank_tracking_disabled: true,
        rank_tracking_reason: "master",
      },
    ]);
    expect(changes).toEqual([
      { shopId: "1", shopName: "契約中の店", disable: false, reason: null, detail: "マスタで契約中" },
    ]);
  });

  it("既に対象外のものを重複して対象外にしない", () => {
    const changes = diffRankTracking(master, [
      {
        id: "2",
        name: "解約した店",
        cancelled_at: null,
        rank_tracking_disabled: true,
        rank_tracking_reason: "master",
      },
    ]);
    expect(changes).toHaveLength(0);
  });

  it("表記ゆれ（全角/半角スペース）を吸収する", () => {
    const changes = diffRankTracking(master, [
      { id: "e2", name: "エミナルクリニック　札幌院", cancelled_at: null, rank_tracking_disabled: false },
    ]);
    // マスタで契約中なので対象外にはしない
    expect(changes).toHaveLength(0);
  });

  it("マスタに同名でステータスが割れている場合は安全側（契約中でない方）を採る", () => {
    const changes = diffRankTracking(
      [
        { shopName: "ゆれ店", status: "active" },
        { shopName: "ゆれ店", status: "cancelled" },
      ],
      [{ id: "x", name: "ゆれ店", cancelled_at: null, rank_tracking_disabled: false }],
    );
    expect(changes).toHaveLength(1);
    expect(changes[0].disable).toBe(true);
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

describe("計測が黙って止まる経路を塞ぐ（2026-08-01 レビュー指摘）", () => {
  it("手動で計測対象に戻した店舗を、同期が再び対象外にしない", () => {
    // 修正前は disabled && reason==='manual' で判定していたため、
    // disabled=false かつ manual（人が手動で戻した）が素通りして再度落とされ、
    // reason も master で上書きされ手動の意思が消えていた
    const changes = diffRankTracking(
      [{ shopName: "手動で戻した店", status: "cancelled" }],
      [{
        id: "m1", name: "手動で戻した店", cancelled_at: null,
        rank_tracking_disabled: false, rank_tracking_reason: "manual",
      }],
    );
    expect(changes).toHaveLength(0);
  });

  it("ステータスを解釈できない行は捨てずに返す（黙って計測を止めない）", () => {
    const { rows, unknownStatus } = parseMasterCsvDetailed([
      ["顧客ID", "ステータス管理", "店舗名"],
      ["MJS1", "契約中", "正常な店"],
      ["MJS2", "契約中（2026/4〜）", "表記ゆれの店"],
      ["MJS3", "", "空欄の店"],
    ]);
    expect(rows).toEqual([{ shopName: "正常な店", status: "active" }]);
    // 表記ゆれは報告される。空欄は「未記入」なので報告しない
    expect(unknownStatus).toEqual([{ shopName: "表記ゆれの店", raw: "契約中（2026/4〜）" }]);
  });

  it("解釈できなかった店舗は現状維持にする（表記ゆれで計測を止めない）", () => {
    const unknown = new Set([normalizeShopName("表記ゆれの店")]);
    const changes = diffRankTracking(
      [{ shopName: "正常な店", status: "active" }], // 表記ゆれの店はmasterに載らない
      [
        { id: "a", name: "正常な店", cancelled_at: null, rank_tracking_disabled: false },
        { id: "b", name: "表記ゆれの店", cancelled_at: null, rank_tracking_disabled: false },
      ],
      unknown,
    );
    // unknownを渡さなければ「マスタ未掲載」として対象外にされてしまう
    expect(changes).toHaveLength(0);
  });

  it("unknownNameを渡さない場合は従来どおりマスタ未掲載として扱う", () => {
    const changes = diffRankTracking(
      [{ shopName: "正常な店", status: "active" }],
      [{ id: "b", name: "マスタに無い店", cancelled_at: null, rank_tracking_disabled: false }],
    );
    expect(changes).toHaveLength(1);
    expect(changes[0].detail).toBe("マスタ未掲載");
  });
});

describe("MEO顧客管理シートへの切替（2026-09-04）", () => {
  it("A=ステータス / B=店舗名 の新レイアウトをヘッダーから自動判定して読む", () => {
    const { rows, blankStatus } = parseMasterCsvDetailed([
      ["元データ", "更新日　：　9/4", ""],
      ["ステータス", "店舗名", ""],
      ["契約中", "焼肉こてつ 川口道合店", ""],
      ["解約", "鮨棗 本店", ""],
      ["停止中", "和牛EN yasaka.arakawa", ""],
      ["", "ステータス空欄の店", ""],
      ["", "", ""],
    ]);
    expect(rows).toEqual([
      { shopName: "焼肉こてつ 川口道合店", status: "active" },
      { shopName: "鮨棗 本店", status: "cancelled" },
      { shopName: "和牛EN yasaka.arakawa", status: "paused" },
    ]);
    // 空欄は「無視」＝呼び出し側が現状維持にできるよう名前だけ返す
    expect(blankStatus).toEqual(["ステータス空欄の店"]);
  });

  it("旧レイアウト（A=顧客ID/B=ステータス/C=店舗名）も引き続き読める", () => {
    const { rows } = parseMasterCsvDetailed([
      ["顧客ID", "ステータス管理", "店舗名🥛"],
      ["MJS001", "契約中", "焼肉こてつ 川口道合店"],
    ]);
    expect(rows).toEqual([{ shopName: "焼肉こてつ 川口道合店", status: "active" }]);
  });

  it("空欄の店舗を unknownNames に渡せば、マスタ未掲載として計測を止めない", () => {
    const blank = new Set([normalizeShopName("空欄の店")]);
    const changes = diffRankTracking(
      [{ shopName: "契約中の店", status: "active" }],
      [
        { id: "a", name: "契約中の店", cancelled_at: null, rank_tracking_disabled: false },
        { id: "b", name: "空欄の店", cancelled_at: null, rank_tracking_disabled: false },
        { id: "c", name: "本当に未掲載の店", cancelled_at: null, rank_tracking_disabled: false },
      ],
      blank,
    );
    expect(changes.map((c) => c.shopName)).toEqual(["本当に未掲載の店"]);
  });

  it("シートがGBP現在名で書かれていても gbp_shop_name で照合する（CEYLON HOUSE / うら山本店の再発防止）", () => {
    const master = [
      { shopName: "CEYLON HOUSE スリランカ・ロゼカレー", status: "active" as const },
      { shopName: "うら山本店", status: "cancelled" as const },
    ];
    const shops = [
      { id: "1", name: "SPICE CURRY CEYLON HOUSE", gbp_shop_name: "CEYLON HOUSE スリランカ・ロゼカレー", cancelled_at: null, rank_tracking_disabled: true, rank_tracking_reason: "master" },
      { id: "2", name: "うら山 本店", gbp_shop_name: "うら山本店", cancelled_at: null, rank_tracking_disabled: false },
    ];
    const rank = diffRankTracking(master, shops);
    expect(rank).toEqual([
      expect.objectContaining({ shopId: "1", disable: false }),
      expect.objectContaining({ shopId: "2", disable: true, detail: "マスタで解約" }),
    ]);
    const diff = diffContractStatus(master, shops);
    expect(diff.unmatched).toEqual([]);
    expect(diff.changes).toEqual([{ shopId: "2", shopName: "うら山 本店", from: "active", to: "cancelled" }]);
  });

  it("name と GBP現在名の両方がマスタに載っていても、店舗ごとに1回だけ変更する", () => {
    const master = [
      { shopName: "旧名の店", status: "cancelled" as const },
      { shopName: "新名の店", status: "cancelled" as const },
    ];
    const shops = [{ id: "1", name: "旧名の店", gbp_shop_name: "新名の店", cancelled_at: null }];
    const diff = diffContractStatus(master, shops);
    expect(diff.changes).toHaveLength(1);
    expect(diff.duplicatedInDb).toEqual([]);
  });

  it("GBP現在名が別の店舗の name と衝突する場合は触らない", () => {
    const master = [{ shopName: "渋谷店", status: "cancelled" as const }];
    const shops = [
      { id: "1", name: "渋谷店", cancelled_at: null },
      { id: "2", name: "旧渋谷店", gbp_shop_name: "渋谷店", cancelled_at: null },
    ];
    const diff = diffContractStatus(master, shops);
    expect(diff.changes).toEqual([]);
    expect(diff.duplicatedInDb).toEqual(["渋谷店"]);
  });
});
