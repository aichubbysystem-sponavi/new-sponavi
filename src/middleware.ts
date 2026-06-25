import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// レポートサブドメインのホスト名パターン
const REPORT_HOSTNAME = "report.new-spotlight-navigator.com";
const PMAX_HOSTNAME = "p-max.new-spotlight-navigator.com";
const MAIN_HOSTNAME = "new-spotlight-navigator.com";

// === レート制限（Upstash Redis） ===
const REDIS_URL = process.env.UPSTASH_REDIS_REST_KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const redis = REDIS_URL
  ? new Redis({ url: REDIS_URL, token: REDIS_TOKEN })
  : null;

// API全体: 1分あたり500リクエスト
const apiRateLimit = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(500, "1 m"), prefix: "rl:api" })
  : null;

// ログイン: 5分間で10回まで
const loginRateLimit = redis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "5 m"), prefix: "rl:login" })
  : null;

// インメモリフォールバック（Redis未設定時の開発環境用）
const fallbackMap = new Map<string, { count: number; resetAt: number }>();
function checkFallbackLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = fallbackMap.get(key);
  if (!entry || now > entry.resetAt) {
    fallbackMap.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  entry.count++;
  return entry.count <= limit;
}

// 許可されたオリジン
const ALLOWED_ORIGINS = [
  `https://${MAIN_HOSTNAME}`,
  `https://www.${MAIN_HOSTNAME}`,
  `https://${REPORT_HOSTNAME}`,
  `https://${PMAX_HOSTNAME}`,
  "https://new-sponavi.vercel.app",
  ...(process.env.NODE_ENV === "development" ? ["http://localhost:3000", "http://localhost:3001"] : []),
];

export async function middleware(request: NextRequest) {
  const hostname = request.headers.get("host") || "";
  const { pathname } = request.nextUrl;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";

  // === APIレート制限（/api/* パス） ===
  if (pathname.startsWith("/api/")) {
    if (apiRateLimit) {
      const { success } = await apiRateLimit.limit(ip);
      if (!success) {
        return NextResponse.json({ error: "リクエストが多すぎます。しばらく待ってからお試しください。" }, { status: 429 });
      }
    } else {
      if (!checkFallbackLimit(`api:${ip}`, 500, 60_000)) {
        return NextResponse.json({ error: "リクエストが多すぎます。しばらく待ってからお試しください。" }, { status: 429 });
      }
    }
  }

  // === ログインブルートフォース防止 ===
  if (pathname === "/login" && request.method === "POST") {
    if (loginRateLimit) {
      const { success } = await loginRateLimit.limit(ip);
      if (!success) {
        return NextResponse.json({ error: "ログイン試行回数が上限に達しました。5分後にお試しください。" }, { status: 429 });
      }
    } else {
      if (!checkFallbackLimit(`login:${ip}`, 10, 5 * 60_000)) {
        return NextResponse.json({ error: "ログイン試行回数が上限に達しました。5分後にお試しください。" }, { status: 429 });
      }
    }
  }

  // === CSRF対策（状態変更リクエストのOriginチェック） ===
  const method = request.method;
  if (pathname.startsWith("/api/") && ["POST", "PUT", "DELETE", "PATCH"].includes(method)) {
    // Cron/Webhook は Origin なしで呼ばれるため除外
    const isCron = pathname.startsWith("/api/cron/");
    const isWebhook = pathname.startsWith("/api/webhook/");
    if (!isCron && !isWebhook) {
      const origin = request.headers.get("origin");
      if (origin) {
        // Originヘッダーがある場合、許可リストに含まれるか確認
        if (!ALLOWED_ORIGINS.includes(origin)) {
          return NextResponse.json({ error: "不正なリクエスト元です" }, { status: 403 });
        }
      } else {
        // Originなし: Refererで検証（HTMLフォームCSRF防止）
        const referer = request.headers.get("referer");
        if (referer) {
          try {
            const refOrigin = new URL(referer).origin;
            if (!ALLOWED_ORIGINS.includes(refOrigin)) {
              return NextResponse.json({ error: "不正なリクエスト元です" }, { status: 403 });
            }
          } catch {
            return NextResponse.json({ error: "不正なリクエスト元です" }, { status: 403 });
          }
        }
        // Origin・Referer両方なし: CSRF攻撃防止のためAuthorizationヘッダー必須
        const hasAuth = request.headers.has("authorization");
        if (!hasAuth) {
          return NextResponse.json({ error: "不正なリクエスト元です" }, { status: 403 });
        }
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

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
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

  // セキュリティヘッダー
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  response.headers.set("X-Powered-By", "");
  response.headers.delete("X-Powered-By");

  // === CORS制限 ===
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
