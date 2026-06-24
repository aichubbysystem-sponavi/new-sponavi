import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, getUserAllowedShops } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** 現在のユーザーがアクセス可能な店舗名一覧を返す */
export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid || !auth.sub) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const allowed = await getUserAllowedShops(auth.sub);
  return NextResponse.json({ shops: allowed });
}
