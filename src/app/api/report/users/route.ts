import { NextRequest, NextResponse } from "next/server";
import { getSupabase, requireRole } from "@/lib/supabase";
import { validateBody, userCreateSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/**
 * GET /api/report/users — ユーザー一覧取得（社長のみ）
 */
export async function GET(request: NextRequest) {
  const r = await requireRole(request, ["president"]);
  if (r.error) return r.error;

  const supabase = getSupabase();
  const { data } = await supabase.from("user_profiles").select("*").order("created_at", { ascending: true });
  return NextResponse.json(data || []);
}

/**
 * POST /api/report/users — ユーザー作成（社長のみ）
 */
export async function POST(request: NextRequest) {
  const r = await requireRole(request, ["president"]);
  if (r.error) return r.error;

  const { data: body, error: valErr } = await validateBody(request, userCreateSchema);
  if (valErr) return valErr;
  const { name, username, password, role } = body;

  const supabase = getSupabase();

  // 操作者のプロフィールを取得（監査ログ用）
  const { data: operator } = await supabase.from("user_profiles").select("name").eq("id", r.sub).single();
  const operatorName = operator?.name || "不明";

  const email = `${username.replace(/[^a-zA-Z0-9._-]/g, "_")}@sponavi.internal`;

  // Supabase Authにユーザー作成
  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name, role: role || "manager" },
  });

  if (authError) {
    console.error("[users] createUser failed:", authError.message);
    return NextResponse.json({ error: "ユーザー作成に失敗しました" }, { status: 500 });
  }

  // user_profilesテーブルに保存
  await supabase.from("user_profiles").insert({
    id: authUser.user.id,
    auth_uid: authUser.user.id,
    name,
    username,
    email,
    role: role || "manager",
  });

  // 操作ログ
  await supabase.from("audit_logs").insert({
    id: crypto.randomUUID(),
    user_name: operatorName,
    action: "ユーザー作成",
    detail: `${name}（${username}）をロール「${role || "manager"}」で作成`,
  });

  return NextResponse.json({ success: true, userId: authUser.user.id });
}

/**
 * DELETE /api/report/users — ユーザー削除
 */
export async function DELETE(request: NextRequest) {
  const r = await requireRole(request, ["president"]);
  if (r.error) return r.error;

  const { userId } = await request.json();
  if (!userId) return NextResponse.json({ error: "userIdが必要です" }, { status: 400 });

  const supabase = getSupabase();

  // 操作者のプロフィールを取得（監査ログ用）
  const { data: operator } = await supabase.from("user_profiles").select("name").eq("id", r.sub).single();
  const operatorName = operator?.name || "不明";

  // 削除対象のプロフィール取得（ログ用）
  const { data: profile } = await supabase.from("user_profiles").select("name, username").eq("id", userId).single();

  // Supabase Authから削除
  await supabase.auth.admin.deleteUser(userId);

  // プロフィールも削除
  await supabase.from("user_profiles").delete().eq("id", userId);

  // 操作ログ
  await supabase.from("audit_logs").insert({
    id: crypto.randomUUID(),
    user_name: operatorName,
    action: "ユーザー削除",
    detail: `${profile?.name || "不明"}（${profile?.username || ""}）を削除`,
  });

  return NextResponse.json({ success: true });
}
