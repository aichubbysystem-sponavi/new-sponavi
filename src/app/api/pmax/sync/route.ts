/**
 * POST /api/pmax/sync
 * 指定店舗+月のP-MAXデータをGoogle Ads APIから取得→Supabaseに保存
 * body: { shopNames: string[], month: string (YYYY-MM) }
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabase, requireRole } from "@/lib/supabase";
import {
  listAccounts,
  getCampaignMonthly,
  getCampaignDaily,
  parseCampaignName,
} from "@/lib/google-ads";
import { getGbpDataForShop } from "@/lib/pmax-sheet";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const r = await requireRole(request, ["president", "manager"]);
  if (r.error) return r.error;

  let body: { shopNames?: string[]; month?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "不正なリクエスト" }, { status: 400 });
  }

  const { shopNames, month } = body;
  if (!shopNames || !Array.isArray(shopNames) || shopNames.length === 0) {
    return NextResponse.json({ error: "shopNames は1つ以上指定してください" }, { status: 400 });
  }
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "month は YYYY-MM 形式で指定してください" }, { status: 400 });
  }

  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const mon = Number(monthStr) - 1;
  const startDate = new Date(year, mon, 1).toISOString().split("T")[0];
  const endDate = new Date(year, mon + 1, 0).toISOString().split("T")[0];

  const sb = getSupabase();
  const shopNameSet = new Set(shopNames);

  // 1. 全アカウントのキャンペーンデータを取得
  const accounts = await listAccounts();
  const BATCH = 10;

  type CampaignRow = {
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

  const allMonthly: CampaignRow[] = [];
  const allDaily: CampaignRow[] = [];

  for (let i = 0; i < accounts.length; i += BATCH) {
    const batch = accounts.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(async (a) => {
        const [m, d] = await Promise.all([
          getCampaignMonthly(a.customerId, startDate, endDate).catch(() => []),
          getCampaignDaily(a.customerId, startDate, endDate).catch(() => []),
        ]);
        return {
          monthly: m.map((c) => ({ accountId: a.customerId, ...c })),
          daily: d.map((c) => ({ accountId: a.customerId, ...c })),
        };
      })
    );
    for (const res of results) {
      if (res.status !== "fulfilled") continue;
      allMonthly.push(...res.value.monthly);
      allDaily.push(...res.value.daily);
    }
  }

  // 2. 対象店舗のデータだけフィルタ
  const monthlyRows = allMonthly
    .map((c) => {
      const parsed = parseCampaignName(c.campaignName);
      return { ...c, shopName: parsed.shopName, language: parsed.language };
    })
    .filter((c) => shopNameSet.has(c.shopName));

  const dailyRows = allDaily
    .map((c) => {
      const parsed = parseCampaignName(c.campaignName);
      return { ...c, shopName: parsed.shopName, language: parsed.language };
    })
    .filter((c) => shopNameSet.has(c.shopName));

  // 3. 既存データを削除してから挿入（対象店舗+月のみ）
  for (const name of shopNames) {
    await sb.from("pmax_store_data").delete().eq("shop_name", name).eq("month", month);
    await sb.from("pmax_store_daily").delete().eq("shop_name", name).gte("date", startDate).lte("date", endDate);
  }

  // 4. 月次データ挿入
  if (monthlyRows.length > 0) {
    const insertRows = monthlyRows.map((c) => ({
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
    for (let j = 0; j < insertRows.length; j += 50) {
      const { error } = await sb.from("pmax_store_data").insert(insertRows.slice(j, j + 50));
      if (error) console.error("[pmax/sync] monthly insert error:", error.message);
    }
  }

  // 5. 日次データ挿入
  if (dailyRows.length > 0) {
    const insertRows = dailyRows.map((c) => ({
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
    for (let j = 0; j < insertRows.length; j += 50) {
      const { error } = await sb.from("pmax_store_daily").insert(insertRows.slice(j, j + 50));
      if (error) console.error("[pmax/sync] daily insert error:", error.message);
    }
  }

  // 6. GBPデータ同期（スプレッドシートから取得→DB保存）
  const gbpMonthKey = `${year}/${String(mon + 1).padStart(2, "0")}`; // "2026/06" 形式（シート準拠）
  let gbpSynced = 0;
  for (const name of shopNames) {
    try {
      const gbpRows = await getGbpDataForShop(name, gbpMonthKey);
      if (gbpRows.length > 0) {
        const row = gbpRows[0]; // 1店舗1月に1行
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
    } catch (e: unknown) {
      console.error(`[pmax/sync] GBP sync error (${name}):`, e instanceof Error ? e.message : e);
    }
  }

  // 7. 同期ログ記録
  const syncedShops = new Set(monthlyRows.map((r) => r.shopName));
  const notFound = shopNames.filter((n) => !syncedShops.has(n));

  for (const name of shopNames) {
    await sb.from("pmax_sync_log").upsert(
      {
        shop_name: name,
        month,
        synced_by: r.sub || null,
        synced_at: new Date().toISOString(),
        status: syncedShops.has(name) ? "success" : "no_data",
        message: syncedShops.has(name) ? null : "Google Adsにデータなし",
      },
      { onConflict: "shop_name,month" }
    );
  }

  return NextResponse.json({
    success: true,
    synced: syncedShops.size,
    monthlyRows: monthlyRows.length,
    dailyRows: dailyRows.length,
    gbpSynced,
    notFound,
  });
}
