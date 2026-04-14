import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SPREADSHEET_ID = "1JpehMxL2I-fgef1sckNaY8RIUDIknvmT2OqhHj0my1k";

/**
 * GET /api/report/ranking-keywords?shopName=xxx
 * 公開スプレッドシートから店舗のキーワードを取得
 * ※ Google Sheets API v4 は一切使わず、公開gviz URLのみ使用（認証不要）
 */
export async function GET(request: NextRequest) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  const shopName = request.nextUrl.searchParams.get("shopName");

  if (!shopName) {
    return NextResponse.json({ error: "shopNameが必要です" }, { status: 400 });
  }

  // 店舗名でそのままタブを取得してみる（完全一致 → 部分変形の順）
  const variants = generateNameVariants(shopName);

  // monthパラメータ（オプション）: "2026-03"形式。レポートの対象月
  const month = request.nextUrl.searchParams.get("month") || "";

  for (const tabName of variants) {
    const result = await fetchKeywordsWithRanks(tabName, month);
    if (result.success) {
      return NextResponse.json({
        keywords: result.keywords,
        ranks: result.ranks,
        shopName: tabName,
        found: true,
        matchedTab: tabName,
        matchedMonth: result.matchedMonth,
      });
    }
  }

  return NextResponse.json({
    keywords: [],
    ranks: [],
    shopName,
    found: false,
    triedTabs: variants,
  });
}

/**
 * 店舗名のバリエーションを生成（タブ名との不一致を吸収）
 */
function generateNameVariants(name: string): string[] {
  const variants = new Set<string>();
  variants.add(name);                                    // そのまま
  variants.add(name.replace(/\s+/g, " ").trim());       // 余分なスペース除去
  variants.add(name.replace(/\./g, "．"));                // 半角→全角ドット
  variants.add(name.replace(/．/g, "."));                 // 全角→半角ドット
  variants.add(name.replace(/\s/g, ""));                 // スペースなし
  variants.add(name.replace(/\s/g, "　"));                // 半角→全角スペース
  return Array.from(variants);
}

/**
 * スプレッドシートからKW名+順位を取得（ヘッダー行+最終行のB列日付で月一致）
 */
async function fetchKeywordsWithRanks(tabName: string, targetMonth: string): Promise<{
  success: boolean; keywords: string[]; ranks: { word: string; rank: number; prevRank: number }[]; matchedMonth: string;
}> {
  try {
    // 全データ取得（A列〜AD列）
    const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      redirect: "follow",
    });

    if (!res.ok) return { success: false, keywords: [], ranks: [], matchedMonth: "" };
    const text = await res.text();
    if (text.includes("<!DOCTYPE") || text.includes("<html") || text.includes("Invalid sheet")) {
      return { success: false, keywords: [], ranks: [], matchedMonth: "" };
    }

    // CSV全行パース
    const lines = text.split("\n").filter(l => l.trim());
    if (lines.length < 2) return { success: false, keywords: [], ranks: [], matchedMonth: "" };

    const headerRow = parseCSVRow(lines[0]);
    const keywords = extractKeywords(headerRow);

    // 最終行から月を判定し、一致する行と前月行を見つける
    // B列（index 1）に日付: "2026/03/01" or "2026/3/1" 形式
    const dataRows = lines.slice(1).map(l => parseCSVRow(l));

    // 対象月の行を探す（targetMonthが指定されていればその月、なければ最終行）
    let targetRow: string[] | null = null;
    let prevRow: string[] | null = null;
    let matchedMonth = "";

    if (targetMonth) {
      // "2026-03" → "2026/3" or "2026/03" でマッチ
      const [ty, tm] = targetMonth.split("-").map(Number);
      for (let i = dataRows.length - 1; i >= 0; i--) {
        const dateCell = (dataRows[i][1] || "").trim();
        const m = dateCell.match(/(\d{4})\/(\d{1,2})/);
        if (m && parseInt(m[1]) === ty && parseInt(m[2]) === tm) {
          targetRow = dataRows[i];
          matchedMonth = `${ty}-${String(tm).padStart(2, "0")}`;
          // 前月の行を探す
          const prevMonth = tm === 1 ? 12 : tm - 1;
          const prevYear = tm === 1 ? ty - 1 : ty;
          for (let j = i - 1; j >= 0; j--) {
            const pd = (dataRows[j][1] || "").trim();
            const pm = pd.match(/(\d{4})\/(\d{1,2})/);
            if (pm && parseInt(pm[1]) === prevYear && parseInt(pm[2]) === prevMonth) {
              prevRow = dataRows[j];
              break;
            }
          }
          break;
        }
      }
    }

    // targetMonthが指定されていないか見つからない場合は最終行
    if (!targetRow && dataRows.length > 0) {
      targetRow = dataRows[dataRows.length - 1];
      prevRow = dataRows.length >= 2 ? dataRows[dataRows.length - 2] : null;
      const dateCell = (targetRow[1] || "").trim();
      const m = dateCell.match(/(\d{4})\/(\d{1,2})/);
      if (m) matchedMonth = `${m[1]}-${String(parseInt(m[2])).padStart(2, "0")}`;
    }

    if (!targetRow) return { success: true, keywords, ranks: [], matchedMonth: "" };

    // KW列のインデックス: R=17, S=18, T=19, U=20, V=21, W=22, X=23(前月比skip), Y=24(skip), Z=25(skip), AA=26, AB=27, AC=28, AD=29
    const kwIndices = [17, 18, 19, 20, 21, 22, 26, 27, 28, 29];
    const ranks: { word: string; rank: number; prevRank: number }[] = [];

    for (const idx of kwIndices) {
      const kwName = (headerRow[idx] || "").trim();
      if (!kwName || kwName.includes("前月比")) continue;
      const rank = parseInt((targetRow[idx] || "0").replace(/,/g, "")) || 0;
      const prevRank = prevRow ? (parseInt((prevRow[idx] || "0").replace(/,/g, "")) || 0) : 0;
      if (kwName) ranks.push({ word: kwName, rank, prevRank: prevRank || rank });
    }

    return { success: true, keywords, ranks, matchedMonth };
  } catch {
    return { success: false, keywords: [], ranks: [], matchedMonth: "" };
  }
}

function parseCSVRow(line: string): string[] {
  const cells: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      i++;
      let val = "";
      while (i < line.length) {
        if (line[i] === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') { val += '"'; i += 2; }
          else { i++; break; }
        } else { val += line[i]; i++; }
      }
      cells.push(val);
      if (i < line.length && line[i] === ",") i++;
    } else {
      let val = "";
      while (i < line.length && line[i] !== "," && line[i] !== "\n" && line[i] !== "\r") { val += line[i]; i++; }
      cells.push(val);
      if (i < line.length && line[i] === ",") i++;
    }
  }
  return cells;
}

function extractKeywords(row: string[]): string[] {
  const keywords: string[] = [];
  // R1~W1 (index 0~5)
  for (let i = 0; i <= 5; i++) {
    if (row[i] && !row[i].includes("前月比")) keywords.push(row[i]);
  }
  // AA1~AD1 (index 9~12)
  for (let i = 9; i <= 12; i++) {
    if (row[i] && !row[i].includes("前月比")) keywords.push(row[i]);
  }
  return keywords.filter(Boolean);
}
