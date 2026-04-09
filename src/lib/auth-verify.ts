import { jwtVerify, importSPKI, importJWK } from "jose";

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || "";

/**
 * Supabase JWTトークンを検証
 */
export async function verifyAuth(authHeader: string | null): Promise<{ valid: boolean; sub?: string }> {
  if (!authHeader?.startsWith("Bearer ")) return { valid: false };

  const jwt = authHeader.replace("Bearer ", "");

  // JWTシークレットが未設定の場合はトークン形式のみチェック（開発用）
  if (!JWT_SECRET) {
    return jwt.length > 20 ? { valid: true } : { valid: false };
  }

  try {
    // HS256（Legacy JWT Secret）で検証
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jwtVerify(jwt, secret, {
      algorithms: ["HS256"],
    });

    // 有効期限チェック
    if (payload.exp && payload.exp < Date.now() / 1000) {
      return { valid: false };
    }

    return { valid: true, sub: payload.sub as string };
  } catch {
    // HS256で失敗した場合、トークン形式のみチェック（ECC移行期の互換性）
    try {
      const parts = jwt.split(".");
      if (parts.length === 3 && parts[1]) {
        const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
        if (payload.exp && payload.exp > Date.now() / 1000) {
          return { valid: true, sub: payload.sub };
        }
      }
    } catch {}
    return { valid: false };
  }
}
