/**
 * POST /api/report/shop-cancel
 * 店舗の解約ステータスを設定/解除
 * body: { shopId: string, cancel: boolean }
 *
 * GET /api/report/shop-cancel
 * 解約店舗IDリストを返す
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabase, verifyAuth, requireRole } from "@/lib/supabase";

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

export async function POST(request: NextRequest) {
  // 店舗解約は社長・マネージャーのみ
  const r = await requireRole(request, ["president", "manager"]);
  if (r.error) return r.error;

  const body = await request.json();
  const { shopId, cancel } = body;
  if (!shopId) return NextResponse.json({ error: "shopId is required" }, { status: 400 });

  const supabase = getSupabase();
  const { error } = await supabase
    .from("shops")
    .update({ cancelled_at: cancel ? new Date().toISOString() : null })
    .eq("id", shopId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, shopId, cancelled: !!cancel });
}
