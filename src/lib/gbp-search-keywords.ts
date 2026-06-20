/**
 * GBP Business Profile Performance API — 検索語句取得
 *
 * 優先順序: search_query_cache → Performance API → スプレッドシート
 * トークン: RPAchubbyプロジェクトのDBリフレッシュトークン（Quota 300/min）
 *
 * 修正: 並列フェッチ + タイムアウト対策 + ログ強化
 * v2: JST固定 / IDベース / 月ソート修正 / syncShopSearchKeywords統一関数
 */

import { getSupabase } from "@/lib/supabase";

const GBP_CLIENT_ID = process.env.GBP_CLIENT_ID || "";
const GBP_CLIENT_SECRET = process.env.GBP_CLIENT_SECRET || "";


export interface MonthlyKeywords {
  month: string; // "2026/5"
  keywords: { word: string; count: number }[];
}

/** "YYYY/M" 形式の月文字列を数値比較（localeCompareでは10月以降が壊れるため） */
export function compareMonths(a: string, b: string): number {
  const [ay, am] = a.split("/").map(Number);
  const [by, bm] = b.split("/").map(Number);
  return ay !== by ? ay - by : am - bm;
}

/** JST基準で前月を "YYYY/M" 形式で返す（Vercel=UTCでも正しく動作） */
export function getExpectedMonthJST(): string {
  const nowJST = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const d = new Date(nowJST.getUTCFullYear(), nowJST.getUTCMonth() - 1, 1);
  return `${d.getFullYear()}/${d.getMonth() + 1}`;
}

/**
 * RPAchubbyプロジェクトのOAuthクライアントでトークン取得（Performance API用）
 */
async function getPerformanceApiToken(): Promise<string | null> {
  if (!GBP_CLIENT_ID || !GBP_CLIENT_SECRET) {
    console.log("[gbp-keywords] GBP_CLIENT_ID or GBP_CLIENT_SECRET not set");
    return null;
  }

  const supabase = getSupabase();
  let refreshToken = "";

  try {
    const { data } = await supabase
      .from("system_oauth_tokens")
      .select("refresh_token")
      .limit(1)
      .maybeSingle();
    if (data) refreshToken = data.refresh_token;
  } catch (e) {
    console.error("[gbp-keywords] Failed to get refresh token from DB:", e);
  }

  if (!refreshToken) {
    console.log("[gbp-keywords] No refresh_token in system_oauth_tokens");
    return null;
  }

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GBP_CLIENT_ID,
        client_secret: GBP_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.error("[gbp-keywords] Token refresh failed:", res.status);
      return null;
    }
    const data = await res.json();
    if (data.access_token) {
      console.log("[gbp-keywords] Performance API token obtained (RPAchubby DB)");
      return data.access_token;
    }
    console.error("[gbp-keywords] Token refresh response has no access_token");
    return null;
  } catch (e) {
    console.error("[gbp-keywords] Token refresh error:", e);
    return null;
  }
}

/**
 * Performance APIから検索語句を取得（1ロケーション・1ヶ月分）
 */
async function fetchOneMonth(
  locPart: string,
  year: number,
  month: number,
  token: string
): Promise<MonthlyKeywords | null> {
  const url = `https://businessprofileperformance.googleapis.com/v1/${locPart}/searchkeywords/impressions/monthly?monthlyRange.startMonth.year=${year}&monthlyRange.startMonth.month=${month}&monthlyRange.endMonth.year=${year}&monthlyRange.endMonth.month=${month}`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`[gbp-keywords] API ${res.status} for ${year}/${month}: ${errText.slice(0, 500)}`);
      console.error(`[gbp-keywords] URL: ${url}`);
      return null;
    }

    const data = await res.json();
    const keywords: { word: string; count: number }[] = [];

    for (const item of data.searchKeywordsCounts || []) {
      const word = item.searchKeyword || "";
      const raw = item.insightsValue?.value;
      const count = typeof raw === "string" ? parseInt(raw, 10) || 0 : raw || 0;
      if (word && count > 0) {
        keywords.push({ word, count });
      }
    }

    if (keywords.length === 0) return null;
    return {
      month: `${year}/${month}`,
      keywords: keywords.sort((a, b) => b.count - a.count),
    };
  } catch (e) {
    console.error(`[gbp-keywords] Fetch error ${year}/${month}:`, e);
    return null;
  }
}

/**
 * 指定店舗の検索語句を複数月分API取得（4並列バッチ）
 */
export async function fetchSearchKeywordsFromGBP(
  locationPath: string,
  months: number = 13
): Promise<MonthlyKeywords[]> {
  const token = await getPerformanceApiToken();
  if (!token) return [];

  // locations/XXX 形式に正規化
  const locPart = locationPath.includes("/")
    ? locationPath.split("/").slice(-2).join("/")
    : locationPath;

  const now = new Date();
  const monthTargets: { year: number; month: number }[] = [];
  for (let i = 1; i <= months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthTargets.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }

  // 4並列バッチで取得（レート制限回避しつつ高速化）
  const results: MonthlyKeywords[] = [];
  for (let i = 0; i < monthTargets.length; i += 4) {
    const batch = monthTargets.slice(i, i + 4);
    const batchResults = await Promise.all(
      batch.map((t) => fetchOneMonth(locPart, t.year, t.month, token))
    );
    for (const r of batchResults) {
      if (r) results.push(r);
    }
  }

  results.sort((a, b) => compareMonths(a.month, b.month));
  console.log(`[gbp-keywords] Fetched ${results.length}/${months} months for ${locPart}`);
  return results;
}

/**
 * Supabaseキャッシュに保存（バッチ）
 */
export async function cacheSearchKeywords(
  shopId: string,
  shopName: string,
  monthlyData: MonthlyKeywords[]
): Promise<void> {
  if (monthlyData.length === 0) return;
  const supabase = getSupabase();

  const rows = monthlyData.map((m) => ({
    shop_id: shopId,
    shop_name: shopName,
    month: m.month,
    keywords: m.keywords,
    source: "api",
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from("search_query_cache")
    .upsert(rows, { onConflict: "shop_id,month" });

  if (error) {
    console.error("[gbp-keywords] Cache write error:", error.message);
  }
}

/**
 * Supabaseキャッシュから検索語句を取得
 */
export async function getCachedSearchKeywords(
  shopId: string
): Promise<MonthlyKeywords[]> {
  
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("search_query_cache")
    .select("month, keywords")
    .eq("shop_id", shopId);

  if (error || !data) return [];

  return data
    .map((row: any) => ({ month: row.month as string, keywords: row.keywords || [] }))
    .sort((a, b) => compareMonths(a.month, b.month));
}

/**
 * 検索語句取得（統合）
 * 1. search_query_cache (Supabase) — 即時返却
 * 2. GBP Performance API — 取得+キャッシュ保存
 * 3. スプレッドシート — フォールバック
 */
export async function getSearchKeywords(
  shopId: string,
  shopName: string,
  locationFullPath: string | null
): Promise<{
  latest: { word: string; count: number }[];
  latestMonth: string;
  history: MonthlyKeywords[];
  source: "api" | "cache" | "spreadsheet";
}> {
  const empty = { latest: [], latestMonth: "", history: [], source: "spreadsheet" as const };

  // 1. Supabaseキャッシュ
  try {
    const cached = await getCachedSearchKeywords(shopId);
    if (cached.length > 0) {
      const latest = cached[cached.length - 1];
      console.log(`[gbp-keywords] Cache hit: ${shopName} → ${latest.month} (${cached.length} months)`);
      return {
        latest: latest.keywords.slice(0, 30),
        latestMonth: latest.month,
        history: cached,
        source: "cache",
      };
    }
  } catch (e) {
    console.error("[gbp-keywords] Cache read error:", e);
  }

  // 2. GBP Performance API
  if (locationFullPath) {
    try {
      console.log(`[gbp-keywords] API fetch start: ${shopName} (${locationFullPath})`);
      const apiData = await fetchSearchKeywordsFromGBP(locationFullPath);
      if (apiData.length > 0) {
        // キャッシュに保存（失敗しても続行）
        try { await cacheSearchKeywords(shopId, shopName, apiData); } catch {}
        const latest = apiData[apiData.length - 1];
        console.log(`[gbp-keywords] API success: ${shopName} → ${latest.month}`);
        return {
          latest: latest.keywords.slice(0, 30),
          latestMonth: latest.month,
          history: apiData,
          source: "api",
        };
      }
      console.log(`[gbp-keywords] API returned 0 months for ${shopName}`);
    } catch (err) {
      console.error(`[gbp-keywords] API error for ${shopName}:`, err);
    }
  } else {
    console.log(`[gbp-keywords] No locationFullPath for ${shopName}, skipping API`);
  }

  // 3. スプレッドシートフォールバック
  try {
    const { fetchSearchQueries } = await import("./search-query-fetch");
    const ssData = await fetchSearchQueries(shopName);
    if (ssData.latestKeywords.length > 0) {
      console.log(`[gbp-keywords] Spreadsheet fallback: ${shopName} → ${ssData.latestMonth}`);
      return {
        latest: ssData.latestKeywords,
        latestMonth: ssData.latestMonth,
        history: ssData.months,
        source: "spreadsheet",
      };
    }
  } catch {}

  console.log(`[gbp-keywords] No data found for ${shopName}`);
  return empty;
}

/**
 * 統一された同期関数: GBP API取得 → search_query_cache保存 → report_data_cache更新
 * 手動sync・cron・report actionsの3箇所から呼ばれる唯一の同期ロジック
 */
export async function syncShopSearchKeywords(
  shopId: string,
  shopName: string,
  gbpLocationName: string,
  months: number = 13
): Promise<{ success: boolean; latestMonth?: string; totalMonths?: number; topKeywords?: { word: string; count: number }[]; error?: string }> {
  // 1. GBP API取得
  const apiData = await fetchSearchKeywordsFromGBP(gbpLocationName, months);
  if (apiData.length === 0) {
    return { success: false, error: "API returned 0 months of data" };
  }

  // 2. search_query_cache に保存
  await cacheSearchKeywords(shopId, shopName, apiData);

  // 3. report_data_cache の searchQueries を更新
  // shop_id カラムがあればそちらを使い、なければ shop_name でフォールバック
  const supabase = getSupabase();
  const latest = apiData[apiData.length - 1];
  try {
    let reportCache: { id?: string; report_json?: any } | null = null;

    // まず shop_id で検索（テーブルにカラムがある場合）
    const { data: byId, error: idErr } = await supabase
      .from("report_data_cache")
      .select("id, report_json")
      .eq("shop_id", shopId)
      .maybeSingle();

    if (!idErr && byId) {
      reportCache = byId;
    } else {
      // shop_id カラムがない or ヒットしない場合、shop_name でフォールバック
      const { data: byName } = await supabase
        .from("report_data_cache")
        .select("id, report_json")
        .eq("shop_name", shopName)
        .limit(1)
        .maybeSingle();
      reportCache = byName;
    }

    if (reportCache?.report_json) {
      const reportJson = reportCache.report_json as any;
      reportJson.searchQueries = {
        latest: latest.keywords.slice(0, 30),
        latestMonth: latest.month,
        history: apiData,
      };
      await supabase
        .from("report_data_cache")
        .update({ report_json: reportJson, synced_at: new Date().toISOString() })
        .eq("id", reportCache.id);
    }
  } catch (e) {
    console.error(`[gbp-keywords] report_data_cache update error for ${shopName}:`, e);
  }

  return {
    success: true,
    latestMonth: latest.month,
    totalMonths: apiData.length,
    topKeywords: latest.keywords.slice(0, 5),
  };
}
