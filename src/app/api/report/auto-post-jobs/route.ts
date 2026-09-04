import { NextRequest, NextResponse } from "next/server";
import { getSupabase, requireAuth } from "@/lib/supabase";
import { withAudit } from "@/lib/audit";
import { runAutoPost } from "@/lib/auto-post/engine";
import { kickCron } from "@/lib/auto-post/worker-kick";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * シート自動投稿ジョブ（タイムアウト根本対策・2026-09-04）
 *
 * POST  ジョブ作成: プレビュー（シート読み取りのみ・数秒）で対象店舗名を確定して auto_post_jobs に登録し、
 *       ワーカー（/api/cron/auto-post-worker）を起動して即返す。処理はバックグラウンド。
 * GET   ?id=… ジョブ＋店舗ごとの結果 ／ id 無し: 直近のジョブ一覧（画面を開き直したときの復帰用）
 * PATCH { id, action: "cancel" } 中止
 *
 * mode:
 *   check     事前チェック（登録しない）
 *   schedule  予約投稿として登録（scheduleAt 必須）
 *   immediate 即時投稿 ＝ 「今」の予約として登録し、cron/execute-posts が数分以内に投稿する。
 *             以前の即時投稿はブラウザの1リクエスト内でGBPに直接投稿していたが、
 *             10店舗×3枚で180秒を超えて落ちたため、予約と同じ経路（10並列・210秒予算・再開可能）に統一した。
 *             ※警告あり（CTAリンク異常など）の行は予約と同じく「保留」になる。写真投稿に警告は発生しない
 */

type JobMode = "check" | "schedule" | "immediate";

export const POST = withAudit("シート自動投稿ジョブ作成", "EXTERNAL_OP", async (request, ctx) => {
  const body = await request.json();
  const { mode, sheetId, targetDate, topicType, filterShopNames, filterShopName, scheduleAt, targetLabel } = body as {
    mode: JobMode; sheetId: string; targetDate: string; topicType?: string;
    filterShopNames?: string[]; filterShopName?: string; scheduleAt?: string; targetLabel?: string;
  };
  if (!["check", "schedule", "immediate"].includes(mode)) return NextResponse.json({ error: "mode が不正です" }, { status: 400 });
  if (!sheetId || !targetDate) return NextResponse.json({ error: "sheetIdとtargetDateが必要です" }, { status: 400 });
  // 絞り込んだつもりで空配列＝全店舗、の事故を engine と同じくここでも止める
  if (Array.isArray(filterShopNames) && filterShopNames.length === 0) {
    return NextResponse.json({ error: "投稿先の店舗が空で送られました（全店舗への投稿を防ぐため中止しました）。店舗を選び直してください" }, { status: 400 });
  }
  if (mode === "schedule" && !scheduleAt) return NextResponse.json({ error: "予約日時が必要です" }, { status: 400 });

  const sb = getSupabase();

  // 同時に2本走らせない（同じ店舗を二重に登録しに行く・Dropbox/Googleのレート制限に当たる）
  const { data: active, error: activeErr } = await sb.from("auto_post_jobs")
    .select("id, mode, target_date, cursor, total, created_at")
    .in("status", ["queued", "running"]).limit(1);
  if (activeErr) {
    return NextResponse.json({ error: `ジョブテーブルにアクセスできません（sql/2026-09-04_auto_post_jobs.sql が未適用の可能性）: ${activeErr.message}` }, { status: 500 });
  }
  if (active && active.length > 0) {
    const a = active[0];
    return NextResponse.json({ error: `実行中のジョブがあります（${a.mode} ${a.target_date}: ${a.cursor}/${a.total}店舗）。完了か中止を待ってください`, activeJobId: a.id }, { status: 409 });
  }

  // 対象店舗名をサーバー側で確定（プレビュー＝シート読み取りのみ。Dropbox検索はしないので数秒）
  const preview = await runAutoPost({ sheetId, targetDate, topicType, dryRun: true, filterShopNames, filterShopName }, {});
  if (preview.status !== 200) return NextResponse.json(preview.body, { status: preview.status });
  const rows: any[] = Array.isArray(preview.body?.data) ? preview.body.data : [];
  const names = Array.from(new Set(rows.map((d) => String(d.shopName || "").trim()).filter(Boolean)));
  if (names.length === 0) {
    return NextResponse.json({ error: `${targetDate}に該当する投稿がありません`, matches: 0, debug: preview.body?.debug, failedTabs: preview.body?.failedTabs }, { status: 400 });
  }

  const now = new Date();
  const schedule_at = mode === "immediate"
    ? now.toISOString()
    : mode === "schedule"
      ? new Date(scheduleAt!).toISOString()
      : new Date(scheduleAt || `${targetDate}T09:00:00+09:00`).toISOString();
  if (Number.isNaN(new Date(schedule_at).getTime())) return NextResponse.json({ error: "予約日時の形式が不正です" }, { status: 400 });

  const id = crypto.randomUUID();
  const { error: insErr } = await sb.from("auto_post_jobs").insert({
    id, mode, status: "queued",
    sheet_id: sheetId, target_date: targetDate, topic_type: topicType || "STANDARD",
    schedule_at, shop_names: names, total: names.length,
    target_label: (targetLabel || "").slice(0, 200) || null,
    created_by: ctx.userName || null,
  });
  if (insErr) return NextResponse.json({ error: `ジョブ登録失敗: ${insErr.message}` }, { status: 500 });

  ctx.detail = `${mode} ${targetDate}: ${names.length}店舗（${targetLabel || "絞り込みなし"}） job=${id}`;

  // ワーカー起動（失敗しても毎分のcronが拾う）
  await kickCron(request, "/api/cron/auto-post-worker");

  return NextResponse.json({ jobId: id, total: names.length, failedTabs: preview.body?.failedTabs, unmatchedFilterNames: preview.body?.unmatchedFilterNames, scheduleAt: schedule_at });
});

export async function GET(request: NextRequest) {
  const { error } = await requireAuth(request);
  if (error) return error;
  const sb = getSupabase();
  const id = request.nextUrl.searchParams.get("id");

  if (!id) {
    const { data, error: e } = await sb.from("auto_post_jobs")
      .select("id, mode, status, target_date, topic_type, schedule_at, total, cursor, posted, errors, target_label, created_by, created_at, finished_at, last_error")
      .order("created_at", { ascending: false }).limit(10);
    if (e) return NextResponse.json({ error: e.message }, { status: 500 });
    return NextResponse.json({ jobs: data || [] });
  }

  const { data: job, error: jobErr } = await sb.from("auto_post_jobs").select("*").eq("id", id).maybeSingle();
  if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 });
  if (!job) return NextResponse.json({ error: "ジョブが見つかりません" }, { status: 404 });
  const { data: items } = await sb.from("auto_post_job_items")
    .select("seq, shop_name, status, data").eq("job_id", id)
    .order("seq", { ascending: true }).limit(5000);
  const { shop_names: _omit, ...jobPublic } = job;
  return NextResponse.json({ job: jobPublic, results: (items || []).map((it) => it.data) });
}

export const PATCH = withAudit("シート自動投稿ジョブ中止", "EXTERNAL_OP", async (request, ctx) => {
  const { id, action } = await request.json();
  if (!id || action !== "cancel") return NextResponse.json({ error: "id と action=cancel が必要です" }, { status: 400 });
  const sb = getSupabase();
  const { data, error } = await sb.from("auto_post_jobs")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", id).in("status", ["queued", "running"]).select("id, cursor, total");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) return NextResponse.json({ error: "中止できるジョブがありません（既に完了）" }, { status: 409 });
  ctx.detail = `job=${id} ${data[0].cursor}/${data[0].total}店舗で中止`;
  return NextResponse.json({ success: true });
});
