import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// レポートサブドメインのホスト名パターン
const REPORT_HOSTNAME = "report.new-spotlight-navigator.com";
const MAIN_HOSTNAME = "new-spotlight-navigator.com";

// === 壁10: APIレート制限 ===
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 60; // 1分あたり60リクエスト
const RATE_WINDOW = 60 * 1000; // 1分

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT;
}

// === 壁11: ログインブルートフォース防止 ===
const loginAttemptMap = new Map<string, { count: number; blockedUntil: number }>();
const MAX_LOGIN_ATTEMPTS = 10; // 10回まで
const LOGIN_BLOCK_DURATION = 5 * 60 * 1000; // 5分ブロック

function checkLoginAttempt(ip: string): boolean {
  const now = Date.now();
  const entry = loginAttemptMap.get(ip);
  if (!entry) {
    loginAttemptMap.set(ip, { count: 1, blockedUntil: 0 });
    return true;
  }
  if (now < entry.blockedUntil) return false;
  if (entry.count >= MAX_LOGIN_ATTEMPTS) {
    entry.blockedUntil = now + LOGIN_BLOCK_DURATION;
    entry.count = 0;
    return false;
  }
  entry.count++;
  return true;
}

// 許可されたオリジン
const ALLOWED_ORIGINS = [
  `https://${MAIN_HOSTNAME}`,
  `https://www.${MAIN_HOSTNAME}`,
  `https://${REPORT_HOSTNAME}`,
  "https://new-sponavi.vercel.app",
  "http://localhost:3000",
  "http://localhost:3001",
];

export function middleware(request: NextRequest) {
  const hostname = request.headers.get("host") || "";
  const { pathname } = request.nextUrl;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";

  // === 壁10: APIレート制限（/api/* パス） ===
  if (pathname.startsWith("/api/")) {
    if (!checkRateLimit(ip)) {
      return NextResponse.json({ error: "リクエストが多すぎます。しばらく待ってからお試しください。" }, { status: 429 });
    }
  }

  // === 壁11: ログインブルートフォース防止 ===
  if (pathname === "/login" && request.method === "POST") {
    if (!checkLoginAttempt(ip)) {
      return NextResponse.json({ error: "ログイン試行回数が上限に達しました。5分後にお試しください。" }, { status: 429 });
    }
  }
  const isReportSubdomain = hostname === REPORT_HOSTNAME || hostname.startsWith("report.localhost");

  // === サブドメインルーティング ===

  // report.* サブドメイン → /report/* にリライト
  if (isReportSubdomain) {
    if (pathname === "/") {
      // report.xxx.com/ → /report ページへリライト
      const url = request.nextUrl.clone();
      url.pathname = "/report";
      return addHeaders(NextResponse.rewrite(url), request, true);
    }
    if (!pathname.startsWith("/report") && !pathname.startsWith("/_next") && !pathname.startsWith("/api") && pathname !== "/favicon.ico") {
      // report.xxx.com/shopId → /report/shopId へリライト
      const url = request.nextUrl.clone();
      url.pathname = `/report${pathname}`;
      return addHeaders(NextResponse.rewrite(url), request, true);
    }
    // report.xxx.com/report/... はそのまま通す
    return addHeaders(NextResponse.next(), request, true);
  }

  // メインドメインで /report にアクセス → サブドメインへリダイレクト（本番のみ）
  // 注意: /reports 等の別ページはリダイレクトしない
  if ((pathname === "/report" || pathname.startsWith("/report/")) && (hostname === MAIN_HOSTNAME || hostname === `www.${MAIN_HOSTNAME}`)) {
    const reportPath = pathname.replace(/^\/report/, "") || "/";
    const url = new URL(`https://${REPORT_HOSTNAME}${reportPath}`);
    url.search = request.nextUrl.search;
    return NextResponse.redirect(url, 301);
  }

  // === 通常リクエスト ===
  return addHeaders(NextResponse.next(), request, false);
}

function addHeaders(response: NextResponse, request: NextRequest, isReport: boolean): NextResponse {
  // リクエストID付与
  response.headers.set("X-Request-Id", crypto.randomUUID());

  // CSP
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5555";
  const fontSrc = isReport
    ? "font-src 'self' data: https://fonts.gstatic.com"
    : "font-src 'self' data:";
  const styleSrc = isReport
    ? "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com"
    : "style-src 'self' 'unsafe-inline'";

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://kxxwspavskhhjtiixcep.supabase.co";
  const supabaseWs = supabaseUrl.replace("https://", "wss://");

  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",  // unsafe-eval削除（Chart.js v4はeval不要）
    styleSrc,
    "img-src 'self' data: blob: https:",
    fontSrc,
    `connect-src 'self' ${supabaseUrl} ${supabaseWs} https://api.anthropic.com ${apiUrl}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");

  response.headers.set("Content-Security-Policy", csp);

  // サーバー情報の隠蔽
  response.headers.set("X-Powered-By", "");
  response.headers.delete("X-Powered-By");

  // === 壁12: CORS制限 ===
  const origin = request.headers.get("origin");
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH");
    response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    response.headers.set("Access-Control-Allow-Credentials", "true");
  }

  return response;
}

export const config = {
  matcher: [
    // 静的ファイル・Next.js内部・favicon を除外
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
