import { NextRequest, NextResponse } from "next/server";
import { getCampaignDaily } from "@/lib/google-ads";
import { requireRole } from "@/lib/supabase";
import { getPmaxCache, setPmaxCache } from "@/lib/pmax-cache";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const r = await requireRole(request, ["president", "executive", "manager"]);
  if (r.error) return r.error;

  const { searchParams } = request.nextUrl;
  const customerId = searchParams.get("customerId");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  if (!customerId || !startDate || !endDate) {
    return NextResponse.json({ error: "customerId, startDate, endDate は必須です" }, { status: 400 });
  }

  const cacheKey = `daily:${customerId}:${startDate}:${endDate}`;
  const cached = await getPmaxCache<{ campaigns: Record<string, unknown[]> }>(cacheKey);
  if (cached) return NextResponse.json({ ...cached, cached: true });

  try {
    const data = await getCampaignDaily(customerId, startDate, endDate);
    const grouped: Record<string, typeof data> = {};
    for (const row of data) {
      const key = row.campaignName;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(row);
    }
    const result = { campaigns: grouped };
    setPmaxCache(cacheKey, result);
    return NextResponse.json({ ...result, cached: false });
  } catch (error: unknown) {
    console.error("Failed to get daily data:", error);
    return NextResponse.json({ error: "日次データの取得に失敗しました" }, { status: 500 });
  }
}
