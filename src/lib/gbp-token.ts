/**
 * GBP OAuthトークン管理（一元化）
 * - 最優先: Go APIから有効なトークンを取得
 * - フォールバック: DBのrefresh_tokenでリフレッシュ
 */

import { getSupabase } from "@/lib/supabase";

const GO_API_URL = process.env.NEXT_PUBLIC_API_URL || "";
const GBP_CLIENT_ID = process.env.GBP_CLIENT_ID || "";
const GBP_CLIENT_SECRET = process.env.GBP_CLIENT_SECRET || "";

/**
 * Go APIから有効なGBP OAuthトークンを取得
 * Go APIは自身のOAuth設定でトークンをリフレッシュ+DB更新するため最も信頼性が高い
 */
async function getTokenFromGoApi(): Promise<string | null> {
  if (!GO_API_URL) return null;
  try {
    // cache:"no-store" 必須。Next.js 14 のサーバーfetchは既定でレスポンスをキャッシュするため、
    // これが無いと期限切れのアクセストークンが返り続けGBP APIが全て401になる
    const res = await fetch(`${GO_API_URL}/api/google/token`, {
      signal: AbortSignal.timeout(20000),
      cache: "no-store",
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
  } catch (e: unknown) {
    console.error("[gbp-token] RPC get_valid_tokens failed:", e instanceof Error ? e.message : e);
  }
  if (!refreshToken) {
    const { data } = await supabase.from("system_oauth_tokens")
      .select("refresh_token").limit(1).maybeSingle();
    if (data) refreshToken = data.refresh_token;
  }
  if (!refreshToken) return null;

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      cache: "no-store" as const,
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
  } catch (e: unknown) {
    console.error("[gbp-token] DB refresh failed:", e instanceof Error ? e.message : e);
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
 * 全ソースから有効なOAuthトークンを収集（複数トークンが必要な場合用）
 * system_oauth_tokens + system.tokens(RPC) の両方から取得し、期限切れはリフレッシュ
 */
export async function getAllOAuthTokens(): Promise<string[]> {
  const supabase = getSupabase();
  const tokenSet = new Set<string>();

  // Go APIトークンも追加
  const goToken = await getTokenFromGoApi();
  if (goToken) tokenSet.add(goToken);

  // system_oauth_tokens から取得
  const { data: oauthTokens } = await supabase.from("system_oauth_tokens")
    .select("access_token, refresh_token, expiry");
  if (oauthTokens) {
    for (const row of oauthTokens) {
      if (new Date(row.expiry).getTime() - Date.now() > 5 * 60 * 1000) {
        tokenSet.add(row.access_token);
      } else if (row.refresh_token && GBP_CLIENT_ID && GBP_CLIENT_SECRET) {
        try {
          const res = await fetch("https://oauth2.googleapis.com/token", {
            cache: "no-store" as const,
            method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ client_id: GBP_CLIENT_ID, client_secret: GBP_CLIENT_SECRET,
              refresh_token: row.refresh_token, grant_type: "refresh_token" }),
            signal: AbortSignal.timeout(10000),
          });
          if (res.ok) {
            const t = await res.json();
            if (t.access_token) {
              tokenSet.add(t.access_token);
              // 注意: system_oauth_tokens はJOIN+LIMIT付きVIEWのため自動更新不可の可能性が高い。
              // 失敗しても動作は継続する（毎回リフレッシュになるだけ）が、無音では握りつぶさない。
              const { error: updErr } = await supabase.from("system_oauth_tokens").update({
                access_token: t.access_token,
                expiry: new Date(Date.now() + (t.expires_in || 3600) * 1000).toISOString(),
              }).eq("refresh_token", row.refresh_token);
              if (updErr) console.error("[gbp-token] トークン書き戻し失敗（VIEWは更新不可）:", updErr.message);
            }
          }
        } catch (e: any) { console.error("[gbp-token] oauth refresh:", e?.message); }
      }
    }
  }

  // system.tokens（Go API用、RPC経由）
  try {
    const { data: sysTokens } = await supabase.rpc("get_valid_tokens");
    if (sysTokens) {
      for (const row of sysTokens) {
        if (row.refresh_token && GBP_CLIENT_ID && GBP_CLIENT_SECRET) {
          try {
            const res = await fetch("https://oauth2.googleapis.com/token", {
              cache: "no-store" as const,
              method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({ client_id: GBP_CLIENT_ID, client_secret: GBP_CLIENT_SECRET,
                refresh_token: row.refresh_token, grant_type: "refresh_token" }),
              signal: AbortSignal.timeout(10000),
            });
            if (res.ok) {
              const t = await res.json();
              if (t.access_token) tokenSet.add(t.access_token);
            }
          } catch (e: any) { console.error("[gbp-token] system token refresh:", e?.message); }
        } else if (row.access_token) {
          tokenSet.add(row.access_token);
        }
      }
    }
  } catch (e: any) {
    console.log(`[gbp-token] get_valid_tokens RPC失敗: ${e?.message}`);
  }

  return Array.from(tokenSet);
}

// ============================================================
// トークンフォールバック支援
// GBPアカウントは本番15個。1本のトークンでは見えないロケーションがあり、
// v4 APIは権限が無い場合も404を返す（重要ナレッジ 2026-08-15）。
// 401/403/404 のときは他アカウントのトークンで順に再試行すること。
// ============================================================

export const TOKEN_RETRY_STATUSES = [401, 403, 404];

let fallbackTokensCache: { tokens: string[]; at: number } | null = null;
const FALLBACK_TOKENS_TTL = 5 * 60 * 1000;

/**
 * getAllOAuthTokens のキャッシュ付き版（5分TTL）
 * 全アカウントのリフレッシュは重いため、店舗ごと・リクエストごとに叩かない
 */
export async function getFallbackTokens(): Promise<string[]> {
  if (fallbackTokensCache && Date.now() - fallbackTokensCache.at < FALLBACK_TOKENS_TTL) {
    return fallbackTokensCache.tokens;
  }
  const tokens = await getAllOAuthTokens();
  if (tokens.length > 0) fallbackTokensCache = { tokens, at: Date.now() };
  return tokens;
}

/**
 * accounts/xxx → 最後に成功したトークン
 * 同一アカウント配下の店舗で毎回全トークンを試し直すのを防ぐ
 * （トークンが失効していても呼び出し側のフォールバックで自己修復する）
 */
const accountTokenCache = new Map<string, string>();

export function getAccountToken(fullPath: string): string | undefined {
  const acc = fullPath.match(/^accounts\/[^/]+/)?.[0];
  return acc ? accountTokenCache.get(acc) : undefined;
}

export function setAccountToken(fullPath: string, token: string): void {
  const acc = fullPath.match(/^accounts\/[^/]+/)?.[0];
  if (acc) accountTokenCache.set(acc, token);
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
      // GETでもキャッシュしない: 口コミ・投稿の一覧が古いまま返ると
      // 「同期したのに反映されない」という再現しづらい不具合になる
      cache: "no-store",
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

// ============================================================
// トークンフォールバック付き GET（Performance API 用）
// 検索語句・パフォーマンス指標は主トークン1本で叩いていたため、
// 主トークンから見えないアカウント配下の店舗（2026-09-05時点で4アカウント349店舗）が
// 403/404 → 「0ヶ月」として無音で失敗していた。口コミ同期と同じく
// 401/403/404 のときだけ全トークンで順に再試行し、成功したトークンをキー単位で記憶する。
// ============================================================

export interface GbpFetchResult {
  ok: boolean;
  status: number;       // 0 = ネットワーク/タイムアウト
  data: any;            // ok のとき JSON
  errorText: string;    // !ok のとき本文先頭
  token: string | null; // 最終的に使ったトークン
}

/** key（locations/xxx 等）→ 最後に成功したトークン */
const keyTokenCache = new Map<string, string>();

async function gbpGetOnce(url: string, token: string, timeoutMs: number): Promise<GbpFetchResult> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) {
      return { ok: true, status: res.status, data: await res.json().catch(() => ({})), errorText: "", token };
    }
    const text = await res.text().catch(() => "");
    return { ok: false, status: res.status, data: null, errorText: text.slice(0, 300), token };
  } catch (e: any) {
    return { ok: false, status: 0, data: null, errorText: e?.message || "fetch error", token };
  }
}

/**
 * GBP API を GET し、401/403/404 なら全アカウントのトークンで順に再試行する。
 * @param key 同じロケーションの複数リクエストで成功トークンを使い回すためのキー
 */
export async function fetchGbpWithFallback(
  url: string,
  key: string,
  opts: { timeoutMs?: number; primaryToken?: string | null } = {}
): Promise<GbpFetchResult> {
  const timeoutMs = opts.timeoutMs ?? 15000;
  const primary = opts.primaryToken === undefined ? await getOAuthToken() : opts.primaryToken;
  const tried = new Set<string>();

  const attempt = async (t: string) => {
    tried.add(t);
    const r = await gbpGetOnce(url, t, timeoutMs);
    if (r.ok) keyTokenCache.set(key, t);
    return r;
  };
  const shouldRetry = (r: GbpFetchResult) => !r.ok && TOKEN_RETRY_STATUSES.includes(r.status);

  const first = keyTokenCache.get(key) || primary;
  let result: GbpFetchResult | null = null;
  if (first) {
    result = await attempt(first);
    if (!shouldRetry(result)) return result;
  }

  const fallbacks = await getFallbackTokens();
  for (const t of [primary, ...fallbacks]) {
    if (!t || tried.has(t)) continue;
    const r = await attempt(t);
    if (!shouldRetry(r)) return r;
    result = r;
  }
  if (result) return result;
  return { ok: false, status: 0, data: null, errorText: "OAuthトークンなし", token: null };
}
