import axios from "axios";
import { supabase } from "./supabase";

const api = axios.create({
  baseURL: "",  // Next.js rewrites proxy to Go API
  timeout: 10000, // 10秒タイムアウト
  headers: {
    "Content-Type": "application/json",
  },
});

// トークンキャッシュ（getSession()の呼びすぎ防止）
let cachedToken: string | null = null;
let tokenExpiresAt = 0;

// Supabase認証状態変更時にキャッシュ更新
supabase.auth.onAuthStateChange((_event, session) => {
  cachedToken = session?.access_token || null;
  tokenExpiresAt = session?.expires_at ? session.expires_at * 1000 : 0;
});

async function getToken(): Promise<string | null> {
  // キャッシュが有効なら即返す（期限の60秒前までOK）
  if (cachedToken && Date.now() < tokenExpiresAt - 60000) {
    return cachedToken;
  }
  try {
    // まずセッション取得を試み、期限切れならリフレッシュ
    const { data } = await supabase.auth.getSession();
    const session = data?.session;
    if (session && session.expires_at && session.expires_at * 1000 > Date.now() + 60000) {
      cachedToken = session.access_token;
      tokenExpiresAt = session.expires_at * 1000;
      return cachedToken;
    }
    // セッション期限切れ or 期限切れ間近 → リフレッシュ
    const { data: refreshed } = await supabase.auth.refreshSession();
    if (refreshed?.session) {
      cachedToken = refreshed.session.access_token;
      tokenExpiresAt = refreshed.session.expires_at ? refreshed.session.expires_at * 1000 : 0;
      return cachedToken;
    }
    return cachedToken;
  } catch {
    return cachedToken;
  }
}

// リクエスト時にSupabaseのトークンを自動付与
api.interceptors.request.use(async (config) => {
  const token = await getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// レスポンスのエラーハンドリング
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.code === "ECONNABORTED") {
      error.userMessage = "サーバーへの接続がタイムアウトしました";
    } else if (error.code === "ERR_NETWORK" || !error.response) {
      error.userMessage = "APIサーバーに接続できません";
    } else if (error.response?.status === 401) {
      error.userMessage = "認証が切れました。再ログインしてください";
    } else if (error.response?.status === 403) {
      error.userMessage = "この操作を行う権限がありません";
    } else if (error.response?.status === 404) {
      error.userMessage = "データが見つかりません";
    } else if (error.response?.status >= 500) {
      error.userMessage = "サーバーエラーが発生しました";
    }
    return Promise.reject(error);
  }
);

export default api;
