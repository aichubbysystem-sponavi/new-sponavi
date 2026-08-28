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
    expect(s).toContain("30秒以内・75MB以下・720p以上");
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
