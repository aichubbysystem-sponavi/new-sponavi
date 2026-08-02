/**
 * AI総評 Batch API（半額）の状況確認・取り込み。
 *
 * GET  — バッチ一覧とアイテムの状態集計（UI表示用・課金なし）
 * POST — ポーリング実行: 完了バッチの結果取り込み＋照合＋必要なら修正ラウンド再投入（PAID_OP）
 *
 * 投入自体は /api/report/analyze の batchPrepare=true が行う（店舗データ準備ロジックを共用するため）。
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabase, requireRole } from "@/lib/supabase";
import { withAudit } from "@/lib/audit";
import { pollAnalysisBatches } from "@/lib/analyze-batch-lib";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  // 閲覧のみだが、社内管理機能のため社長・幹部・社員に限定（バイトには不要な画面）
  const auth = await requireRole(request, ["president", "executive", "manager"]);
  if (auth.error) return auth.error;

  const supabase = getSupabase();
  const { data: batches, error } = await supabase
    .from("analysis_batches")
    .select("id, anthropic_batch_id, round, status, item_total, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // アイテム状態の集計（対象バッチ分のみ）
  const ids = (batches || []).map((b) => b.id);
  const counts: Record<string, Record<string, number>> = {};
  if (ids.length > 0) {
    const { data: items } = await supabase
      .from("analysis_batch_items")
      .select("batch_id, state")
      .in("batch_id", ids);
    for (const it of items || []) {
      counts[it.batch_id] = counts[it.batch_id] || {};
      counts[it.batch_id][it.state] = (counts[it.batch_id][it.state] || 0) + 1;
    }
  }

  // 未完了（pending）アイテムの店舗名（進捗表示用）
  const active = (batches || []).some((b) => b.status === "submitted");
  return NextResponse.json({
    batches: (batches || []).map((b) => ({ ...b, stateCounts: counts[b.id] || {} })),
    hasActive: active,
  });
}

export const POST = withAudit("AI口コミ分析(Batch取込)", "PAID_OP", async (_request, ctx) => {
  const supabase = getSupabase();
  try {
    const summary = await pollAnalysisBatches(supabase);
    ctx.detail = `保存${summary.saved}件（空欄化${summary.blanked}）/ 失敗${summary.failed} / 再投入${summary.retried} / 処理中${summary.stillProcessing}バッチ`;
    return NextResponse.json({ success: true, ...summary });
  } catch (e: any) {
    console.error("[analyze-batch] pollエラー:", e);
    return NextResponse.json({ error: e?.message || "取り込みに失敗しました" }, { status: 500 });
  }
});
