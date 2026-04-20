import { NextRequest, NextResponse } from "next/server";
import { getReportFromSpreadsheet } from "@/lib/spreadsheet";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const shopName = request.nextUrl.searchParams.get("shop") || "エミナルクリニック 旭川院";

  const data = await getReportFromSpreadsheet(shopName);

  return NextResponse.json({
    shopName,
    hasData: !!data,
    keywordsCount: data?.keywords?.length ?? 0,
    keywords: data?.keywords ?? [],
    baseUrl: process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL || "not set",
  });
}
