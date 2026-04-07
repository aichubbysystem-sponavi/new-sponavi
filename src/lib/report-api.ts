/**
 * レポートデータ取得モジュール
 * Go API からパフォーマンスデータを取得し、ReportData 形式に変換
 * API未接続時はモックデータにフォールバック
 */

import type { ReportData, ShopListItem, KPI, ChartData, Keyword } from "./report-data";
import { mockReportData, mockShopList } from "./report-data";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5555";

// ── Go API レスポンス型 ──

interface APIShop {
  id: string;
  name: string;
  owner_id: string;
  postal_code: string;
  state: string;
  city: string;
  address: string;
  building: string;
  phone: string;
  full_address?: string;
  created_at: string;
  updated_at: string;
}

interface APIPerformanceLog {
  id: string;
  shop_id: string;
  from: string;
  to: string;
  mobile_search_impressions: number | null;
  pc_search_impressions: number | null;
  mobile_map_impressions: number | null;
  pc_map_impressions: number | null;
  website_clicks: number | null;
  direction_requests: number | null;
  call_clicks: number | null;
  bookings: number | null;
  food_menu_clicks: number | null;
  search_keywords: Record<string, number>[] | null;
  average_reviews: number | null;
  total_reviews: number | null;
  created_at: string;
  updated_at: string;
}

// ── ヘルパー ──

function val(n: number | null | undefined): number {
  return n ?? 0;
}

function formatMonth(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}/${d.getMonth() + 1}`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

// ── 変換: PerformanceLog[] → ReportData ──

function transformToReportData(
  shop: APIShop,
  logs: APIPerformanceLog[]
): ReportData {
  // 日付昇順にソート
  const sorted = [...logs].sort(
    (a, b) => new Date(a.from).getTime() - new Date(b.from).getTime()
  );

  if (sorted.length === 0) {
    throw new Error("No performance data");
  }

  const current = sorted[sorted.length - 1];
  const prev = sorted.length >= 2 ? sorted[sorted.length - 2] : null;

  // 月ラベル
  const monthlyLabels = sorted.map((log) => formatMonth(log.from));

  // チャートデータ
  const charts: ChartData = {
    searchMobile: sorted.map((l) => val(l.mobile_search_impressions)),
    searchPC: sorted.map((l) => val(l.pc_search_impressions)),
    mapMobile: sorted.map((l) => val(l.mobile_map_impressions)),
    mapPC: sorted.map((l) => val(l.pc_map_impressions)),
    calls: sorted.map((l) => val(l.call_clicks)),
    routes: sorted.map((l) => val(l.direction_requests)),
    websites: sorted.map((l) => val(l.website_clicks)),
    bookings: sorted.map((l) => val(l.bookings)),
    foodMenus: sorted.map((l) => val(l.food_menu_clicks)),
  };

  // 当月合計アクション
  const currentActions =
    val(current.call_clicks) +
    val(current.direction_requests) +
    val(current.website_clicks) +
    val(current.bookings) +
    val(current.food_menu_clicks);
  const prevActions = prev
    ? val(prev.call_clicks) +
      val(prev.direction_requests) +
      val(prev.website_clicks) +
      val(prev.bookings) +
      val(prev.food_menu_clicks)
    : 0;

  // KPI
  const kpis: KPI[] = [
    { label: "Google検索数", value: val(current.mobile_search_impressions) + val(current.pc_search_impressions), prevValue: prev ? val(prev.mobile_search_impressions) + val(prev.pc_search_impressions) : 0, unit: "回" },
    { label: "Googleマップ表示", value: val(current.mobile_map_impressions) + val(current.pc_map_impressions), prevValue: prev ? val(prev.mobile_map_impressions) + val(prev.pc_map_impressions) : 0, unit: "回" },
    { label: "通話クリック", value: val(current.call_clicks), prevValue: prev ? val(prev.call_clicks) : 0, unit: "件" },
    { label: "ルート検索", value: val(current.direction_requests), prevValue: prev ? val(prev.direction_requests) : 0, unit: "件" },
    { label: "ウェブサイト", value: val(current.website_clicks), prevValue: prev ? val(prev.website_clicks) : 0, unit: "件" },
    { label: "予約数", value: val(current.bookings), prevValue: prev ? val(prev.bookings) : 0, unit: "件" },
    { label: "フードメニュー", value: val(current.food_menu_clicks), prevValue: prev ? val(prev.food_menu_clicks) : 0, unit: "件" },
    { label: "合計アクション", value: currentActions, prevValue: prevActions, unit: "件" },
  ];

  // キーワード（search_keywords JSON）
  const keywords: Keyword[] = [];
  // TODO: search_keywords の形式に合わせてパース（ランキングデータは別APIから取得が必要）

  // 口コミ推移
  const reviewCounts = sorted.map((l) => val(l.total_reviews));
  const reviewDelta: (number | null)[] = reviewCounts.map((c, i) =>
    i === 0 ? null : c - reviewCounts[i - 1]
  );

  // 住所構築
  const fullAddress =
    shop.full_address ||
    `${shop.state}${shop.city}${shop.address}${shop.building || ""}`.trim();

  return {
    shop: {
      name: shop.name,
      address: fullAddress,
      period: {
        start: formatDate(current.from),
        end: formatDate(current.to),
      },
      startDate: formatMonth(sorted[0].from),
      totalReviews: val(current.total_reviews),
      rating: current.average_reviews ?? 0,
    },
    kpis,
    monthlyLabels,
    charts,
    keywords,
    reviewLabels: monthlyLabels,
    reviewCounts,
    reviewDelta,
    reviewAnalysis: {
      positiveWords: [],
      negativeWords: [],
      summary: "口コミ分析データは準備中です。",
    },
    comments: [
      "本レポートはGoogleビジネスプロフィールのパフォーマンスデータに基づいて自動生成されています。",
    ],
  };
}

// ── API呼び出し ──

async function fetchAPI<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      next: { revalidate: 3600 }, // 1時間キャッシュ
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ── 公開API ──

/**
 * 店舗一覧を取得（API → モックフォールバック）
 */
export async function getShopList(): Promise<{
  shops: ShopListItem[];
  source: "api" | "mock";
}> {
  const apiShops = await fetchAPI<APIShop[]>("/api/shop");

  if (apiShops && apiShops.length > 0) {
    // 各店舗の最新パフォーマンスを取得してリスト構築
    const shops: ShopListItem[] = await Promise.all(
      apiShops.map(async (shop) => {
        const logs = await fetchAPI<APIPerformanceLog[]>(
          `/api/performance/${shop.id}`
        );
        const latest = logs && logs.length > 0 ? logs[logs.length - 1] : null;
        const fullAddress =
          shop.full_address ||
          `${shop.state}${shop.city}${shop.address}${shop.building || ""}`.trim();

        return {
          id: shop.id,
          name: shop.name,
          address: fullAddress,
          period: latest ? formatMonth(latest.from) : "-",
          rating: latest?.average_reviews ?? 0,
          totalReviews: latest?.total_reviews ?? 0,
        };
      })
    );

    return { shops, source: "api" };
  }

  return { shops: mockShopList, source: "mock" };
}

/**
 * 特定店舗のレポートデータを取得（API → モックフォールバック）
 */
export async function getReportData(shopId: string): Promise<{
  data: ReportData | null;
  source: "api" | "mock";
}> {
  // まず API から取得を試みる
  const [shop, logs] = await Promise.all([
    fetchAPI<APIShop>(`/api/shop/${shopId}`),
    fetchAPI<APIPerformanceLog[]>(`/api/performance/${shopId}`),
  ]);

  if (shop && logs && logs.length > 0) {
    try {
      const data = transformToReportData(shop, logs);
      return { data, source: "api" };
    } catch {
      // 変換失敗 → モックにフォールバック
    }
  }

  // モックデータから検索
  const mockData = mockReportData[shopId] ?? null;
  return { data: mockData, source: "mock" };
}
