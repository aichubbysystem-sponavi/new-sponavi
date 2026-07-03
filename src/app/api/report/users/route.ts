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
 * PUT /api/report/users — 登録申請（認証不要）
 */
export async function PUT(request: NextRequest) {
  const { name, username, password } = await request.json();
  if (!name || !username || !password) {
    return NextResponse.json({ error: "名前・ユーザー名・パスワードは必須です" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "パスワードは8文字以上にしてください" }, { status: 400 });
  }

  const supabase = getSupabase();
  const email = `${username.replace(/[^a-zA-Z0-9._-]/g, "_")}@sponavi.internal`;

  // 重複チェック
  const { data: existing } = await supabase.from("user_profiles").select("id").eq("username", username).limit(1);
  if (existing && existing.length > 0) {
    return NextResponse.json({ error: "このユーザー名は既に使用されています" }, { status: 409 });
  }

  // Supabase Authにユーザー作成
  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name, role: "pending" },
  });

  if (authError) {
    console.error("[users] register failed:", authError.message);
    return NextResponse.json({ error: "登録に失敗しました" }, { status: 500 });
  }

  // user_profilesに pending で保存
  await supabase.from("user_profiles").insert({
    id: authUser.user.id,
    auth_uid: authUser.user.id,
    name,
    username,
    email,
    role: "pending",
  });

  // 操作ログ
  await supabase.from("audit_logs").insert({
    id: crypto.randomUUID(),
    user_name: name,
    action: "登録申請",
    detail: `${name}（${username}）が登録申請`,
  });

  return NextResponse.json({ success: true });
}

/**
 * PATCH /api/report/users — 承認・ロール変更（社長のみ）
 */
export async function PATCH(request: NextRequest) {
  const r = await requireRole(request, ["president"]);
  if (r.error) return r.error;

  const { userId, action, role, name } = await request.json() as {
    userId: string;
    action: "approve" | "reject" | "change_role";
    role?: string;
    name?: string;
  };

  if (!userId || !action) {
    return NextResponse.json({ error: "userId と action は必須です" }, { status: 400 });
  }

  const supabase = getSupabase();

  // 操作者名
  const { data: operator } = await supabase.from("user_profiles").select("name").eq("id", r.sub).single();
  const operatorName = operator?.name || "不明";

  // 対象ユーザー
  const { data: target } = await supabase.from("user_profiles").select("name, username, role").eq("id", userId).single();
  if (!target) {
    return NextResponse.json({ error: "ユーザーが見つかりません" }, { status: 404 });
  }

  if (action === "approve") {
    const newRole = role || "manager";
    const newName = name || target.name;
    // user_profiles更新
    await supabase.from("user_profiles").update({ role: newRole, name: newName }).eq("id", userId);
    // Supabase Auth metadata更新
    await supabase.auth.admin.updateUserById(userId, {
      user_metadata: { name: newName, role: newRole },
    });
    await supabase.from("audit_logs").insert({
      id: crypto.randomUUID(),
      user_name: operatorName,
      action: "登録承認",
      detail: `${newName}（${target.username}）をロール「${newRole}」で承認`,
    });
    return NextResponse.json({ success: true });
  }

  if (action === "reject") {
    // Supabase Authから削除
    await supabase.auth.admin.deleteUser(userId);
    await supabase.from("user_profiles").delete().eq("id", userId);
    await supabase.from("audit_logs").insert({
      id: crypto.randomUUID(),
      user_name: operatorName,
      action: "登録却下",
      detail: `${target.name}（${target.username}）の登録申請を却下`,
    });
    return NextResponse.json({ success: true });
  }

  if (action === "change_role") {
    if (!role) return NextResponse.json({ error: "role は必須です" }, { status: 400 });
    const oldRole = target.role;
    await supabase.from("user_profiles").update({ role }).eq("id", userId);
    await supabase.auth.admin.updateUserById(userId, {
      user_metadata: { role },
    });
    await supabase.from("audit_logs").insert({
      id: crypto.randomUUID(),
      user_name: operatorName,
      action: "ロール変更",
      detail: `${target.name}（${target.username}）のロールを「${oldRole}」→「${role}」に変更`,
    });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "不正なaction" }, { status: 400 });
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
