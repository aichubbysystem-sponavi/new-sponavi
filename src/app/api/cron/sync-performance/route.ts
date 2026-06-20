/**
 * GET /api/cron/sync-performance
 * 全店舗のパフォーマンスメトリクスをGBP APIから一括同期
 * Vercel Cron: 毎月5日 6:00 JST (UTC 21:00) — 検索語句の1時間後
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabase, verifyCron } from "@/lib/supabase";
import { syncShopPerformance } from "@/lib/gbp-performance";
import { getExpectedMonthJST } from "@/lib/gbp-search-keywords";

export const dynamic = "force-dynamic";
export const maxDuration = 300;


export async function GET(request: NextRequest) {
  const cronErr = verifyCron(request);
  if (cronErr) return cronErr;

  const supabase = getSupabase();
  const expectedMonth = getExpectedMonthJST();
  const startTime = Date.now();
  const TIME_LIMIT = 270_000;

  // 1. GBP設定済みの全店舗を取得（解約店舗を除外）
  const { data: shops, error } = await supabase
    .from("shops")
    .select("id, name, gbp_location_name")
    .not("gbp_location_name", "is", null)
    .neq("gbp_location_name", "")
    .is("cancelled_at", null);

  if (error || !shops || shops.length === 0) {
    return NextResponse.json({ error: "No shops found" }, { status: 200 });
  }

  // force=true で当月同期済みもスキップせず全店舗再同期
  const forceAll = request.nextUrl.searchParams.get("force") === "true";

  // 2. 既に当月同期済みをスキップ（forceでない場合）
  let syncedShopIds = new Set<string>();
  if (!forceAll) {
    const { data: cacheData } = await supabase
      .from("performance_metrics_cache")
      .select("shop_id")
      .eq("month", expectedMonth);
    syncedShopIds = new Set((cacheData || []).map(c => c.shop_id));
  }

  // 3. 重複排除
  const seenLocations = new Set<string>();
  const targets: typeof shops = [];
  for (const shop of shops) {
    if (!forceAll && syncedShopIds.has(shop.id)) continue;
    if (seenLocations.has(shop.gbp_location_name)) continue;
    seenLocations.add(shop.gbp_location_name);
    targets.push(shop);
  }

  let synced = 0, skipped = 0, failed = 0;
  const errors: string[] = [];

  for (const shop of targets) {
    if (Date.now() - startTime > TIME_LIMIT) break;

    try {
      const result = await syncShopPerformance(shop.id, shop.name, shop.gbp_location_name);
      if (result.success) {
        synced++;
      } else {
        skipped++;
      }
    } catch (e: any) {
      failed++;
      errors.push(`${shop.name}: ${e?.message || "unknown"}`);
    }
  }

  return NextResponse.json({
    success: true,
    total: shops.length,
    alreadySynced: syncedShopIds.size,
    targets: targets.length,
    synced, skipped, failed,
    errors: errors.slice(0, 10),
    expectedMonth,
  });
}
