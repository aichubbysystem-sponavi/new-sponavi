import { NextRequest, NextResponse } from "next/server";
import { getSupabase, requireRole } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * GET /api/pmax/store-summary?month=YYYY-MM
 * Supabaseから店舗別サマリーを返す（Google Ads APIは呼ばない）
 */
export async function GET(request: NextRequest) {
  const r = await requireRole(request, ["president", "manager"]);
  if (r.error) return r.error;

  const { searchParams } = request.nextUrl;
  const month = searchParams.get("month");

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "month は YYYY-MM 形式で指定してください" }, { status: 400 });
  }

  const sb = getSupabase();

  // PostgREST .eq() の不安定動作を回避: 全件取得+JSフィルタ
  const { data: allRows, error } = await sb
    .from("pmax_store_data")
    .select("shop_name, language, month, impressions, clicks, cost_micros, account_id")
    .limit(50000);

  if (error) {
    console.error("[pmax/store-summary] DB error:", error.message);
    return NextResponse.json({ error: "データ取得に失敗しました" }, { status: 500 });
  }

  const rows = (allRows || []).filter((r) => r.month === month);
  console.log(`[pmax/store-summary] month=${month}, allRows=${allRows?.length || 0}, filtered=${rows.length}`);

  // 店舗名でグループ化
  const storeMap = new Map<string, {
    languages: Set<string>;
    impressions: number;
    clicks: number;
    costMicros: number;
    accountIds: Set<string>;
  }>();

  for (const row of rows) {
    const existing = storeMap.get(row.shop_name);
    if (existing) {
      existing.languages.add(row.language);
      existing.impressions += Number(row.impressions || 0);
      existing.clicks += Number(row.clicks || 0);
      existing.costMicros += Number(row.cost_micros || 0);
      if (row.account_id) existing.accountIds.add(row.account_id);
    } else {
      storeMap.set(row.shop_name, {
        languages: new Set([row.language]),
        impressions: Number(row.impressions || 0),
        clicks: Number(row.clicks || 0),
        costMicros: Number(row.cost_micros || 0),
        accountIds: new Set(row.account_id ? [row.account_id] : []),
      });
    }
  }

  const stores = Array.from(storeMap.entries())
    .map(([shopName, v]) => ({
      shopName,
      languages: Array.from(v.languages).sort(),
      impressions: v.impressions,
      clicks: v.clicks,
      costMicros: v.costMicros,
      accountIds: Array.from(v.accountIds),
    }))
    .sort((a, b) => b.impressions - a.impressions);

  // 同期ログ取得
  const { data: allSyncLogs } = await sb
    .from("pmax_sync_log")
    .select("synced_at, month, status")
    .limit(10000);

  const lastSync = (allSyncLogs || [])
    .filter((l) => l.month === month && l.status === "success")
    .sort((a, b) => b.synced_at.localeCompare(a.synced_at))[0];

  return NextResponse.json({
    stores,
    month,
    totalDbRows: allRows?.length || 0,
    filteredRows: rows.length,
    lastSyncedAt: lastSync?.synced_at || null,
  });
}
