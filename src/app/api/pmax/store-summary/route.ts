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

  // 月次データを取得
  const { data: rows, error } = await sb
    .from("pmax_store_data")
    .select("shop_name, language, impressions, clicks, cost_micros, account_id")
    .eq("month", month);

  if (error) {
    console.error("[pmax/store-summary] DB error:", error.message);
    return NextResponse.json({ error: "データ取得に失敗しました" }, { status: 500 });
  }

  // 店舗名でグループ化
  const storeMap = new Map<string, {
    languages: Set<string>;
    impressions: number;
    clicks: number;
    costMicros: number;
    accountIds: Set<string>;
  }>();

  for (const row of rows || []) {
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

  // 同期ログ取得（最終同期日時を返す）
  const { data: syncLogs } = await sb
    .from("pmax_sync_log")
    .select("synced_at")
    .eq("month", month)
    .eq("status", "success")
    .order("synced_at", { ascending: false })
    .limit(1);

  return NextResponse.json({
    stores,
    month,
    lastSyncedAt: syncLogs?.[0]?.synced_at || null,
  });
}
