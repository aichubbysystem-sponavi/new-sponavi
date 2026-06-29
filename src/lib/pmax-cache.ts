import { getSupabase } from "@/lib/supabase";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6時間

/**
 * P-MAXキャッシュ取得（TTL以内なら返す）
 */
export async function getPmaxCache<T>(key: string): Promise<T | null> {
  try {
    const sb = getSupabase();
    const { data } = await sb
      .from("pmax_cache")
      .select("data, updated_at")
      .eq("cache_key", key)
      .maybeSingle();

    if (!data) return null;

    const age = Date.now() - new Date(data.updated_at).getTime();
    if (age > CACHE_TTL_MS) return null;

    return data.data as T;
  } catch {
    return null;
  }
}

/**
 * P-MAXキャッシュ保存
 */
export async function setPmaxCache(key: string, value: unknown): Promise<void> {
  try {
    const sb = getSupabase();
    await sb.from("pmax_cache").upsert(
      { cache_key: key, data: value, updated_at: new Date().toISOString() },
      { onConflict: "cache_key" }
    );
  } catch (e) {
    console.error("[pmax-cache] save error:", e);
  }
}
