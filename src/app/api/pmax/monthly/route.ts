import { NextRequest, NextResponse } from "next/server";
import { getCampaignMonthly } from "@/lib/google-ads";
import { verifyAuth } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

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
  } catch (error: unknown) {
    console.error("Failed to get monthly data:", error);
    return NextResponse.json(
      { error: "月次データの取得に失敗しました" },
      { status: 500 }
    );
  }
}
