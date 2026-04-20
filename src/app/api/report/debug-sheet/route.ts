import { NextRequest, NextResponse } from "next/server";
import { getReportFromSpreadsheet } from "@/lib/spreadsheet";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const shopName = request.nextUrl.searchParams.get("shop") || "みそラーメンのよし乃 札幌アピア店";

  // 実際のレポートデータを取得（スプレッドシートから直接）
  const data = await getReportFromSpreadsheet(shopName);

  if (!data) {
    return NextResponse.json({ error: "データなし", shopName });
  }

  // レポートに使われる実際の値を返す
  return NextResponse.json({
    shopName,
    shop: data.shop,
    kpis: data.kpis,
    reviewLabels: data.reviewLabels?.slice(-5),
    reviewCounts: data.reviewCounts?.slice(-5),
    reviewDelta: data.reviewDelta?.slice(-5),
    monthlyLabels: data.monthlyLabels?.slice(-3),
  });
}
