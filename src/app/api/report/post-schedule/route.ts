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
 * GET /api/report/post-schedule?shopId=xxx&month=2026-04
 * 月間投稿計画の取得
 */
export async function GET(request: NextRequest) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const shopId = searchParams.get("shopId");
  const month = searchParams.get("month"); // "2026-04"

  const supabase = getSupabase();
  let query = supabase.from("post_schedule").select("*").order("date", { ascending: true });
  if (shopId) query = query.eq("shop_id", shopId);
  if (month) {
    query = query.gte("date", `${month}-01`).lte("date", `${month}-31`);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[post-schedule GET] error:", error.message, error.code);
    // テーブルが存在しない場合やRLSエラーの場合は空配列を返す
    return NextResponse.json([]);
  }
  return NextResponse.json(data || []);
}

/**
 * POST /api/report/post-schedule
 * 投稿計画の保存（upsert）
 */
export async function POST(request: NextRequest) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = await request.json();
  const { action, shopId, date, postType, note, id } = body;
  const supabase = getSupabase();

  if (action === "delete") {
    const { error } = await supabase.from("post_schedule").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  if (!shopId || !date || !postType) {
    return NextResponse.json({ error: "shopId, date, postTypeが必要です" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("post_schedule")
    .upsert({
      shop_id: shopId,
      date,
      post_type: postType,
      note: note || "",
    }, { onConflict: "shop_id,date" })
    .select()
    .single();

  if (error) {
    // upsert conflictがない場合はinsert
    const { data: inserted, error: insertErr } = await supabase
      .from("post_schedule")
      .insert({ shop_id: shopId, date, post_type: postType, note: note || "" })
      .select()
      .single();
    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });
    return NextResponse.json(inserted);
  }

  return NextResponse.json(data);
}
