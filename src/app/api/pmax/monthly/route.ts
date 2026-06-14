import { NextRequest, NextResponse } from "next/server";
import { getCampaignMonthly } from "@/lib/google-ads";

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
    const data = await getCampaignMonthly(customerId, startDate, endDate);

    // キャンペーン名（≒言語）ごとにグルーピング
    const grouped: Record<string, typeof data> = {};
    for (const row of data) {
      const key = row.campaignName;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(row);
    }

    return NextResponse.json({ campaigns: grouped });
  } catch (error: any) {
    console.error("Failed to get monthly data:", error);
    return NextResponse.json(
      { error: error.message || "月次データの取得に失敗しました" },
      { status: 500 }
    );
  }
}
