import { NextRequest, NextResponse } from "next/server";
import { getStoreSummaries } from "@/lib/google-ads";
import { requireRole } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET /api/pmax/store-summary?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 * 全アカウント横断で店舗別サマリーを返す
 */
export async function GET(request: NextRequest) {
  const r = await requireRole(request, ["president", "manager"]);
  if (r.error) return r.error;

  const { searchParams } = request.nextUrl;
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  if (!startDate || !endDate) {
    return NextResponse.json({ error: "startDate, endDate は必須です" }, { status: 400 });
  }

  try {
    const stores = await getStoreSummaries(startDate, endDate);
    return NextResponse.json({ stores });
  } catch (error: unknown) {
    console.error("[pmax/store-summary] Error:", error);
    return NextResponse.json({ error: "店舗サマリーの取得に失敗しました" }, { status: 500 });
  }
}
