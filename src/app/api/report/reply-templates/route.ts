import { NextRequest, NextResponse } from "next/server";
import { getSupabase, verifyAuth, requireRole } from "@/lib/supabase";

export const dynamic = "force-dynamic";



/**
 * GET /api/report/reply-templates
 * 返信テンプレート一覧取得
 */
export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("reply_templates")
    .select("*")
    .order("use_count", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data || []);
}

/**
 * POST /api/report/reply-templates
 * テンプレート保存 or 使用回数カウントアップ
 */
export async function POST(request: NextRequest) {
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = await request.json();
  const { action, id, name, content, star_category, tags } = body;
  const supabase = getSupabase();

  if (action === "increment") {
    if (!id) return NextResponse.json({ error: "idが必要です" }, { status: 400 });
    // 原子的にカウントアップ（TOCTOU回避）
    const { error } = await supabase.rpc("increment_use_count", { template_id: id });
    if (error) {
      // RPCが未定義の場合はフォールバック
      const { data: current } = await supabase
        .from("reply_templates")
        .select("use_count")
        .eq("id", id)
        .single();
      await supabase
        .from("reply_templates")
        .update({ use_count: (current?.use_count || 0) + 1, updated_at: new Date().toISOString() })
        .eq("id", id);
    }
    return NextResponse.json({ success: true });
  }

  if (action === "delete") {
    if (!id) return NextResponse.json({ error: "idが必要です" }, { status: 400 });
    // 削除は管理者（president, manager）のみ許可
    const r = await requireRole(request, ["president", "manager"]);
    if (r.error) return r.error;
    const { error } = await supabase.from("reply_templates").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  // 新規保存
  if (!name || !content) {
    return NextResponse.json({ error: "nameとcontentが必要です" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("reply_templates")
    .insert({
      name,
      content,
      star_category: star_category || "all",
      tags: tags || [],
      use_count: 0,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
