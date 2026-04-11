import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const SPREADSHEET_ID = "1JpehMxL2I-fgef1sckNaY8RIUDIknvmT2OqhHj0my1k";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
}

async function getOAuthToken(): Promise<string | null> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("system_oauth_tokens")
    .select("access_token, refresh_token, expiry")
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  const expiry = new Date(data.expiry);
  if (expiry.getTime() - Date.now() > 5 * 60 * 1000) return data.access_token;

  // リフレッシュ
  const GBP_CLIENT_ID = process.env.GBP_CLIENT_ID || "";
  const GBP_CLIENT_SECRET = process.env.GBP_CLIENT_SECRET || "";
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GBP_CLIENT_ID,
        client_secret: GBP_CLIENT_SECRET,
        refresh_token: data.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) return data.access_token;
    const tokenData = await res.json();
    await fetch(`${SUPABASE_URL}/rest/v1/tokens?account_id=not.is.null`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY}`,
        "Content-Profile": "system",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        access_token: tokenData.access_token,
        expiry: new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString(),
      }),
    });
    return tokenData.access_token;
  } catch {
    return data.access_token;
  }
}

/**
 * GET /api/report/ranking-keywords?shopName=xxx
 * スプレッドシートから店舗のキーワードを取得
 */
export async function GET(request: NextRequest) {
  const shopName = request.nextUrl.searchParams.get("shopName");

  const accessToken = await getOAuthToken();
  if (!accessToken) {
    return NextResponse.json({ error: "OAuthトークンが見つかりません" }, { status: 500 });
  }

  try {
    // スプレッドシートのタブ一覧を取得
    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets.properties.title`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!metaRes.ok) {
      return NextResponse.json({ error: `Sheets API error: ${metaRes.status}` }, { status: 500 });
    }
    const meta = await metaRes.json();
    const allTabs: string[] = meta.sheets.map((s: any) => s.properties.title);

    // Mr.ROAST CHICKENのインデックスを探す
    const startIdx = allTabs.indexOf("Mr.ROAST CHICKEN");
    if (startIdx === -1) {
      return NextResponse.json({ error: "Mr.ROAST CHICKENタブが見つかりません" }, { status: 404 });
    }

    // 「←←これより左に新規店舗は追加」の前までが対象
    const endMarker = allTabs.findIndex((t) => t.includes("これより左に新規店舗は追加"));
    const targetTabs = endMarker > startIdx ? allTabs.slice(startIdx, endMarker) : allTabs.slice(startIdx);

    // 特定店舗のみ取得する場合
    if (shopName) {
      // 完全一致 → 部分一致 → 正規化一致 の順で検索
      const normalize = (s: string) => s.replace(/[\s　\.\-・]/g, "").toLowerCase();
      const normalized = normalize(shopName);
      let tab = targetTabs.find((t) => t === shopName)
        || targetTabs.find((t) => t.includes(shopName) || shopName.includes(t))
        || targetTabs.find((t) => normalize(t) === normalized);

      if (!tab) {
        // 候補タブ名を返す（デバッグ用）
        const similar = targetTabs.filter((t) => {
          const nt = normalize(t);
          return nt.includes(normalized.slice(0, 5)) || normalized.includes(nt.slice(0, 5));
        }).slice(0, 5);
        return NextResponse.json({ keywords: [], shopName, found: false, availableTabs: similar, totalTabs: targetTabs.length });
      }

      const result = await getKeywordsFromTab(accessToken, tab);
      return NextResponse.json({ keywords: result.keywords, shopName: tab, found: true, debug: result.debug, matchedTab: tab });
    }

    // 全店舗のキーワードを取得
    const results: { shopName: string; keywords: string[] }[] = [];
    for (const tab of targetTabs) {
      const result = await getKeywordsFromTab(accessToken, tab);
      results.push({ shopName: tab, keywords: result.keywords });
    }

    return NextResponse.json({ shops: results, totalTabs: targetTabs.length });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "不明なエラー" }, { status: 500 });
  }
}

async function getKeywordsFromTab(accessToken: string, tabName: string): Promise<{ keywords: string[]; debug?: string }> {
  try {
    const range = encodeURIComponent(`'${tabName}'!R1:AD1`);
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return { keywords: [], debug: `Sheets API ${res.status}: ${errText.slice(0, 100)}` };
    }
    const data = await res.json();
    const row = data.values?.[0] || [];

    // R1~W1 = index 0~5, X1~Z1 = index 6~8 (前月比、スキップ), AA1~AD1 = index 9~12
    const keywords: string[] = [];

    // R1~W1 (インデックス 0~5)
    for (let i = 0; i <= 5; i++) {
      if (row[i] && !row[i].includes("前月比")) keywords.push(row[i]);
    }

    // AA1~AD1 (インデックス 9~12)
    for (let i = 9; i <= 12; i++) {
      if (row[i] && !row[i].includes("前月比")) keywords.push(row[i]);
    }

    return { keywords: keywords.filter(Boolean) };
  } catch (err: any) {
    return { keywords: [], debug: `Error: ${err?.message}` };
  }
}
