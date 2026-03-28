import axios from "axios";
import { supabase } from "./supabase";

const api = axios.create({
  baseURL: "",  // Next.js rewrites proxy to Go API
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

export default api;
