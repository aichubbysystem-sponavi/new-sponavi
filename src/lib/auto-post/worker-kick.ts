/**
 * バックグラウンドワーカーの起動（server-only）
 *
 * Next.js 14 には after()/waitUntil が無いため、自分自身のcronルートへ短いタイムアウト付きで
 * fetch する。呼び出し側は2.5秒で切るが、Vercel の関数は呼び出し元が切断しても maxDuration まで
 * 走り続ける（2026-09-04 の「ブラウザが180秒で切れてもサーバーは処理を続けた」挙動そのもの）。
 * 万一起動に失敗しても、毎分の cron（vercel.json）が queued / 期限切れ running を拾うので取りこぼさない。
 */

/** 受信リクエストから、自分自身へ到達できる公開オリジンを求める */
export function selfOrigin(request: Request): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const proto = request.headers.get("x-forwarded-proto") || "https";
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (host) return `${proto}://${host}`;
  return new URL(request.url).origin;
}

/** cron ルートを1回叩く（完了は待たない）。失敗しても例外にしない */
export async function kickCron(request: Request, path: "/api/cron/auto-post-worker" | "/api/cron/execute-posts"): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret) { console.warn("[auto-post] CRON_SECRET 未設定のためワーカーを起動できません（毎分のcron待ち）"); return; }
  const url = `${selfOrigin(request)}${path}`;
  try {
    await fetch(url, {
      headers: { authorization: `Bearer ${secret}` },
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
  } catch (e: any) {
    // TimeoutError は想定内（相手は走り続ける）。それ以外も cron が拾うので警告に留める
    if (e?.name !== "TimeoutError" && e?.name !== "AbortError") console.warn(`[auto-post] kick ${path} 失敗:`, e?.message);
  }
}
