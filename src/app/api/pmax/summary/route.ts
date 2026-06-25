import { NextRequest, NextResponse } from "next/server";
import { getAccountSummary } from "@/lib/google-ads";
import { requireRole } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const r = await requireRole(request, ["president", "manager"]);
  if (r.error) return r.error;

  const { searchParams } = request.nextUrl;
  const customerId = searchParams.get("customerId");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  if (!customerId || !startDate || !endDate) {
    return NextResponse.json(
      { error: "customerId, startDate, endDate は必須です" },
      { status: 400 }
    );
  }

  try {
    const summary = await getAccountSummary(customerId, startDate, endDate);
    return NextResponse.json(summary);
  } catch (error: unknown) {
    console.error("Failed to get summary:", error);
    return NextResponse.json(
      { error: "サマリーの取得に失敗しました" },
      { status: 500 }
    );
  }
}
