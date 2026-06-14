import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// レポートサブドメインのホスト名パターン
const REPORT_HOSTNAME = "report.new-spotlight-navigator.com";
const PMAX_HOSTNAME = "p-max.new-spotlight-navigator.com";
const MAIN_HOSTNAME = "new-spotlight-navigator.com";

// === 壁10: APIレート制限 ===
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 500; // 1分あたり500リクエスト
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
  `https://${PMAX_HOSTNAME}`,
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

  // === 壁13: CSRF対策（状態変更リクエストのOriginチェック） ===
  const method = request.method;
  if (pathname.startsWith("/api/") && ["POST", "PUT", "DELETE", "PATCH"].includes(method)) {
    // Cron/Webhook は Origin なしで呼ばれるため除外
    const isCron = pathname.startsWith("/api/cron/");
    const isWebhook = pathname.startsWith("/api/webhook/");
    if (!isCron && !isWebhook) {
      const origin = request.headers.get("origin");
      if (origin && !ALLOWED_ORIGINS.includes(origin)) {
        return NextResponse.json({ error: "不正なリクエスト元です" }, { status: 403 });
      }
    }
  }
  const isReportSubdomain = hostname === REPORT_HOSTNAME || hostname.startsWith("report.localhost");
  const isPmaxSubdomain = hostname === PMAX_HOSTNAME || hostname.startsWith("p-max.localhost");

  // === サブドメインルーティング ===

  // p-max.* サブドメイン → /pmax/* にリライト
  if (isPmaxSubdomain) {
    if (pathname === "/") {
      const url = request.nextUrl.clone();
      url.pathname = "/pmax";
      return addHeaders(NextResponse.rewrite(url), request, false);
    }
    if (!pathname.startsWith("/pmax") && !pathname.startsWith("/_next") && !pathname.startsWith("/api") && pathname !== "/favicon.ico" && pathname !== "/login") {
      const url = request.nextUrl.clone();
      url.pathname = `/pmax${pathname}`;
      return addHeaders(NextResponse.rewrite(url), request, false);
    }
    return addHeaders(NextResponse.next(), request, false);
  }

  // report.* サブドメイン → /report/* にリライト
  if (isReportSubdomain) {
    if (pathname === "/") {
      // report.xxx.com/ → /report ページへリライト
      const url = request.nextUrl.clone();
      url.pathname = "/report";
      return addHeaders(NextResponse.rewrite(url), request, true);
    }
    if (!pathname.startsWith("/report") && !pathname.startsWith("/_next") && !pathname.startsWith("/api") && pathname !== "/favicon.ico" && pathname !== "/login") {
      // report.xxx.com/shopId → /report/shopId へリライト
      const url = request.nextUrl.clone();
      url.pathname = `/report${pathname}`;
      return addHeaders(NextResponse.rewrite(url), request, true);
    }
    // report.xxx.com/report/... はそのまま通す
    return addHeaders(NextResponse.next(), request, true);
  }

  // メインドメインで /pmax にアクセス → サブドメインへリダイレクト（本番のみ）
  if ((pathname === "/pmax" || pathname.startsWith("/pmax/")) && (hostname === MAIN_HOSTNAME || hostname === `www.${MAIN_HOSTNAME}`)) {
    const pmaxPath = pathname.replace(/^\/pmax/, "") || "/";
    const url = new URL(`https://${PMAX_HOSTNAME}${pmaxPath}`);
    url.search = request.nextUrl.search;
    return NextResponse.redirect(url, 301);
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
  const fontSrc = "font-src 'self' data: https://fonts.gstatic.com";
  const styleSrc = "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com";

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://kxxwspavskhhjtiixcep.supabase.co";
  const supabaseWs = supabaseUrl.replace("https://", "wss://");

  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://maps.googleapis.com https://maps.gstatic.com",
    styleSrc,
    "img-src 'self' data: blob: https:",
    fontSrc,
    `connect-src 'self' ${supabaseUrl} ${supabaseWs} https://api.anthropic.com ${apiUrl} https://maps.googleapis.com https://maps.gstatic.com`,
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
