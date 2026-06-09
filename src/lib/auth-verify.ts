import { jwtVerify } from "jose";

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || "";

/**
 * Supabase JWTトークンを検証（署名検証必須）
 */
export async function verifyAuth(authHeader: string | null): Promise<{ valid: boolean; sub?: string }> {
  if (!authHeader?.startsWith("Bearer ")) return { valid: false };

  const jwt = authHeader.replace("Bearer ", "");

  // JWTシークレットが未設定の場合は認証拒否（本番で必ず設定すること）
  if (!JWT_SECRET) {
    console.error("[auth] SUPABASE_JWT_SECRET is not set — all requests will be rejected");
    return { valid: false };
  }

  try {
    // HS256署名を検証（署名が正しくなければ例外がスローされる）
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jwtVerify(jwt, secret, {
      algorithms: ["HS256"],
    });

    // jwtVerifyは有効期限も自動チェックするが、念のため明示チェック
    if (payload.exp && payload.exp < Date.now() / 1000) {
      return { valid: false };
    }

    return { valid: true, sub: payload.sub as string };
  } catch {
    // 署名検証失敗 = 不正なトークン → 拒否
    return { valid: false };
  }
}
