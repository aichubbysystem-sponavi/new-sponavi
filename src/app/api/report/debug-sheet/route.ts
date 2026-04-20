import { NextRequest, NextResponse } from "next/server";
import { getReportFromSpreadsheet } from "@/lib/spreadsheet";

export const dynamic = "force-dynamic";

// spreadsheet.tsと全く同じparseCSV関数をコピー
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let i = 0;
  const len = text.length;
  while (i < len) {
    const row: string[] = [];
    while (i < len) {
      if (text[i] === '"') {
        i++;
        let field = "";
        while (i < len) {
          if (text[i] === '"') {
            if (i + 1 < len && text[i + 1] === '"') {
              field += '"';
              i += 2;
            } else {
              i++;
              break;
            }
          } else {
            field += text[i];
            i++;
          }
        }
        row.push(field);
        if (i < len && text[i] === ",") i++;
      } else {
        let field = "";
        while (i < len && text[i] !== "," && text[i] !== "\n" && text[i] !== "\r") {
          field += text[i];
          i++;
        }
        row.push(field);
        if (i < len && text[i] === ",") {
          i++;
        } else {
          break;
        }
      }
    }
    while (i < len && (text[i] === "\n" || text[i] === "\r")) i++;
    if (row.length > 1 || (row.length === 1 && row[0] !== "")) {
      rows.push(row);
    }
  }
  return rows;
}

export async function GET(request: NextRequest) {
  const shopName = request.nextUrl.searchParams.get("shop") || "みそラーメンのよし乃 札幌アピア店";

  const SHEET2_ID = "1czdHEs0cc2ci01uTlTgezVsuOGCHOBH6oyEGJAY-Ofk";
  const SHEET2_GID = "806898743";
  const url = `https://docs.google.com/spreadsheets/d/${SHEET2_ID}/export?format=csv&gid=${SHEET2_GID}`;

  const res = await fetch(url, { cache: "no-store", headers: { "User-Agent": "Mozilla/5.0" }, redirect: "follow" });
  if (!res.ok) return NextResponse.json({ error: `Fetch: ${res.status}` });

  const text = await res.text();

  // parseCSVで解析
  const rows = parseCSV(text);

  // 直接split解析
  const lines = text.split(/\r?\n/);

  // この店舗を両方で検索
  let parseCsvResult: any = null;
  let splitResult: any = null;

  // parseCSV版
  for (let i = 2; i < rows.length; i++) {
    if (rows[i][0]?.trim() === shopName) {
      parseCsvResult = {
        rowIndex: i,
        totalCols: rows[i].length,
        cols0to9: rows[i].slice(0, 10).map((v, j) => `${j}:${v}`),
      };
      break;
    }
  }

  // split版
  for (let i = 2; i < lines.length; i++) {
    const parts = lines[i].split(",");
    if (parts[0]?.trim() === shopName) {
      splitResult = {
        lineIndex: i,
        totalParts: parts.length,
        parts0to9: parts.slice(0, 10).map((v, j) => `${j}:${v}`),
      };
      break;
    }
  }

  // 方法3: spreadsheet.tsのgetReportFromSpreadsheetを呼ぶ
  const reportData = await getReportFromSpreadsheet(shopName);

  return NextResponse.json({
    shopName,
    directCSV_col5: parseCsvResult ? rows[parseCsvResult.rowIndex][5] : "N/A",
    spreadsheetTS_totalReviews: reportData?.shop.totalReviews ?? "null",
    spreadsheetTS_lastReviewCount: reportData?.reviewCounts?.slice(-1)[0] ?? "null",
    match: reportData?.shop.totalReviews === parseInt(rows[parseCsvResult?.rowIndex ?? 0]?.[5] || "0")
      ? "一致！"
      : `不一致: spreadsheet.ts=${reportData?.shop.totalReviews} vs CSV col5=${parseCsvResult ? rows[parseCsvResult.rowIndex][5] : "N/A"}`,
  });
}
