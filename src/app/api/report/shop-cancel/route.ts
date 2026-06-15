/**
 * POST /api/report/shop-cancel
 * 店舗の解約ステータスを設定/解除
 * body: { shopId: string, cancel: boolean }
 *
 * GET /api/report/shop-cancel
 * 解約店舗IDリストを返す
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export async function GET(request: Request) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data, error } = await supabase
    .from("shops")
    .select("id, name, cancelled_at")
    .not("cancelled_at", "is", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ cancelled: data || [] });
}

export async function POST(request: Request) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const body = await request.json();
  const { shopId, cancel } = body;
  if (!shopId) return NextResponse.json({ error: "shopId is required" }, { status: 400 });

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { error } = await supabase
    .from("shops")
    .update({ cancelled_at: cancel ? new Date().toISOString() : null })
    .eq("id", shopId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, shopId, cancelled: !!cancel });
}
