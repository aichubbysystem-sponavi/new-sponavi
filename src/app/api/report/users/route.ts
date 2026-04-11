import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function getAdminSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

/**
 * GET /api/report/users — ユーザー一覧取得
 */
export async function GET() {
  const supabase = getAdminSupabase();
  const { data } = await supabase.from("user_profiles").select("*").order("created_at", { ascending: true });
  return NextResponse.json(data || []);
}

/**
 * POST /api/report/users — ユーザー作成
 */
export async function POST(request: NextRequest) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const { name, username, password, role } = await request.json();
  if (!name || !username || !password) {
    return NextResponse.json({ error: "名前、ユーザー名、パスワードが必要です" }, { status: 400 });
  }

  const supabase = getAdminSupabase();
  const email = `${username.replace(/[^a-zA-Z0-9._-]/g, "_")}@sponavi.internal`;

  // Supabase Authにユーザー作成
  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name, role: role || "manager" },
  });

  if (authError) {
    return NextResponse.json({ error: `ユーザー作成失敗: ${authError.message}` }, { status: 500 });
  }

  // user_profilesテーブルに保存（パスワードも管理者用に保持）
  await supabase.from("user_profiles").insert({
    id: authUser.user.id,
    auth_uid: authUser.user.id,
    name,
    username,
    email,
    role: role || "manager",
    password_display: password,
  });

  // 操作ログ
  await supabase.from("audit_logs").insert({
    id: crypto.randomUUID(),
    user_name: "社長",
    action: "ユーザー作成",
    detail: `${name}（${username}）をロール「${role || "manager"}」で作成`,
  });

  return NextResponse.json({ success: true, userId: authUser.user.id });
}

/**
 * DELETE /api/report/users — ユーザー削除
 */
export async function DELETE(request: NextRequest) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const { userId } = await request.json();
  if (!userId) return NextResponse.json({ error: "userIdが必要です" }, { status: 400 });

  const supabase = getAdminSupabase();

  // プロフィール取得（ログ用）
  const { data: profile } = await supabase.from("user_profiles").select("name, username").eq("id", userId).single();

  // Supabase Authから削除
  await supabase.auth.admin.deleteUser(userId);

  // プロフィールも削除
  await supabase.from("user_profiles").delete().eq("id", userId);

  // 操作ログ
  await supabase.from("audit_logs").insert({
    id: crypto.randomUUID(),
    user_name: "社長",
    action: "ユーザー削除",
    detail: `${profile?.name || "不明"}（${profile?.username || ""}）を削除`,
  });

  return NextResponse.json({ success: true });
}
