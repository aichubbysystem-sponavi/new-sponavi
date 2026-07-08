/**
 * POST /api/report/update-comments
 * AIコメントの編集内容を保存
 * body: { shopName: string, comments: string[] }
 */
import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { withAudit, requireCtxShopAccess } from "@/lib/audit";

export const dynamic = "force-dynamic";


export const POST = withAudit("レポートコメント更新", "DATA_OP", async (request, ctx) => {
  const body = await request.json().catch(() => ({}));
  const shopName: string = body.shopName || "";
  const comments: string[] = body.comments;
  const targetMonth: string | undefined = body.targetMonth;

  if (!shopName || !Array.isArray(comments) || !targetMonth) {
    return NextResponse.json({ error: "shopName, comments[], targetMonth required" }, { status: 400 });
  }

  // 認可チェック
  const shopErr = await requireCtxShopAccess(ctx, shopName);
  if (shopErr) return shopErr;

  const supabase = getSupabase();

  const { error } = await supabase
    .from("report_analysis")
    .update({ comments, updated_at: new Date().toISOString() })
    .eq("shop_name", shopName)
    .eq("target_month", targetMonth);

  if (error) {
    console.error("[update-comments] DB error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  ctx.detail = `${shopName}（${targetMonth}）: AIコメント${comments.length}件を更新`;
  return NextResponse.json({ success: true });
});
