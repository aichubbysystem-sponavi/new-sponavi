import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SPREADSHEET_ID = "1JpehMxL2I-fgef1sckNaY8RIUDIknvmT2OqhHj0my1k";
const GCP_API_KEY = process.env.GCP_API_KEY || "";

/**
 * GET /api/report/ranking-keywords?shopName=xxx
 * スプレッドシートから店舗のキーワードを取得
 * ※ GCP_API_KEY を使用（OAuthスコープ不要）
 */
export async function GET(request: NextRequest) {
  const shopName = request.nextUrl.searchParams.get("shopName");

  if (!GCP_API_KEY) {
    return NextResponse.json({ error: "GCP_API_KEYが設定されていません" }, { status: 500 });
  }

  try {
    // スプレッドシートのタブ一覧を取得
    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets.properties.title&key=${GCP_API_KEY}`
    );
    if (!metaRes.ok) {
      const errText = await metaRes.text().catch(() => "");
      return NextResponse.json({ error: `Sheets API error: ${metaRes.status} ${errText.slice(0, 200)}` }, { status: 500 });
    }
    const meta = await metaRes.json();
    const allTabs: string[] = meta.sheets.map((s: any) => s.properties.title);

    // Mr.ROAST CHICKENのインデックスを探す
    const startIdx = allTabs.indexOf("Mr.ROAST CHICKEN");
    if (startIdx === -1) {
      return NextResponse.json({ error: "Mr.ROAST CHICKENタブが見つかりません", tabs: allTabs.slice(0, 10) }, { status: 404 });
    }

    // 「←←これより左に新規店舗は追加」の前までが対象
    const endMarker = allTabs.findIndex((t) => t.includes("これより左に新規店舗は追加"));
    const targetTabs = endMarker > startIdx ? allTabs.slice(startIdx, endMarker) : allTabs.slice(startIdx);

    // 特定店舗のみ取得する場合
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

    // 全店舗のキーワードを取得
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

async function getKeywordsFromTab(tabName: string): Promise<{ keywords: string[]; debug?: string }> {
  try {
    const range = encodeURIComponent(`'${tabName}'!R1:AD1`);
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}?key=${GCP_API_KEY}`
    );
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return { keywords: [], debug: `Sheets API ${res.status}: ${errText.slice(0, 100)}` };
    }
    const data = await res.json();
    const row = data.values?.[0] || [];

    // R1~W1 = index 0~5, X1~Z1 = index 6~8 (前月比スキップ), AA1~AD1 = index 9~12
    const keywords: string[] = [];

    for (let i = 0; i <= 5; i++) {
      if (row[i] && !row[i].includes("前月比")) keywords.push(row[i]);
    }
    for (let i = 9; i <= 12; i++) {
      if (row[i] && !row[i].includes("前月比")) keywords.push(row[i]);
    }

    return { keywords: keywords.filter(Boolean) };
  } catch (err: any) {
    return { keywords: [], debug: `Error: ${err?.message}` };
  }
}
