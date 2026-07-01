/**
 * POST /api/pmax/sync
 * 全店舗のP-MAXデータを一括取得→DB保存
 * body: { month: "YYYY-MM", forceFullScan?: boolean }
 *
 * 最適化: pmax_account_mappingにP-MAXキャンペーンがあるアカウントを記録
 * 初回: 全アカウントスキャン（~293回）→マッピング保存
 * 2回目以降: マッピング済みアカウントのみ（~50回）
 * forceFullScan=true で全アカウント再スキャン
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabase, requireRole } from "@/lib/supabase";
import {
  listAccounts,
  getCampaignMonthly,
  parseCampaignName,
} from "@/lib/google-ads";
import { getGbpDataForShop, type PmaxGbpRow } from "@/lib/pmax-sheet";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  const delays = [3000, 8000, 15000];
  for (let i = 0; i <= delays.length; i++) {
    try {
      return await fn();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if ((msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) && i < delays.length) {
        console.log(`[pmax/sync] ${label} 429 retry ${i + 1}, wait ${delays[i]}ms`);
        await new Promise(r => setTimeout(r, delays[i]));
        continue;
      }
      throw e;
    }
  }
  throw new Error("unreachable");
}

type ParsedRow = {
  shopName: string;
  language: string;
  accountId: string;
  campaignName: string;
  campaignId: string;
  month?: string;
  impressions: number;
  clicks: number;
  ctr: number;
  averageCpc: number;
  costMicros: number;
};

export async function POST(request: NextRequest) {
  const r = await requireRole(request, ["president", "manager"]);
  if (r.error) return r.error;

  let body: { month?: string; forceFullScan?: boolean };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "不正なリクエスト" }, { status: 400 }); }

  const { month, forceFullScan } = body;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "month は YYYY-MM 形式" }, { status: 400 });
  }

  const [, monthStr] = month.split("-");
  const year = Number(month.split("-")[0]);
  const mon = Number(monthStr);
  const startDate = `${month}-01`;
  const lastDay = new Date(year, mon, 0).getDate();
  const endDate = `${month}-${String(lastDay).padStart(2, "0")}`;

  const sb = getSupabase();

  try {

  // ── Step 1: 対象アカウントを決定 ──
  let targetAccountIds: string[] = [];
  let isFullScan = false;

  if (!forceFullScan) {
    // DBからマッピング済みアカウントIDを取得
    const { data: mappings } = await sb
      .from("pmax_account_mapping")
      .select("account_id")
      .limit(1000);

    if (mappings && mappings.length > 0) {
      targetAccountIds = Array.from(new Set(mappings.map((m: { account_id: string }) => m.account_id)));
      console.log(`[pmax/sync] Using cached mapping: ${targetAccountIds.length} accounts (skip full scan)`);
    }
  }

  if (targetAccountIds.length === 0) {
    // マッピングなし or forceFullScan → 全アカウントスキャン
    isFullScan = true;
    const accounts = await withRetry(() => listAccounts(), "listAccounts");
    targetAccountIds = accounts.map(a => a.customerId);
    console.log(`[pmax/sync] Full scan: ${targetAccountIds.length} accounts`);
  }

  // ── Step 2: 月次データ取得 ──
  const allMonthly: ParsedRow[] = [];
  const BATCH = 15;

  for (let i = 0; i < targetAccountIds.length; i += BATCH) {
    const batch = targetAccountIds.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(async (accId) => {
        const m = await withRetry(
          () => getCampaignMonthly(accId, startDate, endDate),
          `m:${accId}`
        ).catch(() => []);
        return { accountId: accId, monthly: m };
      })
    );
    for (const res of results) {
      if (res.status !== "fulfilled") continue;
      for (const c of res.value.monthly) {
        const parsed = parseCampaignName(c.campaignName);
        allMonthly.push({ ...c, shopName: parsed.shopName, language: parsed.language, accountId: res.value.accountId });
      }
    }
    if (i + BATCH < targetAccountIds.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  console.log(`[pmax/sync] ${allMonthly.length} rows from ${targetAccountIds.length} accounts`);

  // ── Step 3: アカウントマッピング保存（フルスキャン時のみ） ──
  if (isFullScan && allMonthly.length > 0) {
    const mappingRows = allMonthly.map(r => ({
      account_id: r.accountId,
      shop_name: r.shopName,
    }));
    // 重複排除
    const seen = new Set<string>();
    const unique = mappingRows.filter(r => {
      const key = `${r.account_id}:${r.shop_name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // 既存マッピングを削除して再作成
    await sb.from("pmax_account_mapping").delete().neq("account_id", "");
    for (let j = 0; j < unique.length; j += 100) {
      await sb.from("pmax_account_mapping").insert(unique.slice(j, j + 100));
    }
    console.log(`[pmax/sync] Saved ${unique.length} account→shop mappings`);
  }

  // ── Step 4: DB保存 ──
  await sb.from("pmax_store_data").delete().eq("month", month);

  const insertErrors: string[] = [];
  if (allMonthly.length > 0) {
    const rows = allMonthly.map(c => ({
      shop_name: c.shopName, language: c.language, month,
      campaign_name: c.campaignName, campaign_id: c.campaignId,
      impressions: c.impressions, clicks: c.clicks, ctr: c.ctr,
      average_cpc: c.averageCpc, cost_micros: c.costMicros,
      account_id: c.accountId, synced_at: new Date().toISOString(),
    }));
    for (let j = 0; j < rows.length; j += 100) {
      const { error } = await sb.from("pmax_store_data").insert(rows.slice(j, j + 100));
      if (error) { insertErrors.push(error.message); }
    }
  }

  // ── Step 5: GBP同期 ──
  const gbpMonthKey = `${year}/${String(mon).padStart(2, "0")}`;
  const shopNames = Array.from(new Set(allMonthly.map(r => r.shopName)));
  let gbpSynced = 0;
  for (const name of shopNames) {
    try {
      const gbpRows: PmaxGbpRow[] = await getGbpDataForShop(name, gbpMonthKey);
      if (gbpRows.length > 0) {
        await sb.from("pmax_gbp_data").upsert({
          shop_name: name, month: gbpMonthKey,
          total_impressions: gbpRows[0].totalImpressions, total_visits: gbpRows[0].totalVisits,
          phone: gbpRows[0].phone, directions: gbpRows[0].directions, website: gbpRows[0].website,
          menu_clicks: gbpRows[0].menuClicks, save_share: gbpRows[0].saveShare,
          synced_at: new Date().toISOString(),
        }, { onConflict: "shop_name,month" });
        gbpSynced++;
      }
    } catch {}
  }

  // ── Step 6: ログ ──
  await sb.from("pmax_sync_log").upsert({
    shop_name: "__all__", month, synced_by: r.sub || null,
    synced_at: new Date().toISOString(),
    status: insertErrors.length === 0 ? "success" : "partial",
    message: insertErrors.length > 0 ? insertErrors.slice(0, 3).join("; ") : null,
  }, { onConflict: "shop_name,month" });

  const { count } = await sb.from("pmax_store_data").select("*", { count: "exact", head: true }).eq("month", month);

  return NextResponse.json({
    success: insertErrors.length === 0,
    shops: shopNames.length,
    monthlyRows: allMonthly.length,
    gbpSynced, dbCount: count,
    accountsQueried: targetAccountIds.length,
    isFullScan,
    insertErrors: insertErrors.length > 0 ? insertErrors : undefined,
  });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[pmax/sync] Fatal:", msg);
    if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) {
      return NextResponse.json({ error: "Google Ads APIの1日の利用上限に達しました。しばらく時間をおいてから再試行してください。" }, { status: 429 });
    }
    return NextResponse.json({ error: `同期失敗: ${msg.slice(0, 300)}` }, { status: 500 });
  }
}
