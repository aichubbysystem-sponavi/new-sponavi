import { NextRequest, NextResponse } from "next/server";
import { getSupabase, verifyAuth } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * POST /api/report/audit-log
 * 操作ログを記録する。
 * 以前は anonキーで audit_logs へ直接 insert しており、user_name もクライアント算出値だった
 * ため、監査ログを匿名で偽造・注入できた。ここでは検証済みJWTの sub から
 * サーバー側で user_name を解決し、クライアント指定の名前は信用しない。
 * body: { action, detail }
 */
export async function POST(request: NextRequest) {
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid || !auth.sub) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const action = String(body?.action || "").slice(0, 200);
  const detail = String(body?.detail || "").slice(0, 2000);
  if (!action) return NextResponse.json({ error: "actionが必要です" }, { status: 400 });

  const supabase = getSupabase();

  // ユーザー名はサーバー側で解決（クライアント値は使わない）
  let userName = "不明";
  const { data: byAuthUid } = await supabase
    .from("user_profiles").select("name").eq("auth_uid", auth.sub).maybeSingle();
  if (byAuthUid?.name) {
    userName = byAuthUid.name;
  } else {
    const { data: byId } = await supabase
      .from("user_profiles").select("name").eq("id", auth.sub).maybeSingle();
    if (byId?.name) userName = byId.name;
  }

  const { error } = await supabase.from("audit_logs").insert({
    id: crypto.randomUUID(),
    user_name: userName,
    action,
    detail,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
