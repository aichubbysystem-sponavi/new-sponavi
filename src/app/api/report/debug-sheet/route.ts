import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SHEET3_ID = "1ZyBiy_TYO_xqdyEItXmjS4k4ORagLjN3C5KWetSe1vY";
const SHEET3_GID = "17303928";

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

export async function GET(request: NextRequest) {
  const shopName = request.nextUrl.searchParams.get("shop") || "みそラーメンのよし乃 札幌アピア店";

  const url = `https://docs.google.com/spreadsheets/d/${SHEET3_ID}/export?format=csv&gid=${SHEET3_GID}`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: { "User-Agent": "Mozilla/5.0" },
    redirect: "follow",
  });

  if (!res.ok) {
    return NextResponse.json({ error: `Fetch failed: ${res.status}` });
  }

  const text = await res.text();
  const lines = text.split("\n");

  // ヘッダー
  const header = parseCSVLine(lines[0]);

  // この店舗の全行を取得
  const shopRows: { csvRowIndex: number; date: string; cols5to16: string[] }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols[2]?.trim() === shopName) {
      shopRows.push({
        csvRowIndex: i,
        date: cols[1]?.trim() || "",
        cols5to16: cols.slice(5, 17).map((v, j) => `${header[j + 5] || `col${j+5}`}: ${v}`),
      });
    }
  }

  // 最後の3行（レポートで使われるcurとprev）
  const lastRows = shopRows.slice(-3);

  return NextResponse.json({
    shopName,
    totalCSVRows: lines.length,
    headerCols5to16: header.slice(5, 17).map((h, i) => `${i + 5}:${h}`),
    totalShopRows: shopRows.length,
    lastThreeRows: lastRows,
    // スプレッドシートのF列 = CSV col 5 の値
    latestSearchMobile: lastRows.length > 0 ? lastRows[lastRows.length - 1].cols5to16[0] : "N/A",
  });
}
