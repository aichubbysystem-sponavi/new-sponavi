import { describe, it, expect } from "vitest";
import { isValidGbpPostName } from "./gbp-validate";

describe("isValidGbpPostName", () => {
  it("正当な localPost 名を受理する", () => {
    expect(isValidGbpPostName("accounts/123/locations/456/localPosts/789")).toBe(true);
    expect(isValidGbpPostName("locations/456/localPosts/abc-DEF_012")).toBe(true);
    expect(isValidGbpPostName("accounts/1/locations/2/localPosts/xY_9-z")).toBe(true);
  });

  it("localPosts を含まない名前は拒否する（他リソース削除防止）", () => {
    expect(isValidGbpPostName("accounts/123/locations/456")).toBe(false);
    expect(isValidGbpPostName("accounts/123/locations/456/media/1")).toBe(false);
  });

  it("パストラバーサルや空セグメントを拒否する", () => {
    expect(isValidGbpPostName("accounts/../locations/x/localPosts/1")).toBe(false);
    expect(isValidGbpPostName("accounts/1/locations//localPosts/1")).toBe(false);
    expect(isValidGbpPostName("/accounts/1/locations/2/localPosts/3")).toBe(false);
    expect(isValidGbpPostName("accounts/1/locations/2/localPosts/3/")).toBe(false);
  });

  it("クエリ・フラグメント・不正文字を含む名前を拒否する", () => {
    expect(isValidGbpPostName("accounts/1/locations/2/localPosts/3?foo=bar")).toBe(false);
    expect(isValidGbpPostName("accounts/1/locations/2/localPosts/3#x")).toBe(false);
    expect(isValidGbpPostName("accounts/1/locations/2/localPosts/3 4")).toBe(false);
    expect(isValidGbpPostName("accounts/1/locations/2/localPosts/店")).toBe(false);
  });

  it("ルートが accounts/ でも locations/ でもない名前を拒否する", () => {
    expect(isValidGbpPostName("evil/1/localPosts/2")).toBe(false);
    expect(isValidGbpPostName("localPosts/2")).toBe(false);
  });

  it("非文字列・空を拒否する", () => {
    expect(isValidGbpPostName(undefined)).toBe(false);
    expect(isValidGbpPostName(null)).toBe(false);
    expect(isValidGbpPostName("")).toBe(false);
    expect(isValidGbpPostName(123)).toBe(false);
  });
});
