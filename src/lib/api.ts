import axios from "axios";
import { supabase } from "./supabase";

const api = axios.create({
  baseURL: "",  // Next.js rewrites proxy to Go API
  timeout: 10000, // 10秒タイムアウト
  headers: {
    "Content-Type": "application/json",
  },
});

// リクエスト時にSupabaseのトークンを自動付与
api.interceptors.request.use(async (config) => {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  } catch {
    // セッション取得に失敗してもリクエストは続行
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
