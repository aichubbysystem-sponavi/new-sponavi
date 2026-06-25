import { NextRequest, NextResponse } from "next/server";
import { listAccounts } from "@/lib/google-ads";
import { requireRole } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const r = await requireRole(request, ["president", "manager"]);
  if (r.error) return r.error;

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
