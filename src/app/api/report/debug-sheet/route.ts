import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SHEET2_ID = "1czdHEs0cc2ci01uTlTgezVsuOGCHOBH6oyEGJAY-Ofk";
const SHEET2_GID = "806898743";
const SHEET3_ID = "1ZyBiy_TYO_xqdyEItXmjS4k4ORagLjN3C5KWetSe1vY";
const SHEET3_GID = "17303928";

async function fetchRaw(sheetId: string, gid: string): Promise<string | null> {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0" },
      redirect: "follow",
    });
    if (!res.ok) return `HTTP ${res.status}`;
    return await res.text();
  } catch (e: any) {
    return `Error: ${e?.message}`;
  }
}

export async function GET(request: NextRequest) {
  const shopName = request.nextUrl.searchParams.get("shop") || "みそラーメンのよし乃 札幌アピア店";

  // Sheet3: パフォーマンス
  const sheet3Raw = await fetchRaw(SHEET3_ID, SHEET3_GID);
  let sheet3Info: any = { error: "fetch failed" };
  if (sheet3Raw && !sheet3Raw.startsWith("HTTP") && !sheet3Raw.startsWith("Error")) {
    const lines = sheet3Raw.split("\n");
    const header = lines[0];
    // ヘッダーをパース（最初の20列）
    const headerCols = parseCSVLine(header);
    sheet3Info = {
      totalRows: lines.length,
      headerCols: headerCols.slice(0, 20).map((h, i) => `${i}:${h}`),
    };
    // 指定店舗のデータ行を探す
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      if (cols[2]?.includes(shopName)) {
        sheet3Info.shopRow = {
          rowIndex: i,
          cols: cols.slice(0, 20).map((v, j) => `${j}:${v}`),
        };
        break;
      }
    }
  }

  // Sheet2: 口コミ
  const sheet2Raw = await fetchRaw(SHEET2_ID, SHEET2_GID);
  let sheet2Info: any = { error: "fetch failed" };
  if (sheet2Raw && !sheet2Raw.startsWith("HTTP") && !sheet2Raw.startsWith("Error")) {
    const lines = sheet2Raw.split("\n");
    const header = lines[0];
    const headerCols = parseCSVLine(header);
    // 日付列を探す
    const monthCols: string[] = [];
    for (let i = 0; i < headerCols.length; i++) {
      if (/\d{4}年\d{1,2}月/.test(headerCols[i])) {
        monthCols.push(`${i}:${headerCols[i]}`);
      }
    }
    sheet2Info = {
      totalRows: lines.length,
      headerFirst15: headerCols.slice(0, 15).map((h, i) => `${i}:${h}`),
      monthColumns: monthCols,
    };
    // 指定店舗のデータ行を探す
    for (let i = 2; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      if (cols[0]?.includes(shopName)) {
        sheet2Info.shopRow = {
          rowIndex: i,
          colsFirst10: cols.slice(0, 10).map((v, j) => `${j}:${v}`),
          // 最後の月別データ（末尾6列）
          colsLast6: cols.slice(-6).map((v, j) => `${cols.length - 6 + j}:${v}`),
        };
        break;
      }
    }
  }

  return NextResponse.json({ shopName, sheet3: sheet3Info, sheet2: sheet2Info });
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      i++;
      let field = "";
      while (i < line.length) {
        if (line[i] === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') { field += '"'; i += 2; }
          else { i++; break; }
        } else { field += line[i]; i++; }
      }
      result.push(field);
      if (i < line.length && line[i] === ",") i++;
    } else {
      let field = "";
      while (i < line.length && line[i] !== "," && line[i] !== "\n" && line[i] !== "\r") { field += line[i]; i++; }
      result.push(field);
      if (i < line.length && line[i] === ",") i++;
      else break;
    }
  }
  return result;
}
