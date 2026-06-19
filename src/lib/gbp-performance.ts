/**
 * GBP Business Profile Performance API — パフォーマンスメトリクス取得
 *
 * fetchMultiDailyMetricsTimeSeries で日次データ取得 → 月別集計 → Supabaseキャッシュ
 * トークン: 検索語句と同じ RPAchubby の OAuthトークン（無料API）
 */

import { createClient } from "@supabase/supabase-js";
import { getExpectedMonthJST, compareMonths } from "./gbp-search-keywords";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const GBP_CLIENT_ID = process.env.GBP_CLIENT_ID || "";
const GBP_CLIENT_SECRET = process.env.GBP_CLIENT_SECRET || "";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
}

/** 月別パフォーマンスデータ */
export interface MonthlyPerformance {
  month: string; // "2026/5"
  searchMobile: number;
  searchPC: number;
  mapMobile: number;
  mapPC: number;
  calls: number;
  messages: number;
  bookings: number;
  routes: number;
  websites: number;
  foodOrders: number;
  foodMenus: number;
}

const METRICS = [
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
  "CALL_CLICKS",
  "BUSINESS_CONVERSATIONS",
  "BUSINESS_BOOKINGS",
  "BUSINESS_DIRECTION_REQUESTS",
  "WEBSITE_CLICKS",
  "BUSINESS_FOOD_ORDERS",
  "BUSINESS_FOOD_MENU_CLICKS",
] as const;

/** APIメトリック名 → MonthlyPerformanceのキーにマッピング */
const METRIC_MAP: Record<string, keyof MonthlyPerformance> = {
  BUSINESS_IMPRESSIONS_MOBILE_SEARCH: "searchMobile",
  BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: "searchPC",
  BUSINESS_IMPRESSIONS_MOBILE_MAPS: "mapMobile",
  BUSINESS_IMPRESSIONS_DESKTOP_MAPS: "mapPC",
  CALL_CLICKS: "calls",
  BUSINESS_CONVERSATIONS: "messages",
  BUSINESS_BOOKINGS: "bookings",
  BUSINESS_DIRECTION_REQUESTS: "routes",
  WEBSITE_CLICKS: "websites",
  BUSINESS_FOOD_ORDERS: "foodOrders",
  BUSINESS_FOOD_MENU_CLICKS: "foodMenus",
};

async function getPerformanceApiToken(): Promise<string | null> {
  if (!GBP_CLIENT_ID || !GBP_CLIENT_SECRET) {
    console.error("[gbp-perf] GBP_CLIENT_ID or GBP_CLIENT_SECRET not set");
    return null;
  }
  const supabase = getSupabase();
  const { data, error: dbErr } = await supabase.from("system_oauth_tokens").select("refresh_token").limit(1).maybeSingle();
  if (dbErr) {
    console.error("[gbp-perf] DB error fetching refresh_token:", dbErr.message);
    return null;
  }
  if (!data?.refresh_token) {
    console.error("[gbp-perf] No refresh_token in system_oauth_tokens");
    return null;
  }

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GBP_CLIENT_ID, client_secret: GBP_CLIENT_SECRET,
        refresh_token: data.refresh_token, grant_type: "refresh_token",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error(`[gbp-perf] Token refresh failed: ${res.status} ${errBody.slice(0, 500)}`);
      return null;
    }
    const tokenData = await res.json();
    if (!tokenData.access_token) {
      console.error("[gbp-perf] Token response has no access_token:", JSON.stringify(tokenData).slice(0, 300));
      return null;
    }
    return tokenData.access_token;
  } catch (e: any) {
    console.error("[gbp-perf] Token refresh exception:", e?.message);
    return null;
  }
}

function emptyMonth(month: string): MonthlyPerformance {
  return { month, searchMobile: 0, searchPC: 0, mapMobile: 0, mapPC: 0, calls: 0, messages: 0, bookings: 0, routes: 0, websites: 0, foodOrders: 0, foodMenus: 0 };
}

/**
 * GBP Performance API からパフォーマンスメトリクスを取得（過去13ヶ月）
 * fetchMultiDailyMetricsTimeSeries で日次データを取得し、月別に集計
 */
export async function fetchPerformanceFromGBP(
  locationPath: string,
  months: number = 13
): Promise<MonthlyPerformance[]> {
  const token = await getPerformanceApiToken();
  if (!token) {
    console.error("[gbp-perf] Failed to get OAuth token");
    return [];
  }

  const locPart = locationPath.includes("/")
    ? locationPath.split("/").slice(-2).join("/")
    : locationPath;

  // 日付範囲: 過去13ヶ月の1日〜先月末日
  const nowJST = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const endDate = new Date(nowJST.getUTCFullYear(), nowJST.getUTCMonth(), 0); // 先月末日
  const startDate = new Date(endDate.getFullYear(), endDate.getMonth() - months + 1, 1); // 13ヶ月前の1日

  const params = new URLSearchParams();
  for (const m of METRICS) {
    params.append("dailyMetrics", m);
  }
  params.set("dailyRange.startDate.year", String(startDate.getFullYear()));
  params.set("dailyRange.startDate.month", String(startDate.getMonth() + 1));
  params.set("dailyRange.startDate.day", "1");
  params.set("dailyRange.endDate.year", String(endDate.getFullYear()));
  params.set("dailyRange.endDate.month", String(endDate.getMonth() + 1));
  params.set("dailyRange.endDate.day", String(endDate.getDate()));

  const url = `https://businessprofileperformance.googleapis.com/v1/${locPart}:fetchMultiDailyMetricsTimeSeries?${params.toString()}`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`[gbp-perf] API ${res.status}: ${errText.slice(0, 500)}`);
      return [];
    }

    const data = await res.json();

    // 日次データを月別に集計
    const monthMap = new Map<string, MonthlyPerformance>();

    const series = data.multiDailyMetricTimeSeries || [];
    for (const multi of series) {
      for (const ts of multi.dailyMetricTimeSeries || []) {
        const metricName = ts.dailyMetric as string;
        const fieldKey = METRIC_MAP[metricName];
        if (!fieldKey) continue;

        for (const dv of ts.timeSeries?.datedValues || []) {
          const d = dv.date;
          if (!d) continue;
          const monthKey = `${d.year}/${d.month}`;
          if (!monthMap.has(monthKey)) {
            monthMap.set(monthKey, emptyMonth(monthKey));
          }
          const val = typeof dv.value === "string" ? parseInt(dv.value, 10) || 0 : dv.value || 0;
          (monthMap.get(monthKey)! as any)[fieldKey] += val;
        }
      }
    }

    const results = Array.from(monthMap.values()).sort((a, b) => compareMonths(a.month, b.month));
    console.log(`[gbp-perf] Fetched ${results.length} months for ${locPart}`);
    return results;
  } catch (e) {
    console.error(`[gbp-perf] Fetch error:`, e);
    return [];
  }
}

/** Supabaseキャッシュに保存 */
export async function cachePerformanceData(
  shopId: string,
  shopName: string,
  monthlyData: MonthlyPerformance[]
): Promise<void> {
  if (!SUPABASE_URL || monthlyData.length === 0) return;
  const supabase = getSupabase();

  const rows = monthlyData.map((m) => ({
    shop_id: shopId,
    shop_name: shopName,
    month: m.month,
    metrics: m,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from("performance_metrics_cache")
    .upsert(rows, { onConflict: "shop_id,month" });

  if (error) {
    console.error("[gbp-perf] Cache write error:", error.message);
  }
}

/** Supabaseキャッシュから読み込み（shop_id → shop_name フォールバック、重複店舗対応） */
export async function getCachedPerformance(shopId: string, shopName?: string): Promise<MonthlyPerformance[]> {
  if (!SUPABASE_URL) return [];
  const supabase = getSupabase();

  // まず shop_id で検索
  const { data, error } = await supabase
    .from("performance_metrics_cache")
    .select("month, metrics")
    .eq("shop_id", shopId);

  let rows = (!error && data && data.length > 0) ? data : null;

  // shop_id でヒットしない場合、shop_name でフォールバック（最新shop_idのデータのみ使用）
  if (!rows && shopName) {
    const { data: byName } = await supabase
      .from("performance_metrics_cache")
      .select("shop_id, month, metrics")
      .eq("shop_name", shopName)
      .order("updated_at", { ascending: false });
    if (byName && byName.length > 0) {
      // 最新のshop_idのデータだけをフィルタ（重複shop_id混在防止）
      const primaryShopId = byName[0].shop_id;
      rows = byName.filter((r: any) => r.shop_id === primaryShopId);
    }
  }

  if (!rows) return [];

  return rows
    .map((row: any) => ({ ...row.metrics, month: row.month } as MonthlyPerformance))
    .sort((a, b) => compareMonths(a.month, b.month));
}

/**
 * 統一された同期関数: GBP API取得 → キャッシュ保存
 */
export async function syncShopPerformance(
  shopId: string,
  shopName: string,
  gbpLocationName: string,
  months: number = 13
): Promise<{ success: boolean; totalMonths?: number; error?: string }> {
  const apiData = await fetchPerformanceFromGBP(gbpLocationName, months);
  if (apiData.length === 0) {
    return { success: false, error: "API returned 0 months of data" };
  }

  await cachePerformanceData(shopId, shopName, apiData);

  return { success: true, totalMonths: apiData.length };
}
