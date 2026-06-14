import { NextResponse } from "next/server";
import { listAccounts } from "@/lib/google-ads";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const accounts = await listAccounts();
    return NextResponse.json({ accounts });
  } catch (error: any) {
    console.error("Failed to list accounts:", error);
    return NextResponse.json(
      { error: error.message || "アカウント一覧の取得に失敗しました" },
      { status: 500 }
    );
  }
}
