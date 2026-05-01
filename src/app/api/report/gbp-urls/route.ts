import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const GBP_URL_SHEET_ID = "1uJtLvBz38xq86PkCOjeTtXkbe5Ez9IQGuChUbXD6Svg";

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let i = 0;
  while (i < text.length) {
    const row: string[] = [];
    while (i < text.length) {
      if (text[i] === '"') {
        i++; let f = "";
        while (i < text.length) {
          if (text[i] === '"') { if (i + 1 < text.length && text[i + 1] === '"') { f += '"'; i += 2; } else { i++; break; } }
          else { f += text[i]; i++; }
        }
        row.push(f);
        if (i < text.length && text[i] === ",") i++;
      } else {
        let f = "";
        while (i < text.length && text[i] !== "," && text[i] !== "\n" && text[i] !== "\r") { f += text[i]; i++; }
        row.push(f);
        if (i < text.length && text[i] === ",") i++; else break;
      }
    }
    while (i < text.length && (text[i] === "\n" || text[i] === "\r")) i++;
    if (row.some((c) => c)) rows.push(row);
  }
  return rows;
}

/**
 * GET /api/report/gbp-urls
 * 写真投稿用シートの全タブからA列=店舗名, B列=GBP URLのマッピングを返す
 */
export async function GET(request: NextRequest) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const { getOAuthToken } = await import("@/lib/gbp-token");
  const token = await getOAuthToken();

  // まずタブ一覧を取得
  const tabNames: string[] = [];
  try {
    const metaUrl = `https://docs.google.com/spreadsheets/d/${GBP_URL_SHEET_ID}/gviz/tq?tqx=out:csv&range=A1&sheet=`;
    // Google Sheets APIでシート一覧を取得
    if (token) {
      const sheetsRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${GBP_URL_SHEET_ID}?fields=sheets.properties.title`,
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) }
      );
      if (sheetsRes.ok) {
        const sheetsData = await sheetsRes.json();
        for (const s of sheetsData.sheets || []) {
          if (s.properties?.title) tabNames.push(s.properties.title);
        }
      }
    }
  } catch {}

  // タブ一覧が取得できなかった場合は一般的なタブ名を試す
  if (tabNames.length === 0) {
    tabNames.push("Sheet1", "シート1");
  }

  const mapping: Record<string, string> = {};

  for (const tab of tabNames) {
    try {
      const gvizUrl = `https://docs.google.com/spreadsheets/d/${GBP_URL_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;
      const headers: Record<string, string> = { "User-Agent": "Mozilla/5.0" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(gvizUrl, { headers, redirect: "follow", signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      const csvText = await res.text();
      if (csvText.includes("<!DOCTYPE") || csvText.includes("<html")) continue;
      const rows = parseCSV(csvText);
      for (let r = 1; r < rows.length; r++) {
        const shopName = (rows[r][0] || "").trim();
        const gbpUrl = (rows[r][1] || "").trim();
        if (shopName && gbpUrl && gbpUrl.startsWith("http")) {
          mapping[shopName] = gbpUrl;
        }
      }
    } catch {}
  }

  return NextResponse.json({ mapping, tabs: tabNames.length });
}
