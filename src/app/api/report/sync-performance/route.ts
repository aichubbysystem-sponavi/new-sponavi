/**
 * POST /api/report/sync-performance
 * 指定店舗のパフォーマンスメトリクスをGBP APIから取得してキャッシュに保存
 */
import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { withAudit, requireCtxShopAccessById } from "@/lib/audit";
import { syncShopPerformance } from "@/lib/gbp-performance";

export const dynamic = "force-dynamic";
export const maxDuration = 300;



export const POST = withAudit("パフォーマンス同期", "DATA_OP", async (request, ctx) => {
  const body = await request.json().catch(() => ({}));
  const shopId = body.shopId || "";

  if (!shopId) {
    return NextResponse.json({ error: "shopId required" }, { status: 400 });
  }

  const shopRes = await requireCtxShopAccessById(ctx, shopId);
  if (shopRes.error) return shopRes.error;

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
    ctx.detail = `${shop.name}: 同期失敗（${result.error || "不明"}）`;
    return NextResponse.json({ success: false, error: result.error, shopName: shop.name });
  }

  ctx.detail = `${shop.name}: パフォーマンス${result.totalMonths}ヶ月分同期`;
  return NextResponse.json({
    success: true,
    shopId: shop.id,
    shopName: shop.name,
    totalMonths: result.totalMonths,
  });
});
