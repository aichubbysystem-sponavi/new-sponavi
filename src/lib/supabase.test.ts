import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

// Mock environment variables before importing
vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-key");
vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
vi.stubEnv("CRON_SECRET", "test-cron-secret");

describe("verifyCron", () => {
  it("正しいトークンで通過", async () => {
    const { verifyCron } = await import("./supabase");
    const req = new NextRequest("https://test.com/api/cron/test", {
      headers: { authorization: "Bearer test-cron-secret" },
    });
    const result = verifyCron(req);
    expect(result).toBeNull();
  });

  it("不正なトークンで401", async () => {
    const { verifyCron } = await import("./supabase");
    const req = new NextRequest("https://test.com/api/cron/test", {
      headers: { authorization: "Bearer wrong-secret" },
    });
    const result = verifyCron(req);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it("トークンなしで401", async () => {
    const { verifyCron } = await import("./supabase");
    const req = new NextRequest("https://test.com/api/cron/test");
    const result = verifyCron(req);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });
});

describe("verifyAuth", () => {
  it("Bearerなしヘッダーでinvalid", async () => {
    const { verifyAuth } = await import("./supabase");
    const result = await verifyAuth(null);
    expect(result.valid).toBe(false);
  });

  it("Bearer prefix なしでinvalid", async () => {
    const { verifyAuth } = await import("./supabase");
    const result = await verifyAuth("just-a-token");
    expect(result.valid).toBe(false);
  });
});
