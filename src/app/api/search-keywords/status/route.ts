/**
 * GET /api/search-keywords/status
 * 全店舗の検索語句同期ステータスを返す
 * v2: JST固定 / 最新月のみ取得 / 数値月比較
 */
import { NextResponse } from "next/server";
import { getSupabase, verifyAuth, getUserAllowedShops } from "@/lib/supabase";
import { getExpectedMonthJST, compareMonths } from "@/lib/gbp-search-keywords";
import { getGbpSyncErrors } from "@/lib/gbp-sync-errors";

export const dynamic = "force-dynamic";


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
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const supabase = getSupabase();
  const expectedMonth = getExpectedMonthJST();

  // 1. Get all active shops (解約店舗を除外, paginated to bypass 1000 row limit)
  const allShopsRaw = await fetchAll<{ id: string; name: string; gbp_location_name: string | null; cancelled_at: string | null }>(
    supabase, "shops", "id, name, gbp_location_name, cancelled_at", "name", true
  );
  // 閲覧権限のある店舗のみに絞る（バイトは割当店舗のみ）。
  // これが無いと、認証さえ通れば全クライアントの店舗名・検索語句が読める。
  const allowed = await getUserAllowedShops(auth.sub!);
  const normName = (s: string) => (s || "").normalize("NFKC").replace(/[\s　]+/g, "").toLowerCase();
  const allowedSet = allowed === "all" ? null : new Set(allowed.map(normName));

  const allShops = allShopsRaw
    .filter(s => !s.cancelled_at)
    .filter(s => !allowedSet || allowedSet.has(normName(s.name)));

  if (allShops.length === 0) {
    // 権限のある店舗が無い場合は空配列（エラーではない）
    return NextResponse.json(allowedSet ? { shops: [], expectedMonth } : { error: "No shops found" }, {
      status: allowedSet ? 200 : 500,
    });
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

  // 2b. 直近の同期失敗（403/404等）。行がある＝直近の同期が失敗
  const syncErrors = await getGbpSyncErrors("search_keywords");

  // 3. Build status list
  const shops = allShops.map((shop) => {
    const hasGbp = !!shop.gbp_location_name;
    const cache = cacheMap.get(shop.id);
    const syncError = syncErrors.get(shop.id);

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
      // 直近の同期失敗理由（成功したら消える）。ページ再読込後も「同期失敗」として見せるため
      syncError: syncError ? { message: syncError.message, httpStatus: syncError.http_status, at: syncError.updated_at } : null,
    };
  });

  return NextResponse.json({ shops, expectedMonth });
}
