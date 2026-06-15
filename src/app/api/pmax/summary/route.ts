import { NextRequest, NextResponse } from "next/server";
import { getAccountSummary } from "@/lib/google-ads";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
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
  } catch (error: any) {
    console.error("Failed to get summary:", error);
    return NextResponse.json(
      { error: error.message || "サマリーの取得に失敗しました" },
      { status: 500 }
    );
  }
}
