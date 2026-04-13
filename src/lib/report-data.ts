// ── Report Types ──

export interface ShopInfo {
  name: string;
  address: string;
  period: { start: string; end: string };
  startDate: string;
  totalReviews: number;
  rating: number;
}

export interface KPI {
  label: string;
  value: number;
  prevValue: number;
  unit: string;
}

export interface ChartData {
  searchMobile: number[];
  searchPC: number[];
  mapMobile: number[];
  mapPC: number[];
  calls: number[];
  routes: number[];
  websites: number[];
  bookings: number[];
  foodMenus: number[];
}

export interface Keyword {
  word: string;
  rank: number;
  prevRank: number;
}

export interface ReviewAnalysis {
  positiveWords: string[];
  negativeWords: string[];
  summary: string;
}

export interface ReportData {
  shop: ShopInfo;
  kpis: KPI[];
  monthlyLabels: string[];
  charts: ChartData;
  keywords: Keyword[];
  reviewLabels: string[];
  reviewCounts: number[];
  reviewDelta: (number | null)[];
  reviewAnalysis: ReviewAnalysis;
  comments: string[];
}

export interface ShopListItem {
  id: string;
  name: string;
  address: string;
  period: string;
  rating: number;
  totalReviews: number;
  area?: string;
  prevRating?: number;
  prevTotalReviews?: number;
  analyzed?: boolean;
  // 前月比パフォーマンスデータ
  searchTotal?: number;
  prevSearchTotal?: number;
  mapTotal?: number;
  prevMapTotal?: number;
  actionTotal?: number;
  prevActionTotal?: number;
}
