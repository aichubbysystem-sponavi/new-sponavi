/**
 * GBP OAuthトークン管理（一元化）
 * - refresh_tokenで自動リフレッシュ
 * - リフレッシュ後にDBに書き戻し
 * - 複数アカウント対応
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
 * refresh_tokenでaccess_tokenを更新し、DBに書き戻す
 */
async function refreshAndSave(token: TokenInfo): Promise<string | null> {
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
      console.error(`[gbp-token] Refresh failed for ${token.account_id}: HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();
    const newAccessToken = data.access_token;
    const newExpiry = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString();

    if (!newAccessToken) return null;

    // DBに書き戻し（system_oauth_tokensビュー経由ではなくsystem.tokensに直接）
    const supabase = getSupabase();

    // system_oauth_tokensビュー経由で更新を試行
    await supabase.from("system_oauth_tokens").update({
      access_token: newAccessToken,
      expiry: newExpiry,
    }).eq("account_id", token.account_id);

    // PostgreSQL直接更新（ビューが更新不可の場合のフォールバック）
    try {
      const DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD || "";
      const PROJECT_ID = (SUPABASE_URL.match(/https:\/\/([^.]+)/) || [])[1] || "";
      if (DB_PASSWORD && PROJECT_ID) {
        const { Client } = await import("pg");
        const client = new Client({
          host: `db.${PROJECT_ID}.supabase.co`,
          port: 5432,
          database: "postgres",
          user: "postgres",
          password: DB_PASSWORD,
          ssl: { rejectUnauthorized: false },
          connectionTimeoutMillis: 10000,
        });
        await client.connect();
        await client.query(
          "UPDATE system.tokens SET access_token = $1, expiry = $2 WHERE account_id = $3",
          [newAccessToken, newExpiry, token.account_id]
        );
        await client.end();
      }
    } catch (e: any) {
      console.log("[gbp-token] PostgreSQL update fallback error:", e?.message);
    }

    console.log(`[gbp-token] Refreshed token for ${token.account_id}, expires ${newExpiry}`);
    return newAccessToken;
  } catch (e: any) {
    console.error(`[gbp-token] Refresh error for ${token.account_id}:`, e?.message);
    return null;
  }
}

/**
 * 有効なOAuthトークンを取得（自動リフレッシュ+DB書き戻し付き）
 * 返り値: 有効なaccess_tokenの配列（複数アカウント対応）
 */
export async function getValidTokens(): Promise<string[]> {
  // Step 1: Go APIでトークンリフレッシュを発火（Go API側のリフレッシュ機構も活用）
  try {
    await fetch(`${GO_API_URL}/api/gbp/account`, { signal: AbortSignal.timeout(15000) });
  } catch {}

  // Step 2: DBからトークン一覧を取得
  let allTokens: TokenInfo[] = [];

  const supabase = getSupabase();
  try {
    const { data } = await supabase.from("system_oauth_tokens")
      .select("account_id, access_token, refresh_token, expiry")
      .order("expiry", { ascending: false });
    if (data && data.length > 0) allTokens = data;
  } catch {}

  // フォールバック: PostgreSQL直接
  if (allTokens.length === 0) {
    try {
      const DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD || "";
      const PROJECT_ID = (SUPABASE_URL.match(/https:\/\/([^.]+)/) || [])[1] || "";
      if (DB_PASSWORD && PROJECT_ID) {
        const { Client } = await import("pg");
        const client = new Client({
          host: `db.${PROJECT_ID}.supabase.co`,
          port: 5432,
          database: "postgres",
          user: "postgres",
          password: DB_PASSWORD,
          ssl: { rejectUnauthorized: false },
          connectionTimeoutMillis: 10000,
        });
        await client.connect();
        const result = await client.query(
          "SELECT account_id, access_token, refresh_token, expiry FROM system.tokens ORDER BY expiry DESC"
        );
        await client.end();
        if (result.rows.length > 0) allTokens = result.rows;
      }
    } catch {}
  }

  if (allTokens.length === 0) {
    console.error("[gbp-token] No tokens found in DB");
    return [];
  }

  // Step 3: 各トークンの有効性を確認、期限切れならリフレッシュ
  const validTokens: string[] = [];
  for (const token of allTokens) {
    const remaining = new Date(token.expiry).getTime() - Date.now();

    if (remaining > 5 * 60 * 1000) {
      // 5分以上残っている → そのまま使用
      validTokens.push(token.access_token);
    } else if (token.refresh_token) {
      // 期限切れ or 5分以内 → リフレッシュ
      const refreshed = await refreshAndSave(token);
      if (refreshed) {
        validTokens.push(refreshed);
      } else {
        // リフレッシュ失敗でも古いトークンを試す
        validTokens.push(token.access_token);
      }
    } else {
      validTokens.push(token.access_token);
    }
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
 * GBP APIを呼び出す（401時にトークンリフレッシュして自動リトライ）
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

      if (res.status === 401 || res.status === 403) {
        // このトークンは無効 → 次のトークンを試す
        continue;
      }

      const data = res.ok ? await res.json().catch(() => ({})) : await res.text().catch(() => "");
      return { ok: res.ok, status: res.status, data };
    } catch (e: any) {
      console.error(`[gbp-token] API call error: ${e?.message}`);
    }
  }

  return { ok: false, status: 401, data: { error: "全トークンが無効" } };
}
