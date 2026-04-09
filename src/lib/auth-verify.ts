import { jwtVerify } from "jose";

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

/**
 * Supabase JWTトークンを検証
 * API routeで使用（サーバーサイド専用）
 */
export async function verifyAuth(authHeader: string | null): Promise<{ valid: boolean; sub?: string }> {
  if (!authHeader?.startsWith("Bearer ")) return { valid: false };

  const jwt = authHeader.replace("Bearer ", "");

  try {
    const secret = new TextEncoder().encode(SUPABASE_JWT_SECRET);
    const { payload } = await jwtVerify(jwt, secret);
    return { valid: true, sub: payload.sub as string };
  } catch {
    return { valid: false };
  }
}
