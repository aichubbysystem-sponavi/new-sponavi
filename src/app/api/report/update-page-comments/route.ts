/**
 * POST /api/report/update-page-comments
 * ページ別AI総評の編集内容を保存
 * body: { shopName: string, targetMonth: string, pageComments: { map, search, reactions, keyword, reviews[], actions[] } }
 */
import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { withAudit, requireCtxShopAccess } from "@/lib/audit";

export const dynamic = "force-dynamic";


export const POST = withAudit("レポートページ別AI総評更新", "DATA_OP", async (request, ctx) => {
  const body = await request.json().catch(() => ({}));
  const shopName: string = body.shopName || "";
  const targetMonth: string | undefined = body.targetMonth;
  const pageComments = body.pageComments;

  if (!shopName || !targetMonth || !pageComments || typeof pageComments !== "object") {
    return NextResponse.json({ error: "shopName, targetMonth, pageComments が必要です" }, { status: 400 });
  }

  // 認可チェック
  const shopErr = await requireCtxShopAccess(ctx, shopName);
  if (shopErr) return shopErr;

  const supabase = getSupabase();

  const { error } = await supabase
    .from("report_analysis")
    .update({ page_comments: pageComments, updated_at: new Date().toISOString() })
    .eq("shop_name", shopName)
    .eq("target_month", targetMonth);

  if (error) {
    console.error("[update-page-comments] DB error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  ctx.detail = `${shopName}（${targetMonth}）: ページ別AI総評を更新`;
  return NextResponse.json({ success: true });
});
