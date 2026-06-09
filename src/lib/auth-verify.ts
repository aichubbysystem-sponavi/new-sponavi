import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

/**
 * Supabase JWTトークンを検証（Supabase Auth APIで署名検証）
 * HS256/ECC両方のJWTに対応。トークン偽造は不可能。
 */
export async function verifyAuth(authHeader: string | null): Promise<{ valid: boolean; sub?: string }> {
  if (!authHeader?.startsWith("Bearer ")) return { valid: false };

  const token = authHeader.replace("Bearer ", "");

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error("[auth] Supabase URL or Anon Key is not set");
    return { valid: false };
  }

  try {
    // Supabase Auth APIでトークンを検証（署名・有効期限を自動チェック）
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      return { valid: false };
    }

    return { valid: true, sub: data.user.id };
  } catch {
    return { valid: false };
  }
}
