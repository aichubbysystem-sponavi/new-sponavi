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
      CLIENT_ID: (process.env.GOOGLE_ADS_CLIENT_ID || "").length,
      CLIENT_SECRET: (process.env.GOOGLE_ADS_CLIENT_SECRET || "").length,
      REFRESH_TOKEN: (process.env.GOOGLE_ADS_REFRESH_TOKEN || "").length,
      MCC_ID: (process.env.GOOGLE_ADS_MCC_ID || "").length,
      DEV_TOKEN: (process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "").length,
    };
    return NextResponse.json(
      { error: error.message || "サマリーの取得に失敗しました", _envLengths: envDebug },
      { status: 500 }
    );
  }
}
