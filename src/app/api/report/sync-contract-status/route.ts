/**
 * POST /api/report/sync-contract-status
 * MEOマスタ（スプレッドシート）の契約ステータスを shops に反映する。
 *   B列: 契約中 / 解約 / 停止中
 *   C列: 店舗名
 *
 * body: { apply?: boolean }   既定は false（dry-run。差分を返すだけ）
 *
 * 【安全策】
 * - 既定はdry-run。apply:true を明示したときだけ書き込む
 * - シート取得に失敗した／行数が極端に少ない場合は中断する
 *   （シートが空で返ってきたときに全店舗を解約にしてしまう事故を防ぐ）
 * - 変更件数が全体の3割を超える場合は force:true が無い限り中断する
 * - 店舗名は正規化した完全一致のみ。同名が複数ある場合は触らずに報告する
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabase, requireRole } from "@/lib/supabase";
import { withAudit } from "@/lib/audit";
import {
  parseMasterCsv,
  diffContractStatus,
  statusToColumns,
  type DbShop,
} from "@/lib/shop-status";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MASTER_SHEET_ID = "1voRfgPYkhV7BbK3Y58q8r8FMrQaA20MY8YUJXAXE42s";
const MASTER_GID = "1937358659"; // MEOマスタ タブ
/** これを下回る行数しか取れなかった場合はシート異常とみなして中断する */
const MIN_EXPECTED_ROWS = 200;
/** 全店舗のこの割合を超える変更は、確認なしには適用しない */
const MAX_CHANGE_RATIO = 0.3;

/** 簡易CSVパーサ（引用符・改行入りセル対応） */
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n") {
      row.push(field); field = "";
      rows.push(row); row = [];
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

async function fetchMasterRows(): Promise<string[][] | null> {
  const url = `https://docs.google.com/spreadsheets/d/${MASTER_SHEET_ID}/gviz/tq?tqx=out:csv&gid=${MASTER_GID}&range=A1:C400`;
  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0" },
      redirect: "follow",
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      console.error("[sync-contract-status] sheet fetch failed:", res.status);
      return null;
    }
    const text = await res.text();
    if (text.includes("<!DOCTYPE") || text.includes("<html")) {
      console.error("[sync-contract-status] sheet returned HTML（権限またはID不正）");
      return null;
    }
    return parseCSV(text);
  } catch (e: any) {
    console.error("[sync-contract-status] sheet fetch error:", e?.message);
    return null;
  }
}

/**
 * GET — 現在の状態のサマリー。
 * 「今どうなっているか」が画面に常に出ていないと、
 * 同期を実行した結果が正しいのか判断できない。
 */
export async function GET(request: NextRequest) {
  const r = await requireRole(request, ["president", "executive", "manager"]);
  if (r.error) return r.error;

  const sb = getSupabase();
  const countOf = async (build: (q: any) => any) => {
    const { count } = await build(sb.from("shops").select("*", { count: "exact", head: true }));
    return count || 0;
  };

  const [total, cancelled, paused, rankDisabled] = await Promise.all([
    countOf((q: any) => q),
    countOf((q: any) => q.not("cancelled_at", "is", null)),
    countOf((q: any) => q.is("cancelled_at", null).not("paused_at", "is", null)),
    countOf((q: any) => q.eq("rank_tracking_disabled", true)),
  ]);

  return NextResponse.json({
    counts: { total, cancelled, paused, active: total - cancelled - paused, rankDisabled },
  });
}

export const POST = withAudit("契約ステータス同期", "DATA_OP", async (request, ctx) => {
  const body = await request.json().catch(() => ({}));
  const apply = body?.apply === true;
  const force = body?.force === true;

  const rawRows = await fetchMasterRows();
  if (!rawRows) {
    return NextResponse.json(
      { error: "MEOマスタを取得できませんでした。シートの共有設定を確認してください" },
      { status: 502 },
    );
  }
  if (rawRows.length < MIN_EXPECTED_ROWS) {
    // 空や壊れたシートで全店舗を解約にしてしまう事故を防ぐ
    return NextResponse.json(
      { error: `MEOマスタの行数が異常に少ないため中断しました（${rawRows.length}行）` },
      { status: 500 },
    );
  }

  const master = parseMasterCsv(rawRows);
  if (master.length === 0) {
    return NextResponse.json({ error: "MEOマスタから有効な行を読み取れませんでした" }, { status: 500 });
  }

  const supabase = getSupabase();
  // PostgRESTの1000行上限を避けてページングで全件取得
  const shops: DbShop[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("shops")
      .select("id, name, cancelled_at, paused_at")
      .order("id")
      .range(from, from + 999);
    if (error) {
      console.error("[sync-contract-status] shops select failed:", error.message);
      return NextResponse.json(
        { error: "店舗の取得に失敗しました", _error: error.message },
        { status: 500 },
      );
    }
    if (!data || data.length === 0) break;
    shops.push(...(data as DbShop[]));
    if (data.length < 1000) break;
  }

  const diff = diffContractStatus(master, shops);
  const summary = {
    masterRows: master.length,
    dbShops: shops.length,
    changes: diff.changes.length,
    cancelled: diff.changes.filter((c) => c.to === "cancelled").length,
    paused: diff.changes.filter((c) => c.to === "paused").length,
    reactivated: diff.changes.filter((c) => c.to === "active").length,
    unmatched: diff.unmatched.length,
    duplicatedInMaster: diff.duplicatedInMaster.length,
    duplicatedInDb: diff.duplicatedInDb.length,
  };

  if (!apply) {
    ctx.detail = `dry-run: 変更予定${summary.changes}件（解約${summary.cancelled}/停止${summary.paused}/復活${summary.reactivated}）`;
    return NextResponse.json({ dryRun: true, summary, ...diff });
  }

  if (shops.length > 0 && diff.changes.length / shops.length > MAX_CHANGE_RATIO && !force) {
    return NextResponse.json(
      {
        error: `変更対象が全店舗の${Math.round((diff.changes.length / shops.length) * 100)}%と多すぎます。内容を確認のうえ force:true で再実行してください`,
        summary,
        ...diff,
      },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  const failed: { shopName: string; error: string }[] = [];
  let updated = 0;
  for (const c of diff.changes) {
    const { error } = await supabase
      .from("shops")
      .update(statusToColumns(c.to, now))
      .eq("id", c.shopId);
    if (error) {
      // 握りつぶすと「反映したつもり」で食い違う
      failed.push({ shopName: c.shopName, error: error.message });
    } else {
      updated++;
    }
  }

  ctx.detail = `${updated}件更新（解約${summary.cancelled}/停止${summary.paused}/復活${summary.reactivated}）${failed.length > 0 ? ` / 失敗${failed.length}件` : ""}`;
  return NextResponse.json({
    dryRun: false,
    summary: { ...summary, updated, failed: failed.length },
    changes: diff.changes,
    failed,
    unmatched: diff.unmatched,
    duplicatedInMaster: diff.duplicatedInMaster,
    duplicatedInDb: diff.duplicatedInDb,
  });
});
