import { NextRequest, NextResponse } from "next/server";
import { getReportFromSpreadsheet } from "@/lib/spreadsheet";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const shopName = request.nextUrl.searchParams.get("shop") || "みそラーメンのよし乃 札幌アピア店";

  // 方法1: spreadsheet.tsの実コードパスで取得
  const reportData = await getReportFromSpreadsheet(shopName);

  // 方法2: 直接CSVを取得してcol5を確認
  const SHEET2_ID = "1czdHEs0cc2ci01uTlTgezVsuOGCHOBH6oyEGJAY-Ofk";
  const SHEET2_GID = "806898743";
  let directCol5 = "N/A";
  try {
    const res = await fetch(
      `https://docs.google.com/spreadsheets/d/${SHEET2_ID}/export?format=csv&gid=${SHEET2_GID}`,
      { cache: "no-store", headers: { "User-Agent": "Mozilla/5.0" }, redirect: "follow" }
    );
    if (res.ok) {
      const text = await res.text();
      for (const line of text.split(/\r?\n/).slice(2)) {
        if (line.startsWith(shopName)) {
          const parts = line.split(",");
          directCol5 = parts[5] || "empty";
          break;
        }
      }
    }
  } catch {}

  return NextResponse.json({
    shopName,
    // spreadsheet.tsの結果
    fromSpreadsheetTS: {
      totalReviews: reportData?.shop.totalReviews ?? "null",
      rating: reportData?.shop.rating ?? "null",
      lastReviewCount: reportData?.reviewCounts?.slice(-1)[0] ?? "null",
    },
    // 直接CSV読みの結果
    directCSV: {
      col5_value: directCol5,
    },
    match: reportData?.shop.totalReviews === parseInt(directCol5) ? "一致" : `不一致！ spreadsheet.ts=${reportData?.shop.totalReviews} vs CSV=${directCol5}`,
  });
}
