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

/** Supabaseの1000行制限を回避してページネーションで全件取得 */
async function fetchAll<T>(
  supabase: any,
  table: string,
  select: string,
  orderCol: string,
  ascending: boolean
): Promise<T[]> {
  const PAGE = 1000;
  const all: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .order(orderCol, { ascending })
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

export async function GET() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const expectedMonth = getExpectedMonth();

  // 1. Get all shops (paginated to bypass 1000 row limit)
  const allShops = await fetchAll<{ id: string; name: string; gbp_location_name: string | null }>(
    supabase, "shops", "id, name, gbp_location_name", "name", true
  );

  if (allShops.length === 0) {
    return NextResponse.json({ error: "No shops found" }, { status: 500 });
  }

  // 2. Get latest cache entry per shop (paginated)
  const cacheData = await fetchAll<{ shop_id: string; month: string; keywords: any[]; updated_at: string }>(
    supabase, "search_query_cache", "shop_id, month, keywords, updated_at", "month", false
  );

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
