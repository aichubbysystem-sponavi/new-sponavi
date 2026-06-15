/**
 * GET /api/cron/sync-search-keywords
 * 全店舗の検索語句をGBP Performance APIから一括同期
 * Vercel Cron: 毎月5日 5:00 JST (UTC 20:00)
 *
 * v2: 共有lib使用 / 未同期+古いのみ対象 / バッチ分割（タイムアウト対策）
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { syncShopSearchKeywords, getExpectedMonthJST, compareMonths } from "@/lib/gbp-search-keywords";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

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
  const TIME_LIMIT = 750_000; // 750秒（maxDuration=800の安全マージン）

  // 1. GBP設定済みの全店舗を取得（解約店舗を除外）
  const { data: shops, error } = await supabase
    .from("shops")
    .select("id, name, gbp_location_name")
    .not("gbp_location_name", "is", null)
    .neq("gbp_location_name", "")
    .is("cancelled_at", null);

  if (error || !shops || shops.length === 0) {
    return NextResponse.json({ error: "No shops found", detail: error?.message }, { status: 200 });
  }

  // 2. 既に当月同期済みの店舗をスキップ
  const { data: cacheData } = await supabase
    .from("search_query_cache")
    .select("shop_id, month")
    .eq("month", expectedMonth);

  const syncedShopIds = new Set((cacheData || []).map(c => c.shop_id));

  // 3. 同一 gbp_location_name の重複排除（最初の1件のみ同期、結果を他にも適用）
  const seenLocations = new Map<string, string[]>(); // gbp_location_name → [shopId, ...]
  const targets: typeof shops = [];

  for (const shop of shops) {
    if (syncedShopIds.has(shop.id)) continue;
    const loc = shop.gbp_location_name;
    if (seenLocations.has(loc)) {
      seenLocations.get(loc)!.push(shop.id);
    } else {
      seenLocations.set(loc, [shop.id]);
      targets.push(shop);
    }
  }

  let synced = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  // 4. 順次処理（タイムアウト対策付き）
  for (const shop of targets) {
    if (Date.now() - startTime > TIME_LIMIT) {
      console.log(`[cron/sync-search-keywords] Time limit reached at ${synced + failed}/${targets.length}`);
      break;
    }

    try {
      const result = await syncShopSearchKeywords(shop.id, shop.name, shop.gbp_location_name, 12);
      if (result.success) {
        synced++;

        // 同一ロケーションの重複店舗にもキャッシュをコピー
        const dupes = seenLocations.get(shop.gbp_location_name) || [];
        if (dupes.length > 1) {
          for (const dupeId of dupes) {
            if (dupeId === shop.id) continue;
            const dupeShop = shops.find(s => s.id === dupeId);
            if (dupeShop) {
              await syncShopSearchKeywords(dupeId, dupeShop.name, shop.gbp_location_name, 12);
            }
          }
        }

        console.log(`[cron/sync-search-keywords] ${shop.name}: ${result.totalMonths}ヶ月同期完了`);
      } else {
        skipped++;
        console.log(`[cron/sync-search-keywords] ${shop.name}: ${result.error}`);
      }
    } catch (e: any) {
      failed++;
      errors.push(`${shop.name}: ${e?.message || "unknown"}`);
      console.error(`[cron/sync-search-keywords] ${shop.name}: error:`, e);
    }
  }

  console.log(`[cron/sync-search-keywords] done: ${synced} synced, ${skipped} no-data, ${failed} failed / ${targets.length} targets (${shops.length} total shops, ${syncedShopIds.size} already synced)`);
  return NextResponse.json({
    success: true,
    total: shops.length,
    alreadySynced: syncedShopIds.size,
    targets: targets.length,
    synced,
    skipped,
    failed,
    errors: errors.slice(0, 10),
    expectedMonth,
  });
}
