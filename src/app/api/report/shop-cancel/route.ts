/**
 * POST /api/report/shop-cancel
 * 店舗の解約ステータスを設定/解除
 * body: { shopId: string, cancel: boolean }
 *
 * GET /api/report/shop-cancel
 * 解約店舗IDリストを返す
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabase, verifyAuth } from "@/lib/supabase";
import { withAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";


export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("shops")
    .select("id, name, cancelled_at")
    .not("cancelled_at", "is", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ cancelled: data || [] });
}

export const POST = withAudit("店舗解約フラグ切替", "DATA_OP", async (request, ctx) => {
  const body = await request.json();
  const { shopId, cancel } = body;
  if (!shopId) return NextResponse.json({ error: "shopId is required" }, { status: 400 });

  const supabase = getSupabase();
  const { data: updated, error } = await supabase
    .from("shops")
    .update({ cancelled_at: cancel ? new Date().toISOString() : null })
    .eq("id", shopId)
    .select("id, name");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 0行更新の検出: IDが一致せず何も更新されなかった場合はサイレント成功にしない
  if (!updated || updated.length === 0) {
    return NextResponse.json(
      { error: "対象の店舗が見つかりませんでした（IDが一致しません）", shopId },
      { status: 404 }
    );
  }

  ctx.targetShop = updated[0].name;
  ctx.detail = `${updated[0].name}: 解約フラグを${cancel ? "ON（解約）" : "OFF（解約解除）"}`;
  return NextResponse.json({ ok: true, shopId, cancelled: !!cancel });
});
