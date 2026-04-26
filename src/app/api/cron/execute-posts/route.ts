import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/execute-posts
 * 予約投稿の自動実行（毎時5分）
 * → /api/report/scheduled-posts PUT を内部呼び出し（「今すぐ実行」と完全に同じコードパス）
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://new-spotlight-navigator.com";

  try {
    // scheduled-posts PUTを内部呼び出し（force=falseで時刻到達分のみ実行）
    const res = await fetch(`${baseUrl}/api/report/scheduled-posts`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        // Cron用: scheduled-posts PUTはauth不要（内部呼び出し対応済み）
        "x-cron-secret": cronSecret,
      },
      body: JSON.stringify({ force: false }),
      signal: AbortSignal.timeout(280000), // maxDurationの少し手前
    });

    const data = await res.json().catch(() => ({}));
    console.log(`[cron/execute-posts] Result:`, data);
    return NextResponse.json({ success: true, ...data });
  } catch (e: any) {
    console.error(`[cron/execute-posts] Error:`, e?.message);
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
