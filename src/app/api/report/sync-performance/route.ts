/**
 * POST /api/report/sync-performance
 * 指定店舗のパフォーマンスメトリクスをGBP APIから取得してキャッシュに保存
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabase, requireShopAccessById } from "@/lib/supabase";
import { syncShopPerformance } from "@/lib/gbp-performance";

export const dynamic = "force-dynamic";
export const maxDuration = 300;



export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const shopId = body.shopId || "";

  if (!shopId) {
    return NextResponse.json({ error: "shopId required" }, { status: 400 });
  }

  const access = await requireShopAccessById(request, shopId);
  if (access.error) return access.error;

  const supabase = getSupabase();
  const { data: shop } = await supabase
    .from("shops")
    .select("id, name, gbp_location_name")
    .eq("id", shopId)
    .maybeSingle();

  if (!shop) {
    return NextResponse.json({ error: `Shop not found: ${shopId}` }, { status: 404 });
  }
  if (!shop.gbp_location_name) {
    return NextResponse.json({ success: false, error: `No gbp_location_name: ${shop.name}` });
  }

  const result = await syncShopPerformance(shop.id, shop.name, shop.gbp_location_name);

  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error, shopName: shop.name });
  }

  return NextResponse.json({
    success: true,
    shopId: shop.id,
    shopName: shop.name,
    totalMonths: result.totalMonths,
  });
}
