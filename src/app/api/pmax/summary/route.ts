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
    const envDebug = {
      CLIENT_ID_prefix: (process.env.GOOGLE_ADS_CLIENT_ID || "").slice(0, 12),
      CLIENT_SECRET_prefix: (process.env.GOOGLE_ADS_CLIENT_SECRET || "").slice(0, 8),
      REFRESH_TOKEN_prefix: (process.env.GOOGLE_ADS_REFRESH_TOKEN || "").slice(0, 8),
      MCC_ID: process.env.GOOGLE_ADS_MCC_ID || "",
      DEV_TOKEN_prefix: (process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "").slice(0, 8),
    };
    return NextResponse.json(
      { error: error.message || "サマリーの取得に失敗しました", _envLengths: envDebug },
      { status: 500 }
    );
  }
}
