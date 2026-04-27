import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const GBP_CLIENT_ID = process.env.GBP_CLIENT_ID || "";
const GBP_CLIENT_SECRET = process.env.GBP_CLIENT_SECRET || "";
const GO_API_URL = process.env.NEXT_PUBLIC_API_URL || "";

export async function GET(request: NextRequest) {
  const results: any = { timestamp: new Date().toISOString(), steps: [] };

  // Step 1: 環境変数
  results.env = {
    SUPABASE_URL: !!SUPABASE_URL,
    SUPABASE_SERVICE_KEY: !!SUPABASE_SERVICE_KEY,
    GBP_CLIENT_ID: !!GBP_CLIENT_ID,
    GBP_CLIENT_SECRET: !!GBP_CLIENT_SECRET,
    GO_API_URL: GO_API_URL || "未設定",
  };

  // Step 2: Supabaseビューからトークン取得
  let tokenData: any = null;
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
    const { data, error } = await supabase.from("system_oauth_tokens")
      .select("access_token, refresh_token, expiry").limit(1).maybeSingle();
    if (error) {
      results.steps.push({ step: "DB読み取り", status: "FAIL", error: error.message });
    } else if (data) {
      tokenData = data;
      results.steps.push({ step: "DB読み取り", status: "OK",
        token_len: data.access_token?.length,
        refresh_len: data.refresh_token?.length,
        expiry: data.expiry,
        remaining_min: Math.round((new Date(data.expiry).getTime() - Date.now()) / 60000),
      });
    } else {
      results.steps.push({ step: "DB読み取り", status: "FAIL", error: "トークンなし" });
    }
  } catch (e: any) {
    results.steps.push({ step: "DB読み取り", status: "FAIL", error: e?.message });
  }

  // Step 3: DB内のaccess_tokenでGBP APIテスト
  if (tokenData?.access_token) {
    try {
      const res = await fetch("https://mybusinessbusinessinformation.googleapis.com/v1/categories?regionCode=JP&languageCode=ja&view=BASIC&pageSize=1", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
        signal: AbortSignal.timeout(10000),
      });
      results.steps.push({ step: "GBP APIテスト(DB内トークン)", status: res.ok ? "OK" : `FAIL HTTP ${res.status}` });
    } catch (e: any) {
      results.steps.push({ step: "GBP APIテスト(DB内トークン)", status: "FAIL", error: e?.message });
    }
  }

  // Step 4: refresh_tokenでリフレッシュ
  let freshToken: string | null = null;
  if (tokenData?.refresh_token && GBP_CLIENT_ID && GBP_CLIENT_SECRET) {
    try {
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: GBP_CLIENT_ID, client_secret: GBP_CLIENT_SECRET,
          refresh_token: tokenData.refresh_token, grant_type: "refresh_token",
        }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.access_token) {
        freshToken = data.access_token;
        results.steps.push({ step: "トークンリフレッシュ", status: "OK", expires_in: data.expires_in });
      } else {
        results.steps.push({ step: "トークンリフレッシュ", status: `FAIL HTTP ${res.status}`, detail: JSON.stringify(data).slice(0, 300) });
      }
    } catch (e: any) {
      results.steps.push({ step: "トークンリフレッシュ", status: "FAIL", error: e?.message });
    }
  } else {
    results.steps.push({ step: "トークンリフレッシュ", status: "SKIP", reason: "refresh_token or credentials missing" });
  }

  // Step 5: リフレッシュ後トークンでGBP APIテスト
  if (freshToken) {
    try {
      const res = await fetch("https://mybusinessbusinessinformation.googleapis.com/v1/categories?regionCode=JP&languageCode=ja&view=BASIC&pageSize=1", {
        headers: { Authorization: `Bearer ${freshToken}` },
        signal: AbortSignal.timeout(10000),
      });
      results.steps.push({ step: "GBP APIテスト(リフレッシュ後)", status: res.ok ? "OK" : `FAIL HTTP ${res.status}` });
    } catch (e: any) {
      results.steps.push({ step: "GBP APIテスト(リフレッシュ後)", status: "FAIL", error: e?.message });
    }
  }

  // Step 6: getOAuthToken() テスト（実際のCronと同じ関数）
  try {
    const { getOAuthToken } = await import("@/lib/gbp-token");
    const token = await getOAuthToken();
    if (token) {
      results.steps.push({ step: "getOAuthToken()", status: "OK", token_len: token.length });
      // このトークンでGBP APIテスト
      const res = await fetch("https://mybusinessbusinessinformation.googleapis.com/v1/categories?regionCode=JP&languageCode=ja&view=BASIC&pageSize=1", {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      });
      results.steps.push({ step: "GBP APIテスト(getOAuthToken)", status: res.ok ? "OK" : `FAIL HTTP ${res.status}` });
    } else {
      results.steps.push({ step: "getOAuthToken()", status: "FAIL", error: "null返却" });
    }
  } catch (e: any) {
    results.steps.push({ step: "getOAuthToken()", status: "FAIL", error: e?.message });
  }

  return NextResponse.json(results, { status: 200 });
}
