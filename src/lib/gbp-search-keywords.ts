/**
 * GBP Business Profile Performance API — 検索語句取得
 * https://developers.google.com/my-business/reference/performance/rest/v1/locations.searchkeywords.impressions.monthly/list
 *
 * API優先 → Supabaseキャッシュ → スプレッドシートフォールバック
 */

import { getOAuthToken } from "@/lib/gbp-token";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
}

interface SearchKeywordResult {
  keyword: string;
  impressions: number;
}

interface MonthlyKeywords {
  month: string; // "2026/4"
  keywords: { word: string; count: number }[];
}

/**
 * Performance APIから検索語句を取得（1ロケーション・1ヶ月分）
 */
async function fetchKeywordsFromAPI(
  locationFullPath: string,
  year: number,
  month: number,
  token: string
): Promise<SearchKeywordResult[]> {
  // locationFullPath = "accounts/XXX/locations/YYY"
  // API endpoint: locations/YYY を使う
  const locPart = locationFullPath.includes("/")
    ? locationFullPath.split("/").slice(-2).join("/")
    : locationFullPath;

  const url = `https://businessprofileperformance.googleapis.com/v1/${locPart}/searchkeywords/impressions/monthly?monthlyRange.startMonth.year=${year}&monthlyRange.startMonth.month=${month}&monthlyRange.endMonth.year=${year}&monthlyRange.endMonth.month=${month}&pageSize=300`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`[gbp-keywords] API error ${res.status} for ${locPart} ${year}/${month}:`, text.slice(0, 200));
    return [];
  }

  const data = await res.json();
  const results: SearchKeywordResult[] = [];

  for (const item of data.searchKeywordsCounts || []) {
    const keyword = item.searchKeyword || "";
    // insightsValue の中に月次データがある
    const monthlyValue = item.insightsValue?.threshold
      ? item.insightsValue.value || 0
      : item.insightsValue?.value || 0;

    if (keyword) {
      results.push({ keyword, impressions: monthlyValue });
    }
  }

  return results;
}

/**
 * 指定店舗の検索語句を複数月分API取得
 */
export async function fetchSearchKeywordsFromGBP(
  locationFullPath: string,
  months: number = 12
): Promise<MonthlyKeywords[]> {
  const token = await getOAuthToken();
  if (!token) {
    console.log("[gbp-keywords] OAuthトークン取得失敗");
    return [];
  }

  const results: MonthlyKeywords[] = [];
  const now = new Date();

  // 直近N月分を取得（当月は未確定なので前月から）
  for (let i = 1; i <= months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;

    try {
      const keywords = await fetchKeywordsFromAPI(locationFullPath, year, month, token);
      if (keywords.length > 0) {
        results.push({
          month: `${year}/${month}`,
          keywords: keywords
            .map((k) => ({ word: k.keyword, count: k.impressions }))
            .sort((a, b) => b.count - a.count),
        });
      }
    } catch (err) {
      console.error(`[gbp-keywords] Error fetching ${year}/${month}:`, err);
    }
  }

  // 古い順にソート
  results.sort((a, b) => a.month.localeCompare(b.month));
  return results;
}

/**
 * Supabaseキャッシュに保存
 */
export async function cacheSearchKeywords(
  shopId: string,
  shopName: string,
  monthlyData: MonthlyKeywords[]
): Promise<void> {
  if (!SUPABASE_URL) return;
  const supabase = getSupabase();

  for (const m of monthlyData) {
    await supabase
      .from("search_query_cache")
      .upsert(
        {
          shop_id: shopId,
          shop_name: shopName,
          month: m.month,
          keywords: m.keywords,
          source: "api",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "shop_id,month" }
      );
  }
}

/**
 * Supabaseキャッシュから検索語句を取得
 */
export async function getCachedSearchKeywords(
  shopId: string
): Promise<MonthlyKeywords[]> {
  if (!SUPABASE_URL) return [];
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("search_query_cache")
    .select("month, keywords")
    .eq("shop_id", shopId)
    .order("month", { ascending: true });

  if (error || !data) return [];

  return data.map((row: any) => ({
    month: row.month,
    keywords: row.keywords || [],
  }));
}

/**
 * 検索語句取得（統合）: APIキャッシュ → スプレッドシートフォールバック
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
  // 1. Supabaseキャッシュから取得
  const cached = await getCachedSearchKeywords(shopId);
  if (cached.length > 0) {
    const latest = cached[cached.length - 1];
    return {
      latest: latest.keywords.slice(0, 30),
      latestMonth: latest.month,
      history: cached,
      source: "cache",
    };
  }

  // 2. APIから取得（locationFullPathがある場合）
  if (locationFullPath) {
    try {
      const apiData = await fetchSearchKeywordsFromGBP(locationFullPath, 12);
      if (apiData.length > 0) {
        // キャッシュに保存
        await cacheSearchKeywords(shopId, shopName, apiData);
        const latest = apiData[apiData.length - 1];
        return {
          latest: latest.keywords.slice(0, 30),
          latestMonth: latest.month,
          history: apiData,
          source: "api",
        };
      }
    } catch (err) {
      console.error("[gbp-keywords] API fetch failed, falling back:", err);
    }
  }

  // 3. スプレッドシートフォールバック
  try {
    const { fetchSearchQueries } = await import("./search-query-fetch");
    const ssData = await fetchSearchQueries(shopName);
    return {
      latest: ssData.latestKeywords,
      latestMonth: ssData.latestMonth,
      history: ssData.months,
      source: "spreadsheet",
    };
  } catch {
    return { latest: [], latestMonth: "", history: [], source: "spreadsheet" };
  }
}
