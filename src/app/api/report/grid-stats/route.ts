import { NextRequest, NextResponse } from "next/server";
import { getSupabase, requireRole } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * GET /api/report/grid-stats
 * 多地点順位チェックのステータスサマリーを返す
 */
export async function GET(request: NextRequest) {
  const r = await requireRole(request, ["president", "executive", "manager"]);
  if (r.error) return r.error;

  const sb = getSupabase();

  // 順位計測の対象外店舗（エミナル等）は全ての集計から除く。
  // ここを含めたままだと、画面上部が「400店舗」なのに統計が「608」になり、
  // 同じ画面で数字が食い違って見える
  const excludedIds = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data } = await sb
      .from("shops")
      .select("id")
      .eq("rank_tracking_disabled", true)
      .order("id")
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const r of data as { id: string }[]) excludedIds.add(r.id);
    if (data.length < 1000) break;
  }

  // 計測対象の店舗数
  const { count: totalShops } = await sb
    .from("shops")
    .select("*", { count: "exact", head: true })
    .eq("rank_tracking_disabled", false);

  // 座標あり
  const { count: withCoord } = await sb
    .from("shops")
    .select("*", { count: "exact", head: true })
    .eq("rank_tracking_disabled", false)
    .not("gbp_latitude", "is", null)
    .gt("gbp_latitude", 0);

  // KW設定済み・KW未取得は shop_keywords 側なので、取得後に対象外を除く
  const countKeywords = async (kind: "set" | "not_found") => {
    let total = 0;
    for (let from = 0; ; from += 1000) {
      let q = sb.from("shop_keywords").select("shop_id").order("shop_id").range(from, from + 999);
      q = kind === "not_found" ? q.eq("source", "not_found") : q.neq("source", "not_found");
      const { data } = await q;
      if (!data || data.length === 0) break;
      total += (data as { shop_id: string }[]).filter((r) => !excludedIds.has(r.shop_id)).length;
      if (data.length < 1000) break;
    }
    return total;
  };
  const withKw = await countKeywords("set");
  const kwNotFound = await countKeywords("not_found");

  // 今月計測済み店舗数
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01T00:00:00`;
  const { data: measuredRows } = await sb
    .from("grid_ranking_logs")
    .select("shop_id")
    .gte("measured_at", monthStart)
    .limit(10000);
  const measuredShopIds = new Set(
    (measuredRows || [])
      .map((r: { shop_id: string }) => r.shop_id)
      .filter((id: string) => !excludedIds.has(id)),
  );

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
