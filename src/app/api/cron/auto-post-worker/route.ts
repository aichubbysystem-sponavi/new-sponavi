import { NextRequest, NextResponse } from "next/server";
import { getSupabase, verifyCron } from "@/lib/supabase";
import { runAutoPost } from "@/lib/auto-post/engine";
import { kickCron } from "@/lib/auto-post/worker-kick";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/auto-post-worker
 * シート自動投稿ジョブ（auto_post_jobs）のバックグラウンド処理
 *
 * - ジョブ1件を占有（lease）し、shop_names を数店舗ずつ runAutoPost に渡して処理する
 * - 1店舗ごとの結果は auto_post_job_items に保存、進捗は cursor に保存（途中で落ちても続きから再開できる）
 * - 関数上限300秒の手前（BUDGET_MS）で新しいスライスを始めるのをやめ、残りがあれば自分を再起動する
 * - 毎分の cron（vercel.json）が queued / lease 期限切れの running を拾う保険
 *
 * 呼び出し元: vercel cron（毎分）／ジョブ作成API／自分自身（続き）
 */

/** 新しいスライスを始める上限。スライス1回（5店舗×3枚のStorage保存）は長くても90秒程度で 180+90 < 300 */
const BUDGET_MS = 180_000;
/** 占有期限。生きているワーカーはスライスごとに延長するので、これを過ぎた running は死んだとみなしてよい */
const LEASE_MS = 5 * 60_000;
/** 1回に runAutoPost へ渡す店舗数。予約登録は Dropbox→Storage の転送が重いので少なめ */
const SLICE_SIZE: Record<string, number> = { check: 10, schedule: 5, immediate: 5 };

const normName = (s: string) => (s || "").normalize("NFKC").replace(/[\s　]+/g, "").toLowerCase();
/** 登録済み扱い（重複スキップ＝既に同一時刻の予約がある＝登録済み） */
const isOkStatus = (st: string) => /成功|登録可能|重複スキップ/.test(st || "");
const isHoldStatus = (st: string) => /保留/.test(st || "") && !isOkStatus(st);

export async function GET(request: NextRequest) {
  const cronErr = verifyCron(request); if (cronErr) return cronErr;

  const sb = getSupabase();
  const start = Date.now();
  const nowIso = new Date().toISOString();

  // --- ジョブを1件占有する ---
  const { data: candidates, error: listErr } = await sb.from("auto_post_jobs")
    .select("*")
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: true })
    .limit(20);
  if (listErr) {
    // テーブル未作成（sql/2026-09-04_auto_post_jobs.sql 未適用）など
    console.error("[auto-post-worker] ジョブ取得失敗:", listErr.message);
    return NextResponse.json({ error: `ジョブ取得失敗: ${listErr.message}` }, { status: 500 });
  }
  const job = (candidates || []).find((j) => j.status === "queued" || !j.lease_until || new Date(j.lease_until).getTime() < Date.now());
  if (!job) return NextResponse.json({ success: true, message: "対象ジョブなし" });

  const lease = () => new Date(Date.now() + LEASE_MS).toISOString();
  // 条件付き更新で占有。別ワーカーが先に取っていれば0行になる
  const { data: claimed } = await sb.from("auto_post_jobs")
    .update({ status: "running", lease_until: lease(), updated_at: nowIso })
    .eq("id", job.id)
    .or(`status.eq.queued,lease_until.is.null,lease_until.lt.${nowIso}`)
    .select("id");
  if (!claimed || claimed.length === 0) return NextResponse.json({ success: true, message: "他のワーカーが処理中" });

  const names: string[] = Array.isArray(job.shop_names) ? job.shop_names : [];
  const sliceSize = SLICE_SIZE[job.mode] || 5;
  let cursor: number = job.cursor || 0;
  let posted: number = job.posted || 0;
  let errors: number = job.errors || 0;
  let lastError: string | null = null;
  let seq = cursor; // items の表示順。再開時は cursor から続ける（同じ店舗の旧行は削除して入れ直す）
  const csvCache = new Map<string, string | null>();
  let cancelled = false;

  console.log(`[auto-post-worker] job ${job.id} ${job.mode} 開始 cursor=${cursor}/${names.length}`);

  while (cursor < names.length && Date.now() - start < BUDGET_MS) {
    // 画面から中止されていたら止める
    const { data: fresh } = await sb.from("auto_post_jobs").select("status").eq("id", job.id).maybeSingle();
    if (fresh?.status === "cancelled") { cancelled = true; break; }

    const slice = names.slice(cursor, cursor + sliceSize);
    let results: any[] = [];
    try {
      const r = await runAutoPost({
        sheetId: job.sheet_id,
        targetDate: job.target_date,
        topicType: job.topic_type,
        filterShopNames: slice,
        scheduleMode: true,
        checkOnly: job.mode === "check",
        scheduleAt: job.schedule_at,
        batchOffset: 0,
        batchSize: 100000, // スライス内の全行（店舗名で絞っているので数件）
      }, {}, { csvCache });
      if (r.status !== 200) throw new Error(r.body?.error || `HTTP ${r.status}`);
      results = Array.isArray(r.body?.results) ? r.body.results : [];
      // 該当0件（プレビュー後にシートが変わった等）の店舗も結果に残す。黙って消えるのが一番困る
      const seen = new Set(results.map((x: any) => normName(x.shopName)));
      for (const n of slice) {
        if (!seen.has(normName(n))) results.push({ shopName: n, status: "シート上で見つからず（スキップ）", detail: "プレビュー後にシートの店舗名・日付が変わった可能性があります", check: "ng" });
      }
    } catch (e: any) {
      const msg = String(e?.message || e).slice(0, 300);
      lastError = msg;
      console.error(`[auto-post-worker] job ${job.id} スライス失敗 cursor=${cursor}:`, msg);
      results = slice.map((n) => ({ shopName: n, status: `エラー（未処理・再実行対象）: ${msg}`, check: "ng" }));
    }

    // --- 結果を保存（再開で同じ店舗が再処理された場合は入れ直す） ---
    const rows = results.map((r: any) => ({
      id: crypto.randomUUID(),
      job_id: job.id,
      seq: seq++,
      shop_name: String(r.shopName || "不明").slice(0, 200),
      status: String(r.status || "不明").slice(0, 300),
      data: r,
    }));
    try {
      const sliceNames = Array.from(new Set(rows.map((x) => x.shop_name)));
      await sb.from("auto_post_job_items").delete().eq("job_id", job.id).in("shop_name", sliceNames);
      const { error: insErr } = await sb.from("auto_post_job_items").insert(rows);
      if (insErr) console.error("[auto-post-worker] items 保存失敗:", insErr.message);
    } catch (e: any) {
      console.error("[auto-post-worker] items 保存例外:", e?.message);
    }

    for (const r of results) {
      if (isOkStatus(r.status)) posted++;
      else if (!isHoldStatus(r.status)) errors++;
    }
    cursor += slice.length;

    await sb.from("auto_post_jobs").update({
      cursor, posted, errors, last_error: lastError, lease_until: lease(), updated_at: new Date().toISOString(),
    }).eq("id", job.id);
  }

  const elapsed = Math.round((Date.now() - start) / 1000);
  const done = cursor >= names.length;

  if (cancelled) {
    await sb.from("auto_post_jobs").update({ lease_until: null, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", job.id);
    console.log(`[auto-post-worker] job ${job.id} 中止 cursor=${cursor}/${names.length} ${elapsed}s`);
    return NextResponse.json({ success: true, jobId: job.id, cancelled: true, cursor, total: names.length, elapsed });
  }

  if (done) {
    await sb.from("auto_post_jobs").update({
      status: "done", cursor, posted, errors, last_error: lastError, lease_until: null,
      finished_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", job.id);
    console.log(`[auto-post-worker] job ${job.id} 完了 ${posted}件/エラー${errors}件 ${elapsed}s`);
    // 即時投稿は「今すぐ」の予約として登録してあるので、5分後のcronを待たずに投稿を始める
    if (job.mode === "immediate") await kickCron(request, "/api/cron/execute-posts");
    // 後続のジョブが並んでいれば続けて起動
    const { data: next } = await sb.from("auto_post_jobs").select("id").eq("status", "queued").limit(1);
    if (next && next.length > 0) await kickCron(request, "/api/cron/auto-post-worker");
    return NextResponse.json({ success: true, jobId: job.id, done: true, posted, errors, total: names.length, elapsed });
  }

  // 時間切れ: 占有を延長したまま自分を再起動して続きを処理する（起動に失敗しても毎分のcronが拾う）
  console.log(`[auto-post-worker] job ${job.id} 時間切れ cursor=${cursor}/${names.length} ${elapsed}s → 続きを起動`);
  await kickCron(request, "/api/cron/auto-post-worker");
  return NextResponse.json({ success: true, jobId: job.id, done: false, cursor, total: names.length, elapsed });
}
