import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SPREADSHEET_ID = "1JpehMxL2I-fgef1sckNaY8RIUDIknvmT2OqhHj0my1k";

/**
 * GET /api/report/ranking-keywords?shopName=xxx
 * 公開スプレッドシートから店舗のキーワードを取得
 * ※ Google Sheets API v4 は一切使わず、公開gviz URLのみ使用（認証不要）
 */
export async function GET(request: NextRequest) {
  const shopName = request.nextUrl.searchParams.get("shopName");

  if (!shopName) {
    return NextResponse.json({ error: "shopNameが必要です" }, { status: 400 });
  }

  // 店舗名でそのままタブを取得してみる（完全一致 → 部分変形の順）
  const variants = generateNameVariants(shopName);

  for (const tabName of variants) {
    const result = await fetchKeywordsFromGviz(tabName);
    if (result.success) {
      return NextResponse.json({
        keywords: result.keywords,
        shopName: tabName,
        found: true,
        matchedTab: tabName,
      });
    }
  }

  return NextResponse.json({
    keywords: [],
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
 * Google Visualization API（gviz）で公開シートからCSVデータを取得
 * 認証不要 - スプレッドシートが「リンクを知っている全員」に共有されていれば動作
 */
async function fetchKeywordsFromGviz(tabName: string): Promise<{ success: boolean; keywords: string[] }> {
  try {
    const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}&range=R1:AD1`;

    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      redirect: "follow",
    });

    if (!res.ok) {
      return { success: false, keywords: [] };
    }

    const text = await res.text();

    // gvizがエラーページ（HTML）を返す場合がある
    if (text.includes("<!DOCTYPE") || text.includes("<html") || text.includes("google.visualization.Query.setResponse")) {
      // JSON形式のエラーレスポンスの場合
      if (text.includes("Invalid sheet")) {
        return { success: false, keywords: [] };
      }
      return { success: false, keywords: [] };
    }

    const cells = parseCSVRow(text.trim());
    const keywords = extractKeywords(cells);

    return { success: true, keywords };
  } catch {
    return { success: false, keywords: [] };
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
