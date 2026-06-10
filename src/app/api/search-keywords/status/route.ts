/**
 * GET /api/search-keywords/status
 * 全店舗の検索語句同期ステータスを返す
 * v2: JST固定 / 最新月のみ取得 / 数値月比較
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getExpectedMonthJST, compareMonths } from "@/lib/gbp-search-keywords";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

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

export async function GET(request: Request) {
  // 認証チェック
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const expectedMonth = getExpectedMonthJST();

  // 1. Get all shops (paginated to bypass 1000 row limit)
  const allShops = await fetchAll<{ id: string; name: string; gbp_location_name: string | null }>(
    supabase, "shops", "id, name, gbp_location_name", "name", true
  );

  if (allShops.length === 0) {
    return NextResponse.json({ error: "No shops found" }, { status: 500 });
  }

  // 2. 最新月のキャッシュのみ取得（keywordsはTOP3分だけ必要なので全件は不要）
  //    shop_id + month + updated_at のみ取得し、TOP3用には別途最新月のkeywordsを取得
  const cacheData = await fetchAll<{ shop_id: string; month: string; keywords: any[]; updated_at: string }>(
    supabase, "search_query_cache", "shop_id, month, keywords, updated_at", "updated_at", false
  );

  // Build lookup: shop_id -> latest cache entry (数値比較で最新月を特定)
  const cacheMap = new Map<string, { month: string; keywords: any[]; updated_at: string }>();
  for (const row of cacheData || []) {
    const existing = cacheMap.get(row.shop_id);
    if (!existing || compareMonths(row.month, existing.month) > 0) {
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
