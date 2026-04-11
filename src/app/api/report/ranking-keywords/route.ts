import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SPREADSHEET_ID = "1JpehMxL2I-fgef1sckNaY8RIUDIknvmT2OqhHj0my1k";
const GCP_API_KEY = process.env.GCP_API_KEY || "";

/**
 * GET /api/report/ranking-keywords?shopName=xxx
 * スプレッドシートから店舗のキーワードを取得
 */
export async function GET(request: NextRequest) {
  const shopName = request.nextUrl.searchParams.get("shopName");

  if (!GCP_API_KEY) {
    return NextResponse.json({ error: "GCP_API_KEYが設定されていません" }, { status: 500 });
  }

  try {
    // スプレッドシートのタブ一覧を取得（API Key）
    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets.properties.title&key=${GCP_API_KEY}`
    );
    if (!metaRes.ok) {
      const errText = await metaRes.text().catch(() => "");
      return NextResponse.json({ error: `Sheets API error: ${metaRes.status} ${errText.slice(0, 200)}` }, { status: 500 });
    }
    const meta = await metaRes.json();
    const allTabs: string[] = meta.sheets.map((s: any) => s.properties.title);

    const startIdx = allTabs.indexOf("Mr.ROAST CHICKEN");
    if (startIdx === -1) {
      return NextResponse.json({ error: "Mr.ROAST CHICKENタブが見つかりません", tabs: allTabs.slice(0, 10) }, { status: 404 });
    }

    const endMarker = allTabs.findIndex((t) => t.includes("これより左に新規店舗は追加"));
    const targetTabs = endMarker > startIdx ? allTabs.slice(startIdx, endMarker) : allTabs.slice(startIdx);

    if (shopName) {
      const normalize = (s: string) => s.replace(/[\s　\.\-・]/g, "").toLowerCase();
      const normalized = normalize(shopName);
      const tab = targetTabs.find((t) => t === shopName)
        || targetTabs.find((t) => t.includes(shopName) || shopName.includes(t))
        || targetTabs.find((t) => normalize(t) === normalized);

      if (!tab) {
        const similar = targetTabs.filter((t) => {
          const nt = normalize(t);
          return nt.includes(normalized.slice(0, 5)) || normalized.includes(nt.slice(0, 5));
        }).slice(0, 5);
        return NextResponse.json({ keywords: [], shopName, found: false, availableTabs: similar, totalTabs: targetTabs.length });
      }

      const result = await getKeywordsFromTab(tab);
      return NextResponse.json({ keywords: result.keywords, shopName: tab, found: true, debug: result.debug, matchedTab: tab });
    }

    const results: { shopName: string; keywords: string[] }[] = [];
    for (const tab of targetTabs) {
      const result = await getKeywordsFromTab(tab);
      results.push({ shopName: tab, keywords: result.keywords });
    }

    return NextResponse.json({ shops: results, totalTabs: targetTabs.length });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "不明なエラー" }, { status: 500 });
  }
}

/**
 * 公開スプレッドシートからセル値を取得（認証不要のgviz URL使用）
 */
async function getKeywordsFromTab(tabName: string): Promise<{ keywords: string[]; debug?: string }> {
  try {
    // Google Visualization API（公開シートなら認証不要）
    const gvizUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}&range=R1:AD1`;

    const res = await fetch(gvizUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      redirect: "follow",
    });

    if (!res.ok) {
      // フォールバック: API Key方式
      const apiRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(`'${tabName}'!R1:AD1`)}?key=${GCP_API_KEY}`
      );
      if (!apiRes.ok) {
        const errText = await apiRes.text().catch(() => "");
        return { keywords: [], debug: `gviz ${res.status}, API ${apiRes.status}: ${errText.slice(0, 100)}` };
      }
      const apiData = await apiRes.json();
      return { keywords: extractKeywords(apiData.values?.[0] || []) };
    }

    const csvText = await res.text();
    // CSV形式: "value1","value2","value3",...
    const cells = parseCSVRow(csvText.trim());
    return { keywords: extractKeywords(cells) };
  } catch (err: any) {
    return { keywords: [], debug: `Error: ${err?.message}` };
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
      while (i < line.length && line[i] !== ",") { val += line[i]; i++; }
      cells.push(val);
      if (i < line.length) i++;
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
