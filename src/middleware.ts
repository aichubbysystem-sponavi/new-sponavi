import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // === 壁5追加: リクエストID付与（フロントエンド側） ===
  const requestId = crypto.randomUUID();
  response.headers.set("X-Request-Id", requestId);

  // === 壁6追加: CSP (Content-Security-Policy) ===
  // next.config.mjs のヘッダーに加え、CSPをmiddlewareで動的に設定
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval' 'unsafe-inline'",  // Next.js dev mode requires unsafe-eval
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' https://*.supabase.co wss://*.supabase.co ${process.env.NEXT_PUBLIC_API_URL || "http://localhost:5555"}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");

  response.headers.set("Content-Security-Policy", csp);

  // === セキュリティ: サーバー情報の隠蔽 ===
  response.headers.set("X-Powered-By", "");
  response.headers.delete("X-Powered-By");

  return response;
}

export const config = {
  matcher: [
    // 静的ファイル・Next.js内部・favicon を除外
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
