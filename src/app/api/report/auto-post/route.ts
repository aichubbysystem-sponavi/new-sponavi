import { NextResponse } from "next/server";
import { withAudit } from "@/lib/audit";
import { runAutoPost } from "@/lib/auto-post/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/report/auto-post
 * スプレッドシートから自動投稿（プレビュー / 事前チェック / 予約登録 / 即時投稿）
 *
 * 処理本体は src/lib/auto-post/engine.ts（runAutoPost）。
 * 画面からの本実行は 2026-09-04 以降 /api/report/auto-post-jobs（ジョブ方式）に移行し、
 * このルートは主にプレビュー（dryRun）と互換用途で使う。
 * 1リクエストで大量の店舗を処理するとブラウザ側が先にタイムアウトするため、
 * 本実行をここに戻さないこと。
 */
export const POST = withAudit("シート自動投稿", "EXTERNAL_OP", async (request, ctx) => {
  const body = await request.json();
  const result = await runAutoPost(body, ctx);
  return NextResponse.json(result.body, { status: result.status });
});
