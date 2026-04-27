/**
 * GBP OAuthトークン管理（一元化）
 * - Supabase REST API経由でトークン取得・書き戻し
 * - refresh_tokenで自動リフレッシュ
 * - GBP API呼び出し時の401リトライ
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const GO_API_URL = process.env.NEXT_PUBLIC_API_URL || "";
const GBP_CLIENT_ID = process.env.GBP_CLIENT_ID || "";
const GBP_CLIENT_SECRET = process.env.GBP_CLIENT_SECRET || "";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
}

interface TokenInfo {
  account_id: string;
  access_token: string;
  refresh_token: string;
  expiry: string;
}

/**
 * Supabase REST API経由でsystem.tokensのトークンを書き戻す
 */
async function saveTokenToDb(accountId: string, accessToken: string, expiry: string): Promise<void> {
  const supabase = getSupabase();
  // RPC関数経由で書き戻し（ビューのUPDATEは不可のため）
  const { error: rpcError } = await supabase.rpc("update_system_token", {
    p_account_id: accountId,
    p_access_token: accessToken,
    p_expiry: expiry,
  });
  if (rpcError) {
    // RPC未定義の場合はSQL直接実行（service_role keyで）
    console.log("[gbp-token] RPC fallback, trying direct REST...", rpcError.message);
    // Supabase REST APIで直接system.tokensを更新
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/update_system_token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        p_account_id: accountId,
        p_access_token: accessToken,
        p_expiry: expiry,
      }),
    });
    if (!res.ok) {
      console.error("[gbp-token] Token save failed:", await res.text().catch(() => ""));
    }
  }
}

/**
 * refresh_tokenでaccess_tokenを更新
 */
async function refreshToken(token: TokenInfo): Promise<string | null> {
  if (!token.refresh_token || !GBP_CLIENT_ID || !GBP_CLIENT_SECRET) return null;

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GBP_CLIENT_ID,
        client_secret: GBP_CLIENT_SECRET,
        refresh_token: token.refresh_token,
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      console.error(`[gbp-token] Refresh failed: HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();
    if (!data.access_token) return null;

    const newExpiry = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString();
    console.log(`[gbp-token] Refreshed token, expires ${newExpiry}`);

    // DB書き戻し（非同期、失敗しても新しいトークンは返す）
    try {
      await saveTokenToDb(token.account_id, data.access_token, newExpiry);
    } catch (e: any) {
      console.error("[gbp-token] Token save error:", e?.message);
    }

    return data.access_token;
  } catch (e: any) {
    console.error(`[gbp-token] Refresh error:`, e?.message);
    return null;
  }
}

/**
 * DBからトークンを取得
 */
async function getTokensFromDb(): Promise<TokenInfo[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("system_oauth_tokens")
    .select("access_token, refresh_token, expiry")
    .order("expiry", { ascending: false });

  if (error || !data || data.length === 0) {
    if (error) console.error("[gbp-token] DB read error:", error.message);
    return [];
  }

  return data.map((d, i) => ({
    account_id: `account-${i}`,
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    expiry: d.expiry,
  }));
}

/**
 * 有効なOAuthトークンを取得（自動リフレッシュ付き）
 * 常にリフレッシュを試みて最新のトークンを返す
 */
export async function getValidTokens(): Promise<string[]> {
  // Step 1: Go APIにトークンリフレッシュを発火させる
  try {
    await fetch(`${GO_API_URL}/api/gbp/account`, { signal: AbortSignal.timeout(15000) });
  } catch {}

  // Step 2: DBからトークン取得
  const allTokens = await getTokensFromDb();
  if (allTokens.length === 0) {
    console.error("[gbp-token] No tokens found");
    return [];
  }

  // Step 3: 常にrefresh_tokenでリフレッシュ（DB内のaccess_tokenは信用しない）
  const validTokens: string[] = [];
  for (const token of allTokens) {
    if (token.refresh_token) {
      const refreshed = await refreshToken(token);
      if (refreshed) {
        validTokens.push(refreshed);
        continue;
      }
    }
    // リフレッシュ失敗 or refresh_tokenなし → DBのトークンをそのまま使う
    validTokens.push(token.access_token);
  }

  return validTokens;
}

/**
 * 単一の有効なOAuthトークンを取得
 */
export async function getOAuthToken(): Promise<string | null> {
  const tokens = await getValidTokens();
  return tokens.length > 0 ? tokens[0] : null;
}

/**
 * GBP APIを呼び出す（401時に次のトークンを試す）
 */
export async function callGbpApi(
  url: string,
  options: { method?: string; body?: any; timeout?: number } = {}
): Promise<{ ok: boolean; status: number; data: any }> {
  const tokens = await getValidTokens();
  if (tokens.length === 0) {
    return { ok: false, status: 0, data: { error: "OAuthトークンなし" } };
  }

  const method = options.method || "GET";
  const timeout = options.timeout || 30000;

  for (const token of tokens) {
    try {
      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(timeout),
      });

      if (res.status === 401 || res.status === 403) continue;

      const data = res.ok ? await res.json().catch(() => ({})) : await res.text().catch(() => "");
      return { ok: res.ok, status: res.status, data };
    } catch (e: any) {
      console.error(`[gbp-token] API call error: ${e?.message}`);
    }
  }

  return { ok: false, status: 401, data: { error: "全トークンが無効" } };
}
