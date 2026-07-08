import { NextResponse } from "next/server";
import type { NextFetchEvent, NextRequest } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { can, matchGoProxyRule, isAppRole } from "@/lib/permissions";
import type { AppRole, ActionType } from "@/lib/permissions";

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

// === Goプロキシ経路のロールガード ===
// next.config.mjs の rewrites で Go API へ転送されるパス（/api/shop 等）は
// Next.js のルートハンドラを通らないため、変更系メソッドの認可をここで行う。
// PROXY_GUARD_MODE: "enforce"=拒否する / "log"=記録のみ（既定） / "off"=無効
const PROXY_GUARD_MODE = process.env.PROXY_GUARD_MODE || "log";

// ロールの短期キャッシュ（edge環境のモジュールスコープ。TTL 60秒）
const roleCache = new Map<string, { role: AppRole; name: string; expiresAt: number }>();

/** JWTのペイロードからsubを取り出す（署名検証はPostgREST側で行われるためここでは無検証デコード） */
function decodeJwtSub(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof json?.sub === "string" ? json.sub : null;
  } catch {
    return null;
  }
}

/**
 * ユーザーJWTでPostgRESTからrole/nameを取得する。
 * PostgRESTがJWTの署名・期限を検証するため、不正トークンはここで空になる。
 */
async function fetchUserRole(token: string, sub: string): Promise<{ role: AppRole; name: string } | null> {
  const cached = roleCache.get(sub);
  if (cached && cached.expiresAt > Date.now()) return { role: cached.role, name: cached.name };

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  if (!supabaseUrl || !anonKey) return null;

  const headers = { apikey: anonKey, Authorization: `Bearer ${token}` };
  for (const col of ["auth_uid", "id"]) {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/user_profiles?${col}=eq.${encodeURIComponent(sub)}&select=role,name&limit=1`,
      { headers, cache: "no-store" },
    );
    if (!res.ok) return null; // 401=トークン不正 / その他=PostgREST障害
    const rows = (await res.json().catch(() => [])) as { role?: string; name?: string }[];
    const row = rows?.[0];
    if (row?.role && isAppRole(row.role)) {
      const result = { role: row.role, name: row.name || "不明" };
      roleCache.set(sub, { ...result, expiresAt: Date.now() + 60_000 });
      return result;
    }
  }
  return null;
}

/** Goプロキシ経由の変更操作を audit_logs に記録（service_role・fire-and-forget） */
function auditProxyOp(entry: {
  sub: string; role: string; name: string;
  action: ActionType; method: string; path: string; ip: string; allowed: boolean;
}): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!supabaseUrl || !serviceKey) return Promise.resolve();
  return fetch(`${supabaseUrl}/rest/v1/audit_logs`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      id: crypto.randomUUID(),
      user_name: entry.name,
      user_id: entry.sub,
      role: entry.role,
      action: "外部API操作（Goプロキシ）",
      action_type: entry.action,
      detail: entry.allowed ? "" : `権限不足のため${PROXY_GUARD_MODE === "enforce" ? "拒否" : "検出（logモード・通過）"}`,
      method: entry.method,
      path: entry.path,
      ip: entry.ip,
      status: entry.allowed ? null : 403,
      source: "middleware",
    }),
  }).then(() => undefined).catch(() => undefined);
}

export async function middleware(request: NextRequest, event: NextFetchEvent) {
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

  // === 登録申請（未認証エンドポイント）の濫用防止 ===
  // PUT /api/report/users は認証不要でユーザーを作成するため、厳しめのレート制限
  if (pathname === "/api/report/users" && request.method === "PUT") {
    if (loginRateLimit) {
      const { success } = await loginRateLimit.limit(`register:${ip}`);
      if (!success) {
        return NextResponse.json({ error: "登録申請の回数が上限に達しました。しばらく待ってからお試しください。" }, { status: 429 });
      }
    } else {
      if (!checkFallbackLimit(`register:${ip}`, 10, 5 * 60_000)) {
        return NextResponse.json({ error: "登録申請の回数が上限に達しました。しばらく待ってからお試しください。" }, { status: 429 });
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

  // === Goプロキシ経路のロールガード（変更系メソッドのみ） ===
  if (
    PROXY_GUARD_MODE !== "off" &&
    ["POST", "PUT", "DELETE", "PATCH"].includes(method) &&
    pathname.startsWith("/api/")
  ) {
    const rule = matchGoProxyRule(pathname);
    if (rule) {
      const authHeader = request.headers.get("authorization") || "";
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
      const sub = token ? decodeJwtSub(token) : null;
      if (!sub) {
        if (PROXY_GUARD_MODE === "enforce") {
          return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
        }
      } else {
        let profile: { role: AppRole; name: string } | null = null;
        let fetchFailed = false;
        try {
          profile = await fetchUserRole(token, sub);
        } catch {
          fetchFailed = true;
        }
        if (fetchFailed || !profile) {
          // PostgREST障害 or トークン不正 or プロフィール無し
          if (PROXY_GUARD_MODE === "enforce") {
            return NextResponse.json(
              { error: fetchFailed ? "認可サービスに接続できません" : "この操作を行う権限がありません" },
              { status: fetchFailed ? 503 : 403 },
            );
          }
        } else {
          const allowed = can(profile.role, rule.action);
          // 監査記録（レスポンスをブロックしない）
          event.waitUntil(auditProxyOp({
            sub, role: profile.role, name: profile.name,
            action: rule.action, method, path: pathname, ip, allowed,
          }));
          if (!allowed && PROXY_GUARD_MODE === "enforce") {
            return NextResponse.json({ error: "この操作を行う権限がありません" }, { status: 403 });
          }
        }
      }
    }
  }

  const isReportSubdomain = hostname === REPORT_HOSTNAME || hostname.startsWith("report.localhost");
  const isPmaxSubdomain = hostname === PMAX_HOSTNAME || hostname.startsWith("p-max.localhost");

  // === サブドメイン認証 ===
  // Supabase AuthはlocalStorageベースのためミドルウェアでは検証不可
  // 認証はAuthGuard（クライアントサイド）で保護済み（app-shell.tsx）

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

  // メインドメインで /pmax, /report にアクセス → そのまま表示（セッション共有のため）
  // サブドメイン（report.*, p-max.*）からの直接アクセスはリライトで処理済み

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
    `connect-src 'self' ${supabaseUrl} ${supabaseWs} https://api.anthropic.com ${apiUrl} https://maps.googleapis.com https://maps.gstatic.com https://*.ingest.us.sentry.io`,
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
