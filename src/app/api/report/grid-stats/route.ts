import { NextRequest, NextResponse } from "next/server";
import { getSupabase, requireRole } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * GET /api/report/grid-stats
 * 多地点順位チェックのステータスサマリーを返す
 */
export async function GET(request: NextRequest) {
  const r = await requireRole(request, ["president", "manager"]);
  if (r.error) return r.error;

  const sb = getSupabase();

  // 全店舗数
  const { count: totalShops } = await sb
    .from("shops")
    .select("*", { count: "exact", head: true });

  // 座標あり
  const { count: withCoord } = await sb
    .from("shops")
    .select("*", { count: "exact", head: true })
    .not("gbp_latitude", "is", null)
    .gt("gbp_latitude", 0);

  // KW設定済み（source != "not_found"）
  const { count: withKw } = await sb
    .from("shop_keywords")
    .select("*", { count: "exact", head: true })
    .neq("source", "not_found");

  // KW未取得（source = "not_found"）
  const { count: kwNotFound } = await sb
    .from("shop_keywords")
    .select("*", { count: "exact", head: true })
    .eq("source", "not_found");

  // 今月計測済み店舗数
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01T00:00:00`;
  const { data: measuredRows } = await sb
    .from("grid_ranking_logs")
    .select("shop_id")
    .gte("measured_at", monthStart)
    .limit(10000);
  const measuredShopIds = new Set((measuredRows || []).map((r: { shop_id: string }) => r.shop_id));

  // 最終計測日時
  const { data: lastLog } = await sb
    .from("grid_ranking_logs")
    .select("measured_at")
    .order("measured_at", { ascending: false })
    .limit(1);

  return NextResponse.json({
    totalShops: totalShops || 0,
    withCoord: withCoord || 0,
    withoutCoord: (totalShops || 0) - (withCoord || 0),
    withKw: withKw || 0,
    kwNotFound: kwNotFound || 0,
    measuredThisMonth: measuredShopIds.size,
    unmeasuredThisMonth: (totalShops || 0) - measuredShopIds.size,
    lastMeasuredAt: lastLog?.[0]?.measured_at || null,
  });
}
