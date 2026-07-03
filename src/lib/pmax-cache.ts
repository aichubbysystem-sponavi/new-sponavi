import { getSupabase } from "@/lib/supabase";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6時間

/**
 * P-MAXキャッシュ取得（TTL以内なら返す）
 * getSupabaseの設定修正により .eq() は正常動作する。全件取得は
 * PostgRESTの1000行上限でキャッシュミスを招くため使用しない。
 */
export async function getPmaxCache<T>(key: string): Promise<T | null> {
  try {
    const sb = getSupabase();
    const { data: match } = await sb
      .from("pmax_cache")
      .select("data, updated_at")
      .eq("cache_key", key)
      .maybeSingle();

    if (!match) return null;

    const age = Date.now() - new Date(match.updated_at).getTime();
    if (age > CACHE_TTL_MS) return null;

    return match.data as T;
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
