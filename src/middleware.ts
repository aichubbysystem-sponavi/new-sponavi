import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// レポートサブドメインのホスト名パターン
const REPORT_HOSTNAME = "report.new-spotlight-navigator.com";
const MAIN_HOSTNAME = "new-spotlight-navigator.com";

export function middleware(request: NextRequest) {
  const hostname = request.headers.get("host") || "";
  const { pathname } = request.nextUrl;
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

  return response;
}

export const config = {
  matcher: [
    // 静的ファイル・Next.js内部・favicon を除外
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
