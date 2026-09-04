/**
 * POST /api/report/sync-contract-status
 * MEO顧客管理（スプレッドシート）の契約ステータスを shops に反映する。
 *   ステータス列: 契約中 / 解約 / 停止中（空欄は無視＝現状維持）
 *   店舗名列: 店舗名（shops.name または GBP現在名 gbp_shop_name と正規化完全一致で照合）
 *   載っていない店舗 → 順位計測の対象外（rank_tracking_reason='master'）＝顧客マスタの「MEOマスタ記載なし」
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
  parseMasterCsvDetailed,
  normalizeShopName,
  diffContractStatus,
  diffRankTracking,
  statusToColumns,
  type DbShop,
} from "@/lib/shop-status";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * 契約ステータスの正（2026-09-04〜）: 「MEO顧客管理」シートの K列=ステータス / L列=店舗名。
 * 元シート(1zZ2w8nz…)は非公開でサーバーから読めないため、リンク閲覧可の
 * 「Chubbyシートまとめ」に IMPORTRANGE/値貼付した「元データ」タブ（A列=ステータス / B列=店舗名、
 * 1行目=タイトル、2行目=ヘッダー）を参照する。列位置は parseMasterCsvDetailed がヘッダーから自動判定する。
 * ここに載っていない店舗は「マスタ記載なし」として順位計測の対象外にする。
 * 旧: MEOマスタ 1voRfgPYkhV7BbK3Y58q8r8FMrQaA20MY8YUJXAXE42s gid=1937358659（A:顧客ID/B:ステータス/C:店舗名）
 */
const MASTER_SHEET_ID = "1fREtiHUO-PSfkWmrrFTbXmE9xswTjBAO-ljw5Vr0hio";
const MASTER_GID = "1875509990"; // 元データ タブ
// route ファイルは GET/POST 等しか export できないため const に留め、GET の応答で返す
const MASTER_SHEET_URL = `https://docs.google.com/spreadsheets/d/${MASTER_SHEET_ID}/edit?gid=${MASTER_GID}#gid=${MASTER_GID}`;
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
  // 範囲はA列〜C列の全行（行数を固定すると新規店が「マスタ未掲載」＝計測対象外と誤判定される）。
  // 新レイアウトは A=ステータス / B=店舗名 なので A:C で足りる。旧レイアウト(B/C)にも対応
  const url = `https://docs.google.com/spreadsheets/d/${MASTER_SHEET_ID}/gviz/tq?tqx=out:csv&gid=${MASTER_GID}&range=A:C`;
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
    const { count } = await build(sb.from("shops").select("*", { count: "exact", head: true }).is("deleted_at", null));
    return count || 0;
  };

  const [total, cancelled, paused, rankDisabled, unlisted] = await Promise.all([
    countOf((q: any) => q),
    countOf((q: any) => q.not("cancelled_at", "is", null)),
    countOf((q: any) => q.is("cancelled_at", null).not("paused_at", "is", null)),
    countOf((q: any) => q.eq("rank_tracking_disabled", true)),
    // マスタ記載なし＝マスタ由来で対象外、かつ解約でも停止中でもない
    countOf((q: any) =>
      q.eq("rank_tracking_disabled", true).eq("rank_tracking_reason", "master")
        .is("cancelled_at", null).is("paused_at", null)),
  ]);

  return NextResponse.json({
    counts: { total, cancelled, paused, active: total - cancelled - paused, rankDisabled, unlisted },
    masterSheetUrl: MASTER_SHEET_URL,
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

  const { rows: master, unknownStatus, blankStatus } = parseMasterCsvDetailed(rawRows);
  if (master.length === 0) {
    return NextResponse.json({ error: "MEOマスタから有効な行を読み取れませんでした" }, { status: 500 });
  }
  // 解析できた行が極端に少ない場合も中断する。
  // 行数(MIN_EXPECTED_ROWS)だけ見ていると、B列の内容が壊れて全行が
  // 「未知ステータス」になっても素通りし、全店舗が計測停止になる
  if (master.length < MIN_EXPECTED_ROWS) {
    return NextResponse.json(
      {
        error: `ステータスを解釈できた行が${master.length}件しかありません（ステータス列の表記をご確認ください）`,
        unknownStatus: unknownStatus.slice(0, 30),
      },
      { status: 500 },
    );
  }

  // ステータスを解釈できなかった店舗は、順位計測の判定から除外する。
  // 「マスタ未掲載」と同じ扱いにすると、表記ゆれ1つで契約中の店の計測が止まる
  // ステータス空欄の行も現状維持（「空欄は無視」= マスタ未掲載として計測を止めない）
  const unknownNames = new Set([
    ...unknownStatus.map((u) => normalizeShopName(u.shopName)),
    ...blankStatus.map((n) => normalizeShopName(n)),
  ]);

  const supabase = getSupabase();
  // PostgRESTの1000行上限を避けてページングで全件取得
  const shops: DbShop[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("shops")
      .select("id, name, gbp_shop_name, cancelled_at, paused_at, rank_tracking_disabled, rank_tracking_reason")
      .is("deleted_at", null)
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
  // 「マスタに契約中として載っている店舗だけ順位計測する」方針の適用差分。
  // 手動指定（エミナル等）は触らない
  const rankChanges = diffRankTracking(master, shops, unknownNames);
  const rankDisable = rankChanges.filter((c) => c.disable);
  const rankEnable = rankChanges.filter((c) => !c.disable);

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
    rankDisable: rankDisable.length,
    rankEnable: rankEnable.length,
    unlistedDisable: rankDisable.filter((c) => c.detail === "マスタ未掲載").length,
    blankStatus: blankStatus.length,
  };

  if (!apply) {
    ctx.detail = `dry-run: 契約${summary.changes}件 / 計測対象外化${summary.rankDisable}件`;
    return NextResponse.json({ dryRun: true, summary, ...diff, rankChanges, unknownStatus, blankStatus });
  }

  // 比率ガードは契約ステータスだけでなく順位計測の停止にも掛ける。
  // 掛けないと、マスタの解析が少し劣化しただけで全店舗が一撃で計測停止になる
  // （diffRankTracking は「マスタ未掲載＝対象外」のため）。
  if (shops.length > 0 && !force) {
    const contractPct = (diff.changes.length / shops.length) * 100;
    const rankPct = (rankDisable.length / shops.length) * 100;
    if (contractPct > MAX_CHANGE_RATIO * 100 || rankPct > MAX_CHANGE_RATIO * 100) {
      const reasons: string[] = [];
      if (contractPct > MAX_CHANGE_RATIO * 100) reasons.push(`契約ステータスの変更が${Math.round(contractPct)}%`);
      if (rankPct > MAX_CHANGE_RATIO * 100) reasons.push(`順位計測の対象外化が${Math.round(rankPct)}%`);
      return NextResponse.json(
        {
          // 409でも画面が「確認しました」と誤表示しないよう dryRun を明示する
          dryRun: true,
          error: `${reasons.join("、")}と多すぎます。内容を確認のうえ「強制的に適用」で再実行してください`,
          summary,
          ...diff,
          rankChanges,
        },
        { status: 409 },
      );
    }
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

  // 順位計測フラグの更新（100件ずつ。手動指定は diffRankTracking が除外済み）
  let rankUpdated = 0;
  const applyRank = async (ids: string[], disabled: boolean, reason: string | null) => {
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const { error } = await supabase
        .from("shops")
        .update({ rank_tracking_disabled: disabled, rank_tracking_reason: reason })
        .in("id", chunk);
      if (error) {
        for (const id of chunk) {
          failed.push({ shopName: id, error: `順位計測フラグ: ${error.message}` });
        }
      } else {
        rankUpdated += chunk.length;
      }
    }
  };
  await applyRank(rankDisable.map((c) => c.shopId), true, "master");
  await applyRank(rankEnable.map((c) => c.shopId), false, null);

  ctx.detail = `契約${updated}件 / 計測対象外化${rankDisable.length}件 / 計測対象へ復帰${rankEnable.length}件${failed.length > 0 ? ` / 失敗${failed.length}件` : ""}`;
  return NextResponse.json({
    dryRun: false,
    summary: { ...summary, updated, rankUpdated, failed: failed.length },
    changes: diff.changes,
    rankChanges,
    failed,
    unmatched: diff.unmatched,
    duplicatedInMaster: diff.duplicatedInMaster,
    duplicatedInDb: diff.duplicatedInDb,
  });
});
