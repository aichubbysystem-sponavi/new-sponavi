import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
}

/**
 * GET /api/report/hearing?shopId=xxx
 * ヒアリングシート取得
 */
export async function GET(request: NextRequest) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const shopId = new URL(request.url).searchParams.get("shopId");
  if (!shopId) return NextResponse.json({ error: "shopIdが必要です" }, { status: 400 });

  const supabase = getSupabase();
  const { data } = await supabase
    .from("hearing_sheets")
    .select("*")
    .eq("shop_id", shopId)
    .maybeSingle();

  return NextResponse.json(data || null);
}

/**
 * POST /api/report/hearing
 * ヒアリングシート保存（upsert）
 */
export async function POST(request: NextRequest) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const body = await request.json();
  const { shopId, data: hearingData } = body;

  if (!shopId || !hearingData) {
    return NextResponse.json({ error: "shopIdとdataが必要です" }, { status: 400 });
  }

  const supabase = getSupabase();

  // upsert
  const { data: existing } = await supabase
    .from("hearing_sheets")
    .select("id")
    .eq("shop_id", shopId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("hearing_sheets")
      .update({ data: hearingData, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await supabase
      .from("hearing_sheets")
      .insert({ shop_id: shopId, data: hearingData });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
