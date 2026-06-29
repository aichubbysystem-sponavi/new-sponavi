import { NextRequest, NextResponse } from "next/server";
import { getStoreDetail } from "@/lib/google-ads";
import { requireRole } from "@/lib/supabase";
import { getPmaxCache, setPmaxCache } from "@/lib/pmax-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/pmax/store-detail?shopName=X&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 * 特定店舗の言語別キャンペーンデータ（月次+日次）を返す（6時間キャッシュ）
 */
export async function GET(request: NextRequest) {
  const r = await requireRole(request, ["president", "manager"]);
  if (r.error) return r.error;

  const { searchParams } = request.nextUrl;
  const shopName = searchParams.get("shopName");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const refresh = searchParams.get("refresh") === "true";

  if (!shopName || !startDate || !endDate) {
    return NextResponse.json({ error: "shopName, startDate, endDate は必須です" }, { status: 400 });
  }

  const cacheKey = `store-detail:${shopName}:${startDate}:${endDate}`;

  if (!refresh) {
    const cached = await getPmaxCache<{ monthly: unknown[]; daily: unknown[] }>(cacheKey);
    if (cached) {
      return NextResponse.json({ ...cached, cached: true });
    }
  }

  try {
    // store-summaryキャッシュからこの店舗のaccountIdsを取得（全アカウント検索を回避）
    let knownAccountIds: string[] | undefined;
    const summaryKeys = await findStoreSummaryAccountIds(shopName);
    if (summaryKeys.length > 0) {
      knownAccountIds = summaryKeys;
    }

    const data = await getStoreDetail(shopName, startDate, endDate, knownAccountIds);
    setPmaxCache(cacheKey, data);
    return NextResponse.json({ ...data, cached: false });
  } catch (error: unknown) {
    console.error("[pmax/store-detail] Error:", error);
    return NextResponse.json({ error: "店舗詳細の取得に失敗しました" }, { status: 500 });
  }
}

/** store-summaryキャッシュからshopNameに対応するaccountIdsを探す */
async function findStoreSummaryAccountIds(shopName: string): Promise<string[]> {
  try {
    const { getSupabase } = await import("@/lib/supabase");
    const sb = getSupabase();
    const { data: rows } = await sb.from("pmax_cache").select("cache_key, data");
    if (!rows) return [];

    for (const row of rows) {
      if (!row.cache_key.startsWith("store-summary:")) continue;
      const stores = (row.data as { stores?: { shopName: string; accountIds: string[] }[] })?.stores;
      if (!stores) continue;
      const match = stores.find(s => s.shopName === shopName);
      if (match?.accountIds) return match.accountIds;
    }
  } catch {}
  return [];
}
