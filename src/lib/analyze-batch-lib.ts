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
/** pollの排他ロックが自動的に切れるまでの時間。サーバのmaxDuration(300秒)より長くする */
const LOCK_TTL_MS = 6 * 60 * 1000;
/** ステータス取得に連続失敗したバッチを「死にバッチ」として除外する閾値 */
const MAX_POLL_ATTEMPTS = 20;

/**
 * pollの排他ロックを取る。取れなければfalse。
 * 【なぜ必要か】UIのクライアントタイムアウト(280秒)がサーバのmaxDuration(300秒)より短いため、
 * 大きい取り込みでは「クライアントだけエラー→ユーザーが再クリック」が起きる。
 * ロックが無いと、旧pollが走行中に新pollが同じpendingアイテムを読み、
 * 修正ラウンドのバッチを二重にAnthropicへ投入する＝二重課金になる。
 */
async function acquireLock(supabase: SupabaseClient, by: string): Promise<boolean> {
  const now = Date.now();
  const { data } = await supabase
    .from("analysis_batch_lock")
    .select("locked_at")
    .eq("id", 1)
    .maybeSingle();
  const lockedAt = data?.locked_at ? new Date(data.locked_at).getTime() : 0;
  if (lockedAt && now - lockedAt < LOCK_TTL_MS) return false; // 実行中

  // TTL切れ or 未ロックなら奪う。競合時は「自分が見た値と同じ場合のみ更新」で防ぐ
  const q = supabase
    .from("analysis_batch_lock")
    .update({ locked_at: new Date(now).toISOString(), locked_by: by })
    .eq("id", 1);
  const { data: updated } = data?.locked_at
    ? await q.eq("locked_at", data.locked_at).select("id")
    : await q.is("locked_at", null).select("id");
  return !!(updated && updated.length > 0);
}

async function releaseLock(supabase: SupabaseClient): Promise<void> {
  await supabase.from("analysis_batch_lock").update({ locked_at: null, locked_by: null }).eq("id", 1);
}

/**
 * 指定店舗のうち、まだ結果待ち（pending）のものを返す。
 * 【なぜ必要か】Batchは投入から取り込みまで最大1時間 report_analysis に行が出ないため、
 * 「押したか不安→リロード→もう一度押す」で全店が二重投入され、そのまま二重課金になる。
 */
export async function findPendingShopNames(
  supabase: SupabaseClient,
  shopNames: string[],
): Promise<Set<string>> {
  if (shopNames.length === 0) return new Set();
  const { data } = await supabase
    .from("analysis_batch_items")
    .select("shop_name")
    .eq("state", "pending")
    .in("shop_name", shopNames);
  return new Set((data || []).map((r: { shop_name: string }) => r.shop_name));
}

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
  /** 投入時刻。取り込み時に「投入後に作り直された結果」を上書きしないための基準 */
  submitted_at?: string;
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
  // payloadの口コミ本文はプロンプトと同じ300字に切って保存する。
  // 全文のまま入れると数千件の店でpayloadが数MBになり、insertが失敗して
  // 同じリクエストの他店まで巻き添えで投入失敗する（2026-08-02 レビュー指摘 M-5）
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
    payload: {
      ...it.payload,
      reviews: (it.payload.reviews || []).map((r) => ({
        ...r,
        comment: (r.comment || "").slice(0, 300),
      })),
    },
    state: "pending",
  }));
  // 1件ずつinsertし、巨大な1店の失敗が他店を巻き込まないようにする
  const inserted: typeof rows = [];
  for (const row of rows) {
    const { error } = await supabase.from("analysis_batch_items").insert(row);
    if (error) {
      console.error(`[analyze-batch] ${row.shop_name}: アイテム行の作成に失敗（この店舗のみスキップ）:`, error.message);
      continue;
    }
    inserted.push(row);
  }
  if (inserted.length === 0) {
    await supabase.from("analysis_batches").update({ status: "submit_failed" }).eq("id", batchDbId);
    throw new Error("アイテム行を1件も作成できませんでした");
  }
  if (inserted.length !== rows.length) {
    await supabase.from("analysis_batches").update({ item_total: inserted.length }).eq("id", batchDbId);
  }
  rows.length = 0;
  rows.push(...inserted);

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
  /** 取り残されたpendingを救済して再投入した件数 */
  rescued: number;
  /** ステータス取得に失敗し続けて対象外にしたバッチ数 */
  deadBatches: number;
  resubmittedBatchId: string | null;
  /** 別のpollが実行中でスキップした場合true */
  lockBusy: boolean;
}

/** 死にバッチを対象外にし、配下のpendingを失敗として確定させる */
async function markBatchDead(supabase: SupabaseClient, batchId: string, reason: string): Promise<void> {
  await supabase
    .from("analysis_batch_items")
    .update({ state: "failed", note: reason, updated_at: new Date().toISOString() })
    .eq("batch_id", batchId)
    .eq("state", "pending");
  await supabase
    .from("analysis_batches")
    .update({ status: "dead", updated_at: new Date().toISOString() })
    .eq("id", batchId);
  console.error(`[analyze-batch] バッチ${batchId}を対象外にしました: ${reason}`);
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
    rescued: 0,
    deadBatches: 0,
    resubmittedBatchId: null,
    lockBusy: false,
  };

  // 二重実行（＝修正ラウンドの二重投入＝二重課金）を防ぐ
  const lockId = `poll-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (!(await acquireLock(supabase, lockId))) {
    summary.lockBusy = true;
    return summary;
  }

  try {
    const { data: batches, error } = await supabase
      .from("analysis_batches")
      .select("id, anthropic_batch_id, round, status, poll_attempts")
      .eq("status", "submitted")
      // 死にバッチ（ステータス取得に失敗し続けるもの）が先頭5件を占有して
      // 新しいバッチが永久に処理されなくなるのを防ぐため、試行回数が少ない順に見る
      .lt("poll_attempts", MAX_POLL_ATTEMPTS)
      .order("poll_attempts", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(5); // 1回のpollで処理するバッチ数上限（maxDuration対策）
    if (error) throw new Error(`バッチ一覧の取得に失敗: ${error.message}`);

    const retryItems: BatchItemRow[] = [];
    let maxRound = 0;

    for (const b of batches || []) {
      summary.checkedBatches++;
      // 先に試行回数を進める（このpollがタイムアウトで落ちても、死にバッチは必ず脱落していく）
      await supabase
        .from("analysis_batches")
        .update({ poll_attempts: (b.poll_attempts || 0) + 1, updated_at: new Date().toISOString() })
        .eq("id", b.id);

      const st = await fetch(`https://api.anthropic.com/v1/messages/batches/${b.anthropic_batch_id}`, {
        headers: API_HEADERS,
      });
      if (!st.ok) {
        // 401/404などが続くバッチはMAX_POLL_ATTEMPTSで自動的に対象外になる
        if ((b.poll_attempts || 0) + 1 >= MAX_POLL_ATTEMPTS) {
          summary.deadBatches++;
          await markBatchDead(supabase, b.id, `ステータス取得に${MAX_POLL_ATTEMPTS}回失敗（HTTP ${st.status}）`);
        }
        continue;
      }
      const stData = await st.json();
      if (stData.processing_status !== "ended") {
        summary.stillProcessing++;
        continue;
      }
      if (!stData.results_url) {
        if ((b.poll_attempts || 0) + 1 >= MAX_POLL_ATTEMPTS) {
          summary.deadBatches++;
          await markBatchDead(supabase, b.id, "完了しているがresults_urlが取得できない（29日経過で失効した可能性）");
        }
        continue;
      }

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

      // 【重要】この時点で「結果に載っていなかった」等でpendingのまま残ったアイテムは、
      // バッチをprocessedにすると二度と拾われない（pollはsubmittedしか見ない）。
      // 取りこぼしを失敗として確定させ、UIから見える状態にする
      const { data: leftovers } = await supabase
        .from("analysis_batch_items")
        .select("id")
        .eq("batch_id", b.id)
        .eq("state", "pending");
      const leftoverIds = (leftovers || []).map((r: { id: string }) => r.id);
      // 再投入予定のアイテムは別バッチへ移すのでここでは触らない
      const retryIdSet = new Set(retryItems.map((r) => r.id));
      const orphanIds = leftoverIds.filter((id) => !retryIdSet.has(id));
      if (orphanIds.length > 0) {
        await supabase
          .from("analysis_batch_items")
          .update({
            state: "failed",
            note: "バッチ結果に該当レコードが無く取り込めなかった（再投入が必要）",
            updated_at: new Date().toISOString(),
          })
          .in("id", orphanIds);
        summary.failed += orphanIds.length;
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
      const ok = await resubmit(supabase, retryItems, round, summary);
      if (!ok) {
        // 再投入に失敗したアイテムは失敗として確定させる（pendingのまま宙に浮かせない）
        await supabase
          .from("analysis_batch_items")
          .update({
            state: "failed",
            note: "修正ラウンドの再投入に失敗（対象店舗を再度Batch投入するか、同期分析で処理してください）",
            updated_at: new Date().toISOString(),
          })
          .in("id", retryItems.map((r) => r.id));
        summary.failed += retryItems.length;
        summary.retried -= retryItems.length;
      }
    }

    return summary;
  } finally {
    // 例外・タイムアウトでもロックは必ず解放する（TTLでも切れるが即時解放が望ましい）
    await releaseLock(supabase).catch(() => {});
  }
}

/** retryItemsを新しいバッチとして投入する。成功時true */
async function resubmit(
  supabase: SupabaseClient,
  retryItems: BatchItemRow[],
  round: number,
  summary: PollSummary,
): Promise<boolean> {
  const { data: newBatch, error: nbErr } = await supabase
    .from("analysis_batches")
    .insert({ status: "creating", round, item_total: retryItems.length })
    .select("id")
    .single();
  if (nbErr || !newBatch) {
    console.error("[analyze-batch] 再投入バッチの作成に失敗:", nbErr?.message);
    return false;
  }
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
    return true;
  } catch (e) {
    console.error("[analyze-batch] 再投入エラー:", e);
    return false;
  }
}

/**
 * 取り残された/失敗したアイテムを新しいバッチとして投入し直す（救済）。
 * poll がタイムアウトで落ちた場合や再投入に失敗した場合の復旧手段。
 * UIの「失敗分を再投入」ボタンから呼ぶ。
 */
export async function rescueFailedItems(supabase: SupabaseClient): Promise<{ rescued: number; batchId: string | null }> {
  const { data: rows } = await supabase
    .from("analysis_batch_items")
    .select("*")
    .eq("state", "failed")
    .order("updated_at", { ascending: true })
    .limit(200);
  const items = (rows || []) as BatchItemRow[];
  if (items.length === 0) return { rescued: 0, batchId: null };

  // corrections/review_limitは前回の状態を引き継ぐ（無限に再生成しないため上限も維持）
  const targets = items.filter((it) => it.corrections <= MAX_CORRECTIONS);
  if (targets.length === 0) return { rescued: 0, batchId: null };

  const summary = { resubmittedBatchId: null } as PollSummary;
  const round = Math.max(...targets.map((t) => t.round)) + 1;
  const ok = await resubmit(supabase, targets, round, summary);
  return { rescued: ok ? targets.length : 0, batchId: summary.resubmittedBatchId };
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

  // 投入後に同期分析や人手編集で作り直されていたら、古い結果で上書きしない
  const { data: existing } = await supabase
    .from("report_analysis")
    .select("analyzed_at")
    .eq("shop_name", item.shop_name)
    .eq("target_month", item.target_month)
    .maybeSingle();
  if (existing?.analyzed_at && item.submitted_at && new Date(existing.analyzed_at) > new Date(item.submitted_at)) {
    await mark("skipped", "投入後に新しい分析結果が保存されていたため取り込みをスキップ");
    return;
  }

  const succeeded = rec.result?.type === "succeeded";
  const text = succeeded
    ? ((rec.result.message?.content || []) as any[])
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("")
    : "";
  // 【重要】パースに渡す口コミは、プロンプトに載せたものと同じ範囲にする。
  // 全件を渡すと、AIが読んでいない51件目以降の口コミがワードの登場回数ランキングや
  // 出典に混入し、同期版と結果が変わる（2026-08-02 レビュー指摘 M-2）
  const promptReviews = item.review_limit === "50" ? (payload.reviews || []).slice(0, 50) : (payload.reviews || []);
  const analysis = succeeded ? parseAnalyzeText(text, promptReviews) : null;

  if (!analysis) {
    // 恒久エラー（リクエスト自体が不正）は縮小リトライしても直らないので即failed。
    // expired/canceled は内容に問題が無いため、口コミ件数に関わらず1回だけ再投入する
    const errType = rec.result?.type as string | undefined;
    const permanentError = errType === "errored";
    const retryableWithoutShrink = errType === "expired" || errType === "canceled";

    if (retryableWithoutShrink && item.corrections <= MAX_CORRECTIONS) {
      retryItems.push({ ...item });
      summary.retried++;
      return;
    }
    // 生成失敗: 同期版の段階的リトライ（全件→50件）を踏襲して1回だけ再試行
    if (!permanentError && item.review_limit === "all" && (payload.reviews?.length || 0) > 50) {
      retryItems.push({ ...item, review_limit: "50" });
      summary.retried++;
      return;
    }
    const detail = permanentError
      ? `リクエストエラー: ${rec.result?.error?.type || "errored"}`
      : succeeded
        ? "応答のパースに失敗"
        : `生成失敗: ${errType || "unknown"}`;
    await mark("failed", detail);
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
