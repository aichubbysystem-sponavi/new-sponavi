import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SHEET2_ID = "1czdHEs0cc2ci01uTlTgezVsuOGCHOBH6oyEGJAY-Ofk";
const SHEET2_GID = "806898743";

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

function numParse(s: string | undefined): number {
  if (!s) return 0;
  const n = parseInt(s.replace(/,/g, "").trim(), 10);
  return isNaN(n) ? 0 : n;
}

function floatParse(s: string | undefined): number {
  if (!s) return 0;
  const n = parseFloat(s.replace(/,/g, "").trim());
  return isNaN(n) ? 0 : n;
}

export async function GET(request: NextRequest) {
  const shopName = request.nextUrl.searchParams.get("shop") || "みそラーメンのよし乃 札幌アピア店";

  const url = `https://docs.google.com/spreadsheets/d/${SHEET2_ID}/export?format=csv&gid=${SHEET2_GID}`;
  const res = await fetch(url, { cache: "no-store", headers: { "User-Agent": "Mozilla/5.0" }, redirect: "follow" });

  if (!res.ok) return NextResponse.json({ error: `Fetch failed: ${res.status}` });

  const text = await res.text();
  const lines = text.split(/\r?\n/);

  // ヘッダー行
  const headerCols = parseCSVLine(lines[0]);

  // 月列を検出
  const monthCols: { col: number; label: string }[] = [];
  for (let c = 0; c < headerCols.length; c++) {
    if (/\d{4}年\d{1,2}月/.test(headerCols[c])) {
      monthCols.push({ col: c, label: headerCols[c] });
    }
  }

  // 店舗行を全て検索（重複チェック）
  const allMatches: any[] = [];
  for (let i = 2; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols[0]?.trim() !== shopName) continue;

    // サマリー列
    const summaryRating = floatParse(cols[4]);
    const summaryCount = numParse(cols[5]);
    const deltaStr = cols[7] || "";

    // 月別データの最後の値
    let lastMonthLabel = "";
    let lastMonthRating = 0;
    let lastMonthCount = 0;
    for (const mc of monthCols) {
      const rating = floatParse(cols[mc.col]);
      const count = numParse(cols[mc.col + 1]);
      if (rating > 0 || count > 0) {
        lastMonthLabel = mc.label;
        lastMonthRating = rating;
        lastMonthCount = count;
      }
    }

    const finalCount = summaryCount > 0 ? summaryCount : lastMonthCount;

    allMatches.push({
      csvRow: i,
      col5_summaryCount: cols[5],
      col7_delta: cols[7],
      summaryCount,
      lastMonthLabel,
      lastMonthCount,
      finalCount,
    });
  }

  return NextResponse.json({
    shopName,
    totalMatches: allMatches.length,
    matches: allMatches,
    monthColumnsTotal: monthCols.length,
    note: allMatches.length > 1 ? "重複行あり！最後の行がレポートに使われます" : "重複なし",
  });
}
