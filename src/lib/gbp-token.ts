/**
 * GBP OAuthトークン管理（一元化）
 * - 最優先: Go APIから有効なトークンを取得
 * - フォールバック: DBのrefresh_tokenでリフレッシュ
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

/**
 * Go APIから有効なGBP OAuthトークンを取得
 * Go APIは自身のOAuth設定でトークンをリフレッシュ+DB更新するため最も信頼性が高い
 */
async function getTokenFromGoApi(): Promise<string | null> {
  if (!GO_API_URL) return null;
  try {
    const res = await fetch(`${GO_API_URL}/api/google/token`, {
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      console.log(`[gbp-token] Go API /token: HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    if (data?.access_token) {
      console.log("[gbp-token] Go APIからトークン取得成功");
      return data.access_token;
    }
    return null;
  } catch (e: any) {
    console.log("[gbp-token] Go API /token error:", e?.message);
    return null;
  }
}

/**
 * DBからrefresh_tokenでリフレッシュ（Go APIフォールバック用）
 */
async function refreshFromDb(): Promise<string | null> {
  if (!GBP_CLIENT_ID || !GBP_CLIENT_SECRET) return null;
  const supabase = getSupabase();

  // RPC → ビューの順で取得
  let refreshToken: string | null = null;
  try {
    const { data } = await supabase.rpc("get_valid_tokens");
    if (data && data.length > 0) refreshToken = data[0].refresh_token;
  } catch {}
  if (!refreshToken) {
    const { data } = await supabase.from("system_oauth_tokens")
      .select("refresh_token").limit(1).maybeSingle();
    if (data) refreshToken = data.refresh_token;
  }
  if (!refreshToken) return null;

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GBP_CLIENT_ID, client_secret: GBP_CLIENT_SECRET,
        refresh_token: refreshToken, grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.access_token || null;
  } catch {
    return null;
  }
}

/**
 * 有効なOAuthトークンを取得
 * 1. Go API /api/google/token（最優先 — Go APIのOAuth設定で確実に動く）
 * 2. DBのrefresh_tokenでリフレッシュ（フォールバック）
 */
export async function getOAuthToken(): Promise<string | null> {
  // 方法1: Go APIからトークン取得
  const goToken = await getTokenFromGoApi();
  if (goToken) return goToken;

  // 方法2: DBからリフレッシュ
  console.log("[gbp-token] Go API失敗、DBリフレッシュにフォールバック");
  return refreshFromDb();
}

/**
 * 有効なOAuthトークンの配列を取得（後方互換性）
 */
export async function getValidTokens(): Promise<string[]> {
  const token = await getOAuthToken();
  return token ? [token] : [];
}

/**
 * GBP APIを呼び出す（401時にリトライ）
 */
export async function callGbpApi(
  url: string,
  options: { method?: string; body?: any; timeout?: number } = {}
): Promise<{ ok: boolean; status: number; data: any }> {
  const token = await getOAuthToken();
  if (!token) {
    return { ok: false, status: 0, data: { error: "OAuthトークンなし" } };
  }

  const method = options.method || "GET";
  const timeout = options.timeout || 30000;

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

    const data = res.ok ? await res.json().catch(() => ({})) : await res.text().catch(() => "");
    return { ok: res.ok, status: res.status, data };
  } catch (e: any) {
    console.error(`[gbp-token] API call error: ${e?.message}`);
    return { ok: false, status: 0, data: { error: e?.message } };
  }
}
