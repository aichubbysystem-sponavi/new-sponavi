/**
 * POST /api/pmax/sync
 * 全店舗のP-MAXデータを一括取得→DB保存
 * body: { month: "YYYY-MM" }
 *
 * 設計: listAccounts→getCampaignMonthly×全アカウント→getCampaignDaily×全アカウント
 * の計~60 API呼び出しで全店舗分を取得（バッチ分割不要）
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabase, requireRole } from "@/lib/supabase";
import {
  listAccounts,
  getCampaignMonthly,
  getCampaignDaily,
  parseCampaignName,
} from "@/lib/google-ads";
import { getGbpDataForShop, type PmaxGbpRow } from "@/lib/pmax-sheet";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** 429エラー時のリトライ（指数バックオフ） */
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  const delays = [3000, 8000, 15000];
  for (let i = 0; i <= delays.length; i++) {
    try {
      return await fn();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const is429 = msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED");
      if (is429 && i < delays.length) {
        console.log(`[pmax/sync] ${label} 429 retry ${i + 1}/${delays.length}, waiting ${delays[i]}ms`);
        await new Promise(r => setTimeout(r, delays[i]));
        continue;
      }
      throw e;
    }
  }
  throw new Error("unreachable");
}

export async function POST(request: NextRequest) {
  const r = await requireRole(request, ["president", "manager"]);
  if (r.error) return r.error;

  let body: { month?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "不正なリクエスト" }, { status: 400 });
  }

  const { month } = body;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "month は YYYY-MM 形式で指定してください" }, { status: 400 });
  }

  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const mon = Number(monthStr);
  const startDate = `${year}-${String(mon).padStart(2, "0")}-01`;
  const lastDay = new Date(year, mon, 0).getDate();
  const endDate = `${year}-${String(mon).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const sb = getSupabase();

  try {
  // 1. アカウント一覧取得（1 API呼び出し）
  const accounts = await withRetry(() => listAccounts(), "listAccounts");
  console.log(`[pmax/sync] ${accounts.length} accounts found`);

  // 2. 全アカウントの月次+日次データを並列取得（10アカウントずつ）
  type ParsedRow = {
    shopName: string;
    language: string;
    accountId: string;
    campaignName: string;
    campaignId: string;
    month?: string;
    date?: string;
    impressions: number;
    clicks: number;
    ctr: number;
    averageCpc: number;
    costMicros: number;
  };

  const allMonthly: ParsedRow[] = [];
  const allDaily: ParsedRow[] = [];
  const BATCH = 10;

  for (let i = 0; i < accounts.length; i += BATCH) {
    const batch = accounts.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(async (a) => {
        const [m, d] = await Promise.all([
          withRetry(() => getCampaignMonthly(a.customerId, startDate, endDate), `monthly:${a.customerId}`).catch(() => []),
          withRetry(() => getCampaignDaily(a.customerId, startDate, endDate), `daily:${a.customerId}`).catch(() => []),
        ]);
        return { accountId: a.customerId, monthly: m, daily: d };
      })
    );
    for (const res of results) {
      if (res.status !== "fulfilled") continue;
      const { accountId, monthly, daily } = res.value;
      for (const c of monthly) {
        const parsed = parseCampaignName(c.campaignName);
        allMonthly.push({ ...c, shopName: parsed.shopName, language: parsed.language, accountId });
      }
      for (const c of daily) {
        const parsed = parseCampaignName(c.campaignName);
        allDaily.push({ ...c, shopName: parsed.shopName, language: parsed.language, accountId });
      }
    }
    // バッチ間で少し待機（レート制限対策）
    if (i + BATCH < accounts.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  console.log(`[pmax/sync] Fetched: ${allMonthly.length} monthly, ${allDaily.length} daily rows`);

  // 3. 対象月の既存データを一括削除
  await sb.from("pmax_store_data").delete().eq("month", month);
  await sb.from("pmax_store_daily").delete().gte("date", startDate).lte("date", endDate);

  // 4. 月次データ一括挿入
  const insertErrors: string[] = [];
  if (allMonthly.length > 0) {
    const rows = allMonthly.map((c) => ({
      shop_name: c.shopName,
      language: c.language,
      month,
      campaign_name: c.campaignName,
      campaign_id: c.campaignId,
      impressions: c.impressions,
      clicks: c.clicks,
      ctr: c.ctr,
      average_cpc: c.averageCpc,
      cost_micros: c.costMicros,
      account_id: c.accountId,
      synced_at: new Date().toISOString(),
    }));
    for (let j = 0; j < rows.length; j += 100) {
      const { error } = await sb.from("pmax_store_data").insert(rows.slice(j, j + 100));
      if (error) {
        console.error("[pmax/sync] monthly insert:", error.message);
        insertErrors.push(error.message);
      }
    }
  }

  // 5. 日次データ一括挿入
  if (allDaily.length > 0) {
    const rows = allDaily.map((c) => ({
      shop_name: c.shopName,
      language: c.language,
      date: c.date,
      campaign_name: c.campaignName,
      campaign_id: c.campaignId,
      impressions: c.impressions,
      clicks: c.clicks,
      ctr: c.ctr,
      average_cpc: c.averageCpc,
      cost_micros: c.costMicros,
      account_id: c.accountId,
      synced_at: new Date().toISOString(),
    }));
    for (let j = 0; j < rows.length; j += 100) {
      const { error } = await sb.from("pmax_store_daily").insert(rows.slice(j, j + 100));
      if (error) {
        console.error("[pmax/sync] daily insert:", error.message);
        insertErrors.push(error.message);
      }
    }
  }

  // 6. GBPデータ一括同期（スプレッドシートから全店舗分を1回で取得）
  const gbpMonthKey = `${year}/${String(mon).padStart(2, "0")}`;
  const shopNames = Array.from(new Set(allMonthly.map((r) => r.shopName)));
  let gbpSynced = 0;

  // スプレッドシートは1回取得でキャッシュされるので、全店舗分をまとめて処理
  for (const name of shopNames) {
    try {
      const gbpRows: PmaxGbpRow[] = await getGbpDataForShop(name, gbpMonthKey);
      if (gbpRows.length > 0) {
        const row = gbpRows[0];
        await sb.from("pmax_gbp_data").upsert({
          shop_name: name,
          month: gbpMonthKey,
          total_impressions: row.totalImpressions,
          total_visits: row.totalVisits,
          phone: row.phone,
          directions: row.directions,
          website: row.website,
          menu_clicks: row.menuClicks,
          save_share: row.saveShare,
          synced_at: new Date().toISOString(),
        }, { onConflict: "shop_name,month" });
        gbpSynced++;
      }
    } catch {}
  }

  // 7. 同期ログ（月単位で1レコード）
  await sb.from("pmax_sync_log").upsert({
    shop_name: "__all__",
    month,
    synced_by: r.sub || null,
    synced_at: new Date().toISOString(),
    status: insertErrors.length === 0 ? "success" : "partial",
    message: insertErrors.length > 0 ? insertErrors.slice(0, 3).join("; ") : null,
  }, { onConflict: "shop_name,month" });

  // 8. 検証
  const { count } = await sb
    .from("pmax_store_data")
    .select("*", { count: "exact", head: true })
    .eq("month", month);

  return NextResponse.json({
    success: insertErrors.length === 0,
    shops: shopNames.length,
    monthlyRows: allMonthly.length,
    dailyRows: allDaily.length,
    gbpSynced,
    dbCount: count,
    insertErrors: insertErrors.length > 0 ? insertErrors : undefined,
  });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[pmax/sync] Fatal error:", msg);
    return NextResponse.json({ error: `同期失敗: ${msg.slice(0, 300)}` }, { status: 500 });
  }
}
