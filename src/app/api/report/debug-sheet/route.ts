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
    keywords: data?.keywords?.map(k => `${k.word}: ${k.rank}位(前月${k.prevRank}位)`) ?? [],
  });
}
