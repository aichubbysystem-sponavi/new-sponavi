/**
 * fetchGbpWithFallback: 主トークンで 403/404 → 全アカウントのトークンで再試行し、
 * 成功トークンをキー単位で記憶することを検証する（2026-09-05 検索語句349店舗無音失敗の再発防止）
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Go API なし（主トークンは system_oauth_tokens のリフレッシュ経由ではなく primaryToken 引数で渡す）
vi.mock("@/lib/supabase", () => {
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const rows = [
    { access_token: "tok-B", refresh_token: "r-B", expiry: future },
    { access_token: "tok-C", refresh_token: "r-C", expiry: future },
  ];
  const chain = {
    select: () => Promise.resolve({ data: rows, error: null }),
  };
  return {
    getSupabase: () => ({
      from: () => chain,
      rpc: () => Promise.resolve({ data: [], error: null }),
    }),
  };
});

import { fetchGbpWithFallback } from "./gbp-token";

type Call = { url: string; token: string };
let calls: Call[] = [];
/** token → HTTPステータス（未指定は200） */
let statusByToken: Record<string, number> = {};

beforeEach(() => {
  calls = [];
  statusByToken = {};
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: any) => {
    const token = String(init?.headers?.Authorization || "").replace("Bearer ", "");
    calls.push({ url, token });
    const status = statusByToken[token] ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({ hit: token }),
      text: async () => `error from ${token}`,
    } as any;
  }));
});

describe("fetchGbpWithFallback", () => {
  it("主トークンで成功したら再試行しない", async () => {
    const r = await fetchGbpWithFallback("https://x/locations/1", "locations/1", { primaryToken: "tok-A" });
    expect(r.ok).toBe(true);
    expect(r.token).toBe("tok-A");
    expect(calls.length).toBe(1);
  });

  it("主トークンが403なら他アカウントのトークンで順に再試行し、成功トークンを返す", async () => {
    statusByToken = { "tok-A": 403, "tok-B": 404 };
    const r = await fetchGbpWithFallback("https://x/locations/2", "locations/2", { primaryToken: "tok-A" });
    expect(r.ok).toBe(true);
    expect(r.token).toBe("tok-C");
    expect(calls.map((c) => c.token)).toEqual(["tok-A", "tok-B", "tok-C"]);
  });

  it("同じキーの2回目は記憶した成功トークンから始める（毎回フォールバックしない）", async () => {
    statusByToken = { "tok-A": 403, "tok-B": 404 };
    await fetchGbpWithFallback("https://x/locations/3?m=1", "locations/3", { primaryToken: "tok-A" });
    calls = [];
    const r = await fetchGbpWithFallback("https://x/locations/3?m=2", "locations/3", { primaryToken: "tok-A" });
    expect(r.ok).toBe(true);
    expect(calls.map((c) => c.token)).toEqual(["tok-C"]);
  });

  it("全トークンで403なら最後の失敗を返す（0ヶ月ではなく理由が残る）", async () => {
    statusByToken = { "tok-A": 403, "tok-B": 403, "tok-C": 403 };
    const r = await fetchGbpWithFallback("https://x/locations/4", "locations/4", { primaryToken: "tok-A" });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
    expect(r.errorText).toContain("error from");
    expect(calls.length).toBe(3);
  });

  it("500 や 429 はトークン問題ではないので再試行しない", async () => {
    statusByToken = { "tok-A": 429 };
    const r = await fetchGbpWithFallback("https://x/locations/5", "locations/5", { primaryToken: "tok-A" });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(429);
    expect(calls.length).toBe(1);
  });
});
