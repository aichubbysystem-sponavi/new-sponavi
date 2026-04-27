import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const GBP_CLIENT_ID = process.env.GBP_CLIENT_ID || "";
const GBP_CLIENT_SECRET = process.env.GBP_CLIENT_SECRET || "";
const GO_API_URL = process.env.NEXT_PUBLIC_API_URL || "";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
}

async function testGbpApi(token: string, label: string): Promise<any> {
  // 3つの異なるGBP APIエンドポイントでテスト
  const endpoints = [
    { name: "AccountManagement", url: "https://mybusinessaccountmanagement.googleapis.com/v1/accounts" },
    { name: "BusinessInfo", url: "https://mybusinessbusinessinformation.googleapis.com/v1/categories?regionCode=JP&languageCode=ja&view=BASIC&pageSize=1" },
    { name: "MyBusiness v4", url: "https://mybusiness.googleapis.com/v4/accounts" },
  ];
  const results: any = {};
  for (const ep of endpoints) {
    try {
      const res = await fetch(ep.url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      });
      results[ep.name] = res.ok ? "OK" : `FAIL ${res.status}`;
    } catch (e: any) {
      results[ep.name] = `ERR: ${e?.message}`;
    }
  }
  return { label, ...results };
}

export async function GET(request: NextRequest) {
  const results: any = { timestamp: new Date().toISOString(), steps: [] };
  const supabase = getSupabase();

  // ENV
  results.env = {
    GBP_CLIENT_ID: GBP_CLIENT_ID ? GBP_CLIENT_ID.slice(0, 20) + "..." : "未設定",
    GBP_CLIENT_SECRET: GBP_CLIENT_SECRET ? "***" + GBP_CLIENT_SECRET.slice(-4) : "未設定",
    GO_API_URL: GO_API_URL || "未設定",
  };

  // Step 1: Go API呼び出し（トークンリフレッシュ発火）
  try {
    const res = await fetch(`${GO_API_URL}/api/gbp/account`, { signal: AbortSignal.timeout(20000) });
    results.steps.push({ step: "Go API呼び出し", status: res.ok ? "OK" : `FAIL ${res.status}` });
  } catch (e: any) {
    results.steps.push({ step: "Go API呼び出し", status: "FAIL", error: e?.message });
  }

  // Step 2: RPC get_valid_tokens で全トークン取得
  let allTokens: any[] = [];
  try {
    const { data, error } = await supabase.rpc("get_valid_tokens");
    if (error) {
      results.steps.push({ step: "RPC get_valid_tokens", status: "FAIL", error: error.message });
    } else {
      allTokens = data || [];
      results.steps.push({
        step: "RPC get_valid_tokens",
        status: "OK",
        count: allTokens.length,
        tokens: allTokens.map((t: any) => ({
          account_id: t.account_id?.slice(0, 8) + "...",
          token_len: t.access_token?.length,
          refresh_len: t.refresh_token?.length,
          expiry: t.expiry,
          remaining_min: Math.round((new Date(t.expiry).getTime() - Date.now()) / 60000),
        })),
      });
    }
  } catch (e: any) {
    results.steps.push({ step: "RPC get_valid_tokens", status: "FAIL", error: e?.message });
  }

  // Step 3: ビューからも取得して比較
  try {
    const { data } = await supabase.from("system_oauth_tokens")
      .select("access_token, refresh_token, expiry").order("expiry", { ascending: false }).limit(3);
    results.steps.push({
      step: "ビュー system_oauth_tokens",
      count: data?.length || 0,
      tokens: (data || []).map((t: any) => ({
        token_len: t.access_token?.length,
        expiry: t.expiry,
        remaining_min: Math.round((new Date(t.expiry).getTime() - Date.now()) / 60000),
      })),
    });
  } catch {}

  // Step 4: 最新のDBトークンをそのままGBP APIテスト（リフレッシュなし）
  if (allTokens.length > 0) {
    const newest = allTokens[0];
    results.steps.push(await testGbpApi(newest.access_token, "DB最新トークン(リフレッシュなし)"));
  }

  // Step 5: 最新のrefresh_tokenでリフレッシュしてテスト
  if (allTokens.length > 0) {
    const newest = allTokens[0];
    if (newest.refresh_token && GBP_CLIENT_ID && GBP_CLIENT_SECRET) {
      try {
        const res = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: GBP_CLIENT_ID, client_secret: GBP_CLIENT_SECRET,
            refresh_token: newest.refresh_token, grant_type: "refresh_token",
          }),
          signal: AbortSignal.timeout(10000),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.access_token) {
          results.steps.push({ step: "リフレッシュ", status: "OK", expires_in: data.expires_in, scope: data.scope });
          results.steps.push(await testGbpApi(data.access_token, "リフレッシュ後トークン"));
        } else {
          results.steps.push({ step: "リフレッシュ", status: `FAIL ${res.status}`, detail: JSON.stringify(data).slice(0, 300) });
        }
      } catch (e: any) {
        results.steps.push({ step: "リフレッシュ", status: "FAIL", error: e?.message });
      }
    }
  }

  // Step 6: 全トークンをDBのまま順番にテスト（どれが動くか特定）
  if (allTokens.length > 1) {
    for (let i = 0; i < Math.min(allTokens.length, 4); i++) {
      const t = allTokens[i];
      try {
        const res = await fetch("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", {
          headers: { Authorization: `Bearer ${t.access_token}` },
          signal: AbortSignal.timeout(10000),
        });
        results.steps.push({
          step: `トークン${i + 1} AccountMgmt`,
          account_id: t.account_id?.slice(0, 8) + "...",
          expiry: t.expiry,
          status: res.ok ? "OK" : `FAIL ${res.status}`,
        });
      } catch {}
    }
  }

  return NextResponse.json(results, { status: 200 });
}
