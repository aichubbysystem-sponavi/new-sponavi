import { describe, it, expect } from "vitest";
import { parseCampaignName } from "./google-ads";

describe("parseCampaignName", () => {
  // 標準パターン: P-MAX {店舗名} {言語}
  it("P-MAX + 店舗名 + Japanese", () => {
    expect(parseCampaignName("P-MAX ACE COLOR 那覇小禄イオン店 Japanese")).toEqual({
      shopName: "ACE COLOR 那覇小禄イオン店",
      language: "Japanese",
    });
  });

  it("P-MAX + 店舗名 + Chinese", () => {
    expect(parseCampaignName("P-MAX 一文字premium Chinese")).toEqual({
      shopName: "一文字premium",
      language: "Chinese",
    });
  });

  it("P-MAX + 店舗名 + English", () => {
    expect(parseCampaignName("P-MAX KYOTO SAMURAI WALK English")).toEqual({
      shopName: "KYOTO SAMURAI WALK",
      language: "English",
    });
  });

  it("P-MAX + 店舗名 + Korean", () => {
    expect(parseCampaignName("P-MAX MUSIC BAR SIDE:K SAPPORO Korean")).toEqual({
      shopName: "MUSIC BAR SIDE:K SAPPORO",
      language: "Korean",
    });
  });

  // 特殊文字を含む店舗名
  it("店舗名にスラッシュ含む", () => {
    expect(parseCampaignName("P-MAX il pleut / イルプル Japanese")).toEqual({
      shopName: "il pleut / イルプル",
      language: "Japanese",
    });
  });

  it("店舗名にダッシュ・アクセント含む", () => {
    expect(parseCampaignName("P-MAX patty rôti ‑パティロティ‑ Japanese")).toEqual({
      shopName: "patty rôti ‑パティロティ‑",
      language: "Japanese",
    });
  });

  it("店舗名に全角パイプ含む", () => {
    expect(parseCampaignName("P-MAX ホワイトニング専門クリニック ブランペルル｜whitening clinic BlancPerle Japanese")).toEqual({
      shopName: "ホワイトニング専門クリニック ブランペルル｜whitening clinic BlancPerle",
      language: "Japanese",
    });
  });

  // 来店CV用パターン
  it("来店CV用 + 店舗名（言語なし）", () => {
    expect(parseCampaignName("来店CV用 とりとん 大久保店")).toEqual({
      shopName: "とりとん 大久保店",
      language: "Japanese",
    });
  });

  it("来店CV用 + 全角数字 + 店舗名", () => {
    expect(parseCampaignName("来店CV用７ 海老元")).toEqual({
      shopName: "海老元",
      language: "Japanese",
    });
  });

  // パターン不一致
  it("P-MAXプレフィックスなし・言語サフィックスなし → Unknown", () => {
    expect(parseCampaignName("何かのキャンペーン")).toEqual({
      shopName: "何かのキャンペーン",
      language: "Unknown",
    });
  });

  it("空文字", () => {
    expect(parseCampaignName("")).toEqual({
      shopName: "",
      language: "Unknown",
    });
  });

  // 末尾が言語に似ているが違うケース
  it("末尾がKNOWN_LANGUAGESにない単語", () => {
    expect(parseCampaignName("P-MAX テスト店 Klingon")).toEqual({
      shopName: "テスト店 Klingon",
      language: "Unknown",
    });
  });
});
