import { describe, it, expect } from "vitest";
import { explainGbpError } from "./gbp-error-ja";

describe("explainGbpError", () => {
  it("errorDetails の理由を優先して日本語化し、原文を残す", () => {
    const raw = JSON.stringify({ error: { code: 400, message: "Request contains an invalid argument.", status: "INVALID_ARGUMENT",
      details: [{ "@type": "type.googleapis.com/google.mybusiness.v4.ValidationError", errorDetails: [{ code: 5, field: "media", message: "Video duration exceeds 30 seconds" }] }] } });
    const s = explainGbpError("GBP Media API", 400, raw, { isMedia: true });
    expect(s).toContain("30秒");
    expect(s).toContain("Google: media: Video duration exceeds 30 seconds");
    expect(s).toContain("GBP Media API 400:");
  });

  it("details が無い 400 の写真投稿は仕様の確認項目を案内する", () => {
    const raw = '{ "error": { "code": 400, "message": "Request contains an invalid argument.", "status": "INVALID_ARGUMENT" } }';
    const s = explainGbpError("GBP Media API", 400, raw, { isMedia: true });
    expect(s).toContain("25MB以下・30秒以内・720p以上");
  });

  it("25MB超（bytes too large）は日本語でサイズ超過と説明し、実サイズも拾う", () => {
    const raw = '{"error":{"code":400,"message":"Request contains an invalid argument.","status":"INVALID_ARGUMENT","details":[{"@type":"type.googleapis.com/google.mybusiness.v4.ValidationError","errorDetails":[{"code":10,"message":"Media fetch response bytes too large (max: 26214400B).","value":"https://x/y.mov"}]}]}}';
    const s = explainGbpError("GBP Media API", 400, raw, { isMedia: true });
    expect(s).toContain("上限25MB");
    expect(s).toContain("Google: Media fetch response bytes too large");
  });

  it("Fetching image failed は取得失敗と説明する", () => {
    const raw = '{"error":{"code":400,"message":"Request contains an invalid argument.","details":[{"errorDetails":[{"code":1000,"message":"Fetching image failed."}]}]}}';
    expect(explainGbpError("GBP Media API", 400, raw, { isMedia: true })).toContain("取得に失敗");
  });

  it("JSONでない本文でも落ちない", () => {
    const s = explainGbpError("Go API", 502, "<html>Bad Gateway</html>");
    expect(s).toContain("一時的な障害");
    expect(s).toContain("Go API 502");
  });

  it("404 はロケーション不明と説明する", () => {
    const s = explainGbpError("GBP API", 404, '{"error":{"code":404,"message":"Requested entity was not found.","status":"NOT_FOUND"}}');
    expect(s).toContain("ロケーションが見つかりません");
  });
});
