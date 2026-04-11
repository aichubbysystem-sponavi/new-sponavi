import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/sync-reviews
 * Vercel Cron Jobから毎日1回呼ばれる口コミ自動同期エンドポイント
 * CRON_SECRET環境変数で認証
 */
export async function GET(request: NextRequest) {
  // Vercel Cronの認証
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 内部のsync-reviews APIを呼び出す
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";

  try {
    const res = await fetch(`${baseUrl}/api/report/sync-reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shopIds: [], cronJob: true }),
    });

    const data = await res.json();
    console.log("[cron/sync-reviews] result:", data);

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      ...data,
    });
  } catch (e: any) {
    console.error("[cron/sync-reviews] error:", e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
