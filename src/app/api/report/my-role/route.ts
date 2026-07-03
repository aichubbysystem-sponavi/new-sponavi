import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, getUserRole } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * GET /api/report/my-role
 * ログイン中ユーザーのロールを返す（認証チェック用）
 */
export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid || !auth.sub) {
    return NextResponse.json({ role: null }, { status: 401 });
  }
  const role = await getUserRole(auth.sub);
  return NextResponse.json({ role: role || "pending" });
}
