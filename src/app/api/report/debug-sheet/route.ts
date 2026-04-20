import { NextRequest, NextResponse } from "next/server";
import { getReportFromSpreadsheet } from "@/lib/spreadsheet";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const shopName = request.nextUrl.searchParams.get("shop") || "みそラーメンのよし乃 札幌アピア店";

  const data = await getReportFromSpreadsheet(shopName);

  if (!data) {
    return NextResponse.json({ error: "データなし", shopName });
  }

  return NextResponse.json({
    shopName,
    totalReviews: data.shop.totalReviews,
    rating: data.shop.rating,
    reviewCounts_last5: data.reviewCounts?.slice(-5),
    reviewLabels_last5: data.reviewLabels?.slice(-5),
    kpi_review: data.kpis[data.kpis.length - 1],
    kpi_search: data.kpis[0],
    period: data.shop.period,
  });
}
