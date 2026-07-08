import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, getUserRole, getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * GET /api/report/my-role
 * ログイン中ユーザーのロールと名前を返す（認証チェック・表示用）
 */
export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid || !auth.sub) {
    return NextResponse.json({ role: null }, { status: 401 });
  }
  const role = await getUserRole(auth.sub);

  // 表示用の名前も取得（auth_uid → id フォールバック）
  const sb = getSupabase();
  let name = "";
  const { data: byAuthUid } = await sb.from("user_profiles").select("name").eq("auth_uid", auth.sub).maybeSingle();
  if (byAuthUid?.name) {
    name = byAuthUid.name;
  } else {
    const { data: byId } = await sb.from("user_profiles").select("name").eq("id", auth.sub).maybeSingle();
    if (byId?.name) name = byId.name;
  }

  return NextResponse.json({ role: role || "pending", name });
}
