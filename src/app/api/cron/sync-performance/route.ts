/**
 * GET /api/cron/sync-performance
 * 全店舗のパフォーマンスメトリクスをGBP APIから一括同期
 * Vercel Cron: 毎月5日 6:00 JST (UTC 21:00) — 検索語句の1時間後
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { syncShopPerformance } from "@/lib/gbp-performance";
import { getExpectedMonthJST } from "@/lib/gbp-search-keywords";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const expectedMonth = getExpectedMonthJST();
  const startTime = Date.now();
  const TIME_LIMIT = 270_000;

  // 1. GBP設定済みの全店舗を取得
  const { data: shops, error } = await supabase
    .from("shops")
    .select("id, name, gbp_location_name")
    .not("gbp_location_name", "is", null)
    .neq("gbp_location_name", "");

  if (error || !shops || shops.length === 0) {
    return NextResponse.json({ error: "No shops found" }, { status: 200 });
  }

  // 2. 既に当月同期済みをスキップ
  const { data: cacheData } = await supabase
    .from("performance_metrics_cache")
    .select("shop_id")
    .eq("month", expectedMonth);

  const syncedShopIds = new Set((cacheData || []).map(c => c.shop_id));

  // 3. 重複排除
  const seenLocations = new Set<string>();
  const targets: typeof shops = [];
  for (const shop of shops) {
    if (syncedShopIds.has(shop.id)) continue;
    if (seenLocations.has(shop.gbp_location_name)) continue;
    seenLocations.add(shop.gbp_location_name);
    targets.push(shop);
  }

  let synced = 0, skipped = 0, failed = 0;
  const errors: string[] = [];

  for (const shop of targets) {
    if (Date.now() - startTime > TIME_LIMIT) break;

    try {
      const result = await syncShopPerformance(shop.id, shop.name, shop.gbp_location_name, 12);
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
