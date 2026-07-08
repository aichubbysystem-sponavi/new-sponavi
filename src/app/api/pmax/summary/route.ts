import { NextRequest, NextResponse } from "next/server";
import { getAccountSummary } from "@/lib/google-ads";
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

  const cacheKey = `summary:${customerId}:${startDate}:${endDate}`;
  const cached = await getPmaxCache<Record<string, unknown>>(cacheKey);
  if (cached) return NextResponse.json({ ...cached, cached: true });

  try {
    const summary = await getAccountSummary(customerId, startDate, endDate);
    setPmaxCache(cacheKey, summary);
    return NextResponse.json({ ...summary, cached: false });
  } catch (error: unknown) {
    console.error("Failed to get summary:", error);
    return NextResponse.json({ error: "サマリーの取得に失敗しました" }, { status: 500 });
  }
}
