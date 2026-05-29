// ── Report Types ──

export interface ShopInfo {
  name: string;
  address: string;
  period: { start: string; end: string };
  startDate: string;
  totalReviews: number;
  rating: number;
  lat: number;
  lng: number;
}

export interface KPI {
  label: string;
  value: number;
  prevValue: number;
  unit: string;
  compareLabel?: string;
  momValue?: number | null;  // 前月値
  yoyValue?: number | null;  // 前年同月値
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

export interface WordSource {
  word: string;
  reviews: { reviewer: string; comment: string; date: string; starRating: string }[];
}

/** @deprecated Use WordSource instead */
export type NegativeWordSource = WordSource;

export interface ReviewAnalysis {
  positiveWords: string[];
  negativeWords: string[];
  positiveWordSources?: WordSource[] | null;
  negativeWordSources?: WordSource[] | null;
  summary: string;
}

export interface RankingHistory {
  labels: string[];  // 月ラベル ["2025/10", "2025/11", ...]
  datasets: { word: string; ranks: (number | null)[] }[];
}

export interface SearchQueryEntry { word: string; count: number; }
export interface SearchQueryMonthData { month: string; keywords: SearchQueryEntry[]; }

export interface GridPoint {
  row: number;
  col: number;
  lat: number;
  lng: number;
  rank: number; // 0=未計測, -1=圏外
}

export interface GridRankingSnapshot {
  keyword: string;
  gridSize: number;
  intervalM: number;
  results: GridPoint[];
  measuredAt: string; // ISO string
  avgRank: number;
}

export interface GridRankingMonthData {
  month: string; // "2026/04"
  snapshots: GridRankingSnapshot[];
}

export interface GridRankingReport {
  keywords: string[];
  history: GridRankingMonthData[]; // 月別（古い順）
}

export interface ReportData {
  shop: ShopInfo;
  kpis: KPI[];
  monthlyLabels: string[];
  charts: ChartData;
  keywords: Keyword[];
  rankingHistory: RankingHistory;
  reviewLabels: string[];
  reviewCounts: number[];
  reviewDelta: (number | null)[];
  reviewAnalysis: ReviewAnalysis;
  comments: string[];
  searchQueries: { latest: SearchQueryEntry[]; latestMonth: string; history: SearchQueryMonthData[] };
  gridRanking?: GridRankingReport;
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
  /** "both" = 管理画面+シート両方, "sheet_only" = シートのみ */
  dataSource?: "both" | "sheet_only";
}
