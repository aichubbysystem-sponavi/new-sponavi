import { NextRequest, NextResponse } from "next/server";
import { listAccounts } from "@/lib/google-ads";
import { verifyAuth } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  try {
    const accounts = await listAccounts();
    return NextResponse.json({ accounts });
  } catch (error: unknown) {
    console.error("Failed to list accounts:", error);
    return NextResponse.json(
      { error: "アカウント一覧の取得に失敗しました" },
      { status: 500 }
    );
  }
}
