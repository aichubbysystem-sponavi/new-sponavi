import { describe, it, expect } from "vitest";
import { isShareActive, shareExpiryISO, SHARE_TTL_DAYS } from "./share-token";

const T0 = Date.UTC(2026, 6, 7, 0, 0, 0); // 2026-07-07
const DAY = 24 * 60 * 60 * 1000;

describe("isShareActive", () => {
  it("expires_at 無し（既存トークン）は無期限で有効", () => {
    expect(isShareActive({}, T0)).toBe(true);
    expect(isShareActive({ expires_at: null, revoked_at: null }, T0)).toBe(true);
  });

  it("未来の expires_at は有効", () => {
    expect(isShareActive({ expires_at: new Date(T0 + DAY).toISOString() }, T0)).toBe(true);
  });

  it("過去の expires_at は無効（期限切れ）", () => {
    expect(isShareActive({ expires_at: new Date(T0 - DAY).toISOString() }, T0)).toBe(false);
  });

  it("revoked_at があれば期限に関係なく無効", () => {
    expect(isShareActive({ expires_at: new Date(T0 + DAY).toISOString(), revoked_at: new Date(T0).toISOString() }, T0)).toBe(false);
  });

  it("null / undefined は無効", () => {
    expect(isShareActive(null, T0)).toBe(false);
    expect(isShareActive(undefined, T0)).toBe(false);
  });
});

describe("shareExpiryISO", () => {
  it("now から SHARE_TTL_DAYS 後を返す", () => {
    const iso = shareExpiryISO(T0);
    expect(new Date(iso).getTime()).toBe(T0 + SHARE_TTL_DAYS * DAY);
  });
});
