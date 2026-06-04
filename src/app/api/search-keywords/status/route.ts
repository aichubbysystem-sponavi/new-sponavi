/**
 * GET /api/search-keywords/status
 * 全店舗の検索語句同期ステータスを返す
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

function getExpectedMonth(): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}/${d.getMonth() + 1}`;
}

export async function GET() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const expectedMonth = getExpectedMonth();

  // 1. Get all shops (limit 2000 to cover large datasets)
  const { data: allShops, error: shopErr } = await supabase
    .from("shops")
    .select("id, name, gbp_location_name")
    .order("name", { ascending: true })
    .limit(2000);

  if (shopErr || !allShops) {
    return NextResponse.json({ error: shopErr?.message || "No shops" }, { status: 500 });
  }

  // 2. Get latest cache entry per shop (only fetch shop_id, month, updated_at + top keywords)
  // Use RPC or fetch all but only select minimal columns — keywords is JSONB so select it
  const { data: cacheData } = await supabase
    .from("search_query_cache")
    .select("shop_id, month, keywords, updated_at")
    .order("month", { ascending: false })
    .limit(10000);

  // Build lookup: shop_id -> latest cache entry (first occurrence = latest due to DESC order)
  const cacheMap = new Map<string, { month: string; keywords: any[]; updated_at: string }>();
  for (const row of cacheData || []) {
    if (!cacheMap.has(row.shop_id)) {
      cacheMap.set(row.shop_id, {
        month: row.month,
        keywords: row.keywords || [],
        updated_at: row.updated_at,
      });
    }
  }

  // 3. Build status list
  const shops = allShops.map((shop) => {
    const hasGbp = !!shop.gbp_location_name;
    const cache = cacheMap.get(shop.id);

    let status: "synced" | "stale" | "never" | "no_gbp" = "never";
    if (!hasGbp) {
      status = "no_gbp";
    } else if (cache) {
      status = cache.month === expectedMonth ? "synced" : "stale";
    }

    const keywords = cache?.keywords || [];
    const topKeywords = keywords.slice(0, 3).map((kw: any) => kw.word || kw.keyword || "");

    return {
      id: shop.id,
      name: shop.name,
      gbp_location_name: shop.gbp_location_name,
      latestMonth: cache?.month || null,
      keywordCount: keywords.length,
      topKeywords,
      lastSynced: cache?.updated_at || null,
      status,
    };
  });

  return NextResponse.json({ shops, expectedMonth });
}
