/**
 * GET /api/pmax/list-stores?month=YYYY-MM
 * Google Ads APIから全店舗名を取得（同期前の店舗一覧表示用）
 * DB未同期でも店舗カードを表示してチェックボックスで選べるようにする
 */
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/supabase";
import { getStoreSummaries } from "@/lib/google-ads";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const r = await requireRole(request, ["president", "manager"]);
  if (r.error) return r.error;

  const { searchParams } = request.nextUrl;
  const month = searchParams.get("month");

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "month は YYYY-MM 形式で指定してください" }, { status: 400 });
  }

  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const mon = Number(monthStr);
  const startDate = `${year}-${String(mon).padStart(2, "0")}-01`;
  const lastDay = new Date(year, mon, 0).getDate();
  const endDate = `${year}-${String(mon).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  try {
    const stores = await getStoreSummaries(startDate, endDate);
    return NextResponse.json({
      stores: stores.map((s) => ({
        shopName: s.shopName,
        languages: s.languages,
        impressions: s.impressions,
        clicks: s.clicks,
        costMicros: s.costMicros,
      })),
    });
  } catch (error: unknown) {
    console.error("[pmax/list-stores] Error:", error);
    return NextResponse.json({ error: "店舗一覧の取得に失敗しました" }, { status: 500 });
  }
}
