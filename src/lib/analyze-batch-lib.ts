/**
 * AI総評のBatch API（半額）パイプライン。
 *
 * 流れ:
 *   1. analyze/route.ts (batchPrepare=true) が店舗ごとの材料(payload)を集めて submitAnalysisBatch を呼ぶ
 *   2. submitAnalysisBatch が Anthropic Message Batches API に一括投入し、DB(analysis_batches/items)に記録
 *   3. analyze-batch/route.ts の poll が完了バッチを取り込み、
 *      数値照合（同期版 enforceNumericAccuracy と同じ基準）→ 保存 / 修正ラウンド再投入 / 空欄化 を行う
 *
 * 同期版との対応:
 *   - 生成失敗 → 全件→50件の段階的リトライ（1回）
 *   - 照合違反 → 修正指示付き再生成（最大2回）→ それでも直らなければ該当欄を空欄化して保存
 * リトライは「次のラウンドのバッチ」として再投入されるため、全店完了までに複数ラウンドかかる。
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildAnalyzePrompt,
  parseAnalyzeText,
  applyFixRating,
  saveAnalysisRow,
  ANALYZE_MODEL,
  ANALYZE_MAX_TOKENS,
  type GBPReview,
} from "./analyze-core";
import {
  validatePageComments,
  buildCorrectionPrompt,
  type KeywordRankFacts,
  type MetricFact,
} from "./comment-validation";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const API_HEADERS = {
  "Content-Type": "application/json",
  "x-api-key": ANTHROPIC_API_KEY,
  "anthropic-version": "2023-06-01",
};
/** 照合違反時の修正再生成の上限（同期版 enforceNumericAccuracy の MAX_RETRY と同じ） */
const MAX_CORRECTIONS = 2;

export interface AnalysisPayload {
  reviews: GBPReview[];
  officialRating: number;
  officialCount: number;
  ratingDistribution?: Record<number, number>;
  kpiText?: string;
  langStatsText?: string;
  verifyCtx: { keywordFacts: KeywordRankFacts[]; reviewDeltas: number[]; metricFacts?: MetricFact[] };
}

export interface PreparedAnalysisItem {
  shopId: string;
  shopName: string;
  targetMonth: string | null;
  payload: AnalysisPayload;
}

interface BatchItemRow {
  id: string;
  batch_id: string;
  shop_id: string | null;
  shop_name: string;
  target_month: string | null;
  round: number;
  corrections: number;
  review_limit: "all" | "50";
  correction: string | null;
  payload: AnalysisPayload;
  state: string;
  note: string | null;
}

function promptForItem(item: {
  shop_name: string;
  payload: AnalysisPayload;
  review_limit: "all" | "50";
  correction: string | null;
}): string | null {
  const p = item.payload;
  const reviews = item.review_limit === "50" ? (p.reviews || []).slice(0, 50) : (p.reviews || []);
  return buildAnalyzePrompt(
    item.shop_name,
    reviews,
    p.officialRating,
    p.officialCount,
    p.ratingDistribution,
    p.kpiText,
    p.langStatsText,
    item.correction || undefined,
  );
}

/** Anthropic Message Batches APIへ一括投入し、DBに記録する */
export async function submitAnalysisBatch(
  supabase: SupabaseClient,
  items: PreparedAnalysisItem[],
): Promise<{ batchDbId: string; anthropicBatchId: string }> {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEYが設定されていません");

  // 1. バッチ行を作成（先に作ることで、投入失敗時もsubmit_failedとして痕跡が残る）
  const { data: batchRow, error: batchErr } = await supabase
    .from("analysis_batches")
    .insert({ status: "creating", round: 0, item_total: items.length })
    .select("id")
    .single();
  if (batchErr || !batchRow) throw new Error(`バッチ行の作成に失敗: ${batchErr?.message}`);
  const batchDbId = batchRow.id as string;

  // 2. アイテム行を作成（custom_idの順序依存を避けるためIDをクライアント側で発行）
  const rows = items.map((it) => ({
    id: crypto.randomUUID(),
    batch_id: batchDbId,
    shop_id: it.shopId,
    shop_name: it.shopName,
    target_month: it.targetMonth,
    round: 0,
    corrections: 0,
    review_limit: "all" as const,
    correction: null,
    payload: it.payload,
    state: "pending",
  }));
  const { error: itemsErr } = await supabase.from("analysis_batch_items").insert(rows);
  if (itemsErr) {
    await supabase.from("analysis_batches").update({ status: "submit_failed" }).eq("id", batchDbId);
    throw new Error(`アイテム行の作成に失敗: ${itemsErr.message}`);
  }

  // 3. Anthropicへ投入
  const anthropicBatchId = await postBatchRequests(supabase, batchDbId, rows);
  return { batchDbId, anthropicBatchId };
}

/** rows（DB行相当）からBatchリクエストを組み立ててAnthropicへPOSTする */
async function postBatchRequests(
  supabase: SupabaseClient,
  batchDbId: string,
  rows: Array<Pick<BatchItemRow, "id" | "shop_name" | "payload" | "review_limit" | "correction">>,
): Promise<string> {
  const requests: any[] = [];
  for (const row of rows) {
    const prompt = promptForItem(row);
    if (!prompt) {
      await supabase
        .from("analysis_batch_items")
        .update({ state: "failed", note: "プロンプト構築に失敗（口コミなし）", updated_at: new Date().toISOString() })
        .eq("id", row.id);
      continue;
    }
    requests.push({
      custom_id: row.id,
      params: {
        model: ANALYZE_MODEL,
        max_tokens: ANALYZE_MAX_TOKENS,
        messages: [{ role: "user", content: prompt }],
      },
    });
  }
  if (requests.length === 0) {
    await supabase.from("analysis_batches").update({ status: "submit_failed" }).eq("id", batchDbId);
    throw new Error("投入可能なアイテムがありません");
  }

  const res = await fetch("https://api.anthropic.com/v1/messages/batches", {
    method: "POST",
    headers: API_HEADERS,
    body: JSON.stringify({ requests }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    await supabase.from("analysis_batches").update({ status: "submit_failed" }).eq("id", batchDbId);
    throw new Error(`Batch API投入エラー: ${res.status} ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  await supabase
    .from("analysis_batches")
    .update({ anthropic_batch_id: data.id, status: "submitted", updated_at: new Date().toISOString() })
    .eq("id", batchDbId);
  return data.id as string;
}

export interface PollSummary {
  checkedBatches: number;
  stillProcessing: number;
  processedBatches: number;
  saved: number;
  blanked: number;
  failed: number;
  retried: number;
  resubmittedBatchId: string | null;
}

/**
 * 投入済みバッチをポーリングし、完了分を取り込む。
 * 照合違反・生成失敗のアイテムは次ラウンドのバッチとして自動再投入する。
 */
export async function pollAnalysisBatches(supabase: SupabaseClient): Promise<PollSummary> {
  const summary: PollSummary = {
    checkedBatches: 0,
    stillProcessing: 0,
    processedBatches: 0,
    saved: 0,
    blanked: 0,
    failed: 0,
    retried: 0,
    resubmittedBatchId: null,
  };

  const { data: batches, error } = await supabase
    .from("analysis_batches")
    .select("id, anthropic_batch_id, round, status")
    .eq("status", "submitted")
    .order("created_at", { ascending: true })
    .limit(5); // 1回のpollで処理するバッチ数上限（maxDuration対策）
  if (error) throw new Error(`バッチ一覧の取得に失敗: ${error.message}`);

  const retryItems: BatchItemRow[] = [];
  let maxRound = 0;

  for (const b of batches || []) {
    summary.checkedBatches++;
    const st = await fetch(`https://api.anthropic.com/v1/messages/batches/${b.anthropic_batch_id}`, {
      headers: API_HEADERS,
    });
    if (!st.ok) continue; // 一時エラーは次回のpollに任せる
    const stData = await st.json();
    if (stData.processing_status !== "ended") {
      summary.stillProcessing++;
      continue;
    }
    if (!stData.results_url) continue;

    const resRes = await fetch(stData.results_url, { headers: API_HEADERS });
    if (!resRes.ok) continue;
    const jsonl = await resRes.text();

    const { data: itemRows } = await supabase
      .from("analysis_batch_items")
      .select("*")
      .eq("batch_id", b.id);
    const byId = new Map<string, BatchItemRow>(((itemRows || []) as BatchItemRow[]).map((r) => [r.id, r]));

    for (const line of jsonl.split("\n")) {
      if (!line.trim()) continue;
      let rec: any;
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }
      const item = byId.get(rec.custom_id);
      if (!item || item.state !== "pending") continue;
      maxRound = Math.max(maxRound, item.round);
      await processItemResult(supabase, item, rec, retryItems, summary);
    }

    await supabase
      .from("analysis_batches")
      .update({ status: "processed", updated_at: new Date().toISOString() })
      .eq("id", b.id);
    summary.processedBatches++;
  }

  // 再投入（修正指示付き・またはロコミ50件版）
  if (retryItems.length > 0) {
    const round = maxRound + 1;
    const { data: newBatch, error: nbErr } = await supabase
      .from("analysis_batches")
      .insert({ status: "creating", round, item_total: retryItems.length })
      .select("id")
      .single();
    if (!nbErr && newBatch) {
      const newBatchId = newBatch.id as string;
      for (const it of retryItems) {
        await supabase
          .from("analysis_batch_items")
          .update({
            batch_id: newBatchId,
            round,
            corrections: it.corrections,
            review_limit: it.review_limit,
            correction: it.correction,
            state: "pending",
            updated_at: new Date().toISOString(),
          })
          .eq("id", it.id);
      }
      try {
        summary.resubmittedBatchId = await postBatchRequests(supabase, newBatchId, retryItems);
      } catch (e) {
        console.error("[analyze-batch] 再投入エラー:", e);
        // postBatchRequests内でsubmit_failedにマーク済み。アイテムはpendingのまま残るため
        // 次回pollでは拾われない（submitted以外のバッチは対象外）。手動で再投入し直す想定
      }
    }
  }

  return summary;
}

/** 1アイテムの結果を処理: 保存 / リトライ登録 / 失敗マーク */
async function processItemResult(
  supabase: SupabaseClient,
  item: BatchItemRow,
  rec: any,
  retryItems: BatchItemRow[],
  summary: PollSummary,
): Promise<void> {
  const payload = item.payload;
  const mark = (state: string, note: string | null) =>
    supabase
      .from("analysis_batch_items")
      .update({ state, note, updated_at: new Date().toISOString() })
      .eq("id", item.id);

  const succeeded = rec.result?.type === "succeeded";
  const text = succeeded
    ? ((rec.result.message?.content || []) as any[])
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("")
    : "";
  const analysis = succeeded ? parseAnalyzeText(text, payload.reviews) : null;

  if (!analysis) {
    // 生成失敗: 同期版の段階的リトライ（全件→50件）を踏襲して1回だけ再試行
    if (item.review_limit === "all" && (payload.reviews?.length || 0) > 50) {
      retryItems.push({ ...item, review_limit: "50" });
      summary.retried++;
      return;
    }
    await mark("failed", succeeded ? "応答のパースに失敗" : `生成失敗: ${rec.result?.type || "unknown"}`);
    summary.failed++;
    return;
  }

  // 数値照合（同期版 enforceNumericAccuracy のBatch版）
  const violations = validatePageComments(analysis.pageComments as Record<string, unknown>, payload.verifyCtx);
  if (violations.length > 0 && item.corrections < MAX_CORRECTIONS) {
    retryItems.push({
      ...item,
      correction: buildCorrectionPrompt(violations),
      corrections: item.corrections + 1,
    });
    summary.retried++;
    return;
  }

  let blanked = false;
  if (violations.length > 0) {
    // 再生成しても直らない → 誤った数値を含むページの総評だけ空欄にして出荷（同期版と同じ方針）
    const dropped = Array.from(new Set(violations.map((v) => v.field)));
    const pc = { ...((analysis.pageComments || {}) as Record<string, unknown>) };
    for (const f of dropped) pc[f] = "";
    analysis.pageComments = pc;
    blanked = true;
    console.error(`[analyze-batch] ${item.shop_name}: 再生成${MAX_CORRECTIONS}回でも数値が一致せず、該当欄を空欄化: ${dropped.join(", ")}`);
  }

  applyFixRating(analysis, payload.officialRating);
  const err = await saveAnalysisRow(supabase, {
    shopName: item.shop_name,
    shopId: item.shop_id,
    analysis,
    officialRating: payload.officialRating,
    officialCount: payload.officialCount,
    targetMonth: item.target_month,
  });
  if (err) {
    await mark("failed", `DB保存エラー: ${err}`);
    summary.failed++;
    return;
  }
  if (blanked) {
    await mark("blanked", "照合違反が直らず該当欄を空欄化して保存");
    summary.blanked++;
  } else {
    await mark("succeeded", null);
  }
  summary.saved++;
}
