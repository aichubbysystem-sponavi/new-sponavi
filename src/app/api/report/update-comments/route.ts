/**
 * POST /api/report/update-comments
 * AIコメントの編集内容を保存
 * body: { shopName: string, comments: string[] }
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabase, verifyAuth, verifyShopAccess } from "@/lib/supabase";

export const dynamic = "force-dynamic";


export async function POST(request: NextRequest) {
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid || !auth.sub) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const shopName: string = body.shopName || "";
  const comments: string[] = body.comments;
  const targetMonth: string | undefined = body.targetMonth;

  if (!shopName || !Array.isArray(comments) || !targetMonth) {
    return NextResponse.json({ error: "shopName, comments[], targetMonth required" }, { status: 400 });
  }

  // 認可チェック
  const hasAccess = await verifyShopAccess(auth.sub, shopName);
  if (!hasAccess) return NextResponse.json({ error: "この店舗へのアクセス権がありません" }, { status: 403 });

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

  return NextResponse.json({ success: true });
}
