import { NextRequest, NextResponse } from "next/server";
import { getSupabase, requireShopAccessById } from "@/lib/supabase";

export const dynamic = "force-dynamic";



/**
 * GET /api/report/post-schedule?shopId=xxx&month=2026-04
 * 月間投稿計画の取得
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const shopId = searchParams.get("shopId");

  if (!shopId) {
    return NextResponse.json({ error: "shopIdが必要です" }, { status: 400 });
  }

  const access = await requireShopAccessById(request, shopId);
  if (access.error) return access.error;

  const month = searchParams.get("month"); // "2026-04"

  const supabase = getSupabase();
  let query = supabase.from("post_schedule").select("*").order("date", { ascending: true });
  query = query.eq("shop_id", shopId);
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
  const body = await request.json();
  const { action, shopId, date, postType, note, id } = body;
  const supabase = getSupabase();

  if (action === "delete") {
    if (!id) return NextResponse.json({ error: "idが必要です" }, { status: 400 });
    // 認可: スケジュールのshop_idから店舗アクセス権を検証
    const { data: sched } = await supabase.from("post_schedule").select("shop_id").eq("id", id).maybeSingle();
    if (!sched?.shop_id) return NextResponse.json({ error: "スケジュールが見つかりません" }, { status: 404 });
    const access = await requireShopAccessById(request, sched.shop_id);
    if (access.error) return access.error;
    const { error } = await supabase.from("post_schedule").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  if (!shopId || !date || !postType) {
    return NextResponse.json({ error: "shopId, date, postTypeが必要です" }, { status: 400 });
  }

  const access = await requireShopAccessById(request, shopId);
  if (access.error) return access.error;

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
