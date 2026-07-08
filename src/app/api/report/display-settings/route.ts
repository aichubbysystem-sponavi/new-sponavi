import { NextRequest, NextResponse } from "next/server";
import { getSupabase, verifyAuth, verifyShopAccess } from "@/lib/supabase";
import { withAudit, requireCtxShopAccess } from "@/lib/audit";

export const dynamic = "force-dynamic";



/**
 * GET /api/report/display-settings?shopId=xxx
 */
export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid || !auth.sub) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const shopId = request.nextUrl.searchParams.get("shopId");
  if (!shopId) return NextResponse.json({ error: "shopId必須" }, { status: 400 });

  // shopIdは店舗名（ShopListItem.id = shopName）
  if (!(await verifyShopAccess(auth.sub, decodeURIComponent(shopId)))) {
    return NextResponse.json({ error: "この店舗へのアクセス権がありません" }, { status: 403 });
  }

  const supabase = getSupabase();
  const { data } = await supabase
    .from("report_display_settings")
    .select("section_visibility, kw_visibility, rw_visibility")
    .eq("shop_id", shopId)
    .maybeSingle();

  return NextResponse.json(data || { section_visibility: {}, kw_visibility: {}, rw_visibility: {} });
}

/**
 * PUT /api/report/display-settings
 * { shopId, sectionVisibility?, kwVisibility?, rwVisibility? }
 */
export const PUT = withAudit("表示設定保存", "DATA_OP", async (request, ctx) => {
  const body = await request.json();
  const { shopId, sectionVisibility, kwVisibility, rwVisibility } = body;
  if (!shopId) return NextResponse.json({ error: "shopId必須" }, { status: 400 });

  const shopErr = await requireCtxShopAccess(ctx, decodeURIComponent(shopId));
  if (shopErr) return shopErr;

  const supabase = getSupabase();

  const row: Record<string, any> = {
    shop_id: shopId,
    updated_at: new Date().toISOString(),
  };
  if (sectionVisibility !== undefined) row.section_visibility = sectionVisibility;
  if (kwVisibility !== undefined) row.kw_visibility = kwVisibility;
  if (rwVisibility !== undefined) row.rw_visibility = rwVisibility;

  const { error } = await supabase
    .from("report_display_settings")
    .upsert(row, { onConflict: "shop_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const updatedKeys = [
    sectionVisibility !== undefined ? "セクション表示" : null,
    kwVisibility !== undefined ? "KW表示" : null,
    rwVisibility !== undefined ? "口コミ表示" : null,
  ].filter(Boolean).join("・");
  ctx.detail = `${decodeURIComponent(shopId)}: 表示設定を保存（${updatedKeys || "変更なし"}）`;
  return NextResponse.json({ success: true });
});
