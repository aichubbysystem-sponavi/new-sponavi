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
  category?: string;
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

/** ページ別AI総評。各ページ末尾に表示され、担当者が個別に編集できる */
export interface PageComments {
  monthly: string;        // P2 月次推移データ
  map: string;            // Googleマップ表示数推移
  search: string;         // Google検索数推移
  reactions: string;      // ユーザー反応数推移
  keyword: string;        // キーワード順位変動
  rankingHistory: string; // キーワード順位推移テーブル
  grid: string;           // 多地点順位（サマリー）
  searchQuery: string;    // 検索語句ランキング
  reviewCount: string;    // 口コミ件数推移
  reviewDelta: string;    // 月間口コミ増加数
  language: string;       // 口コミ言語別分析
  competitor: string;     // 口コミ競合比較（同エリア）
  reviews: string[];      // AIによる口コミ分析（箇条書き）
  actions: string[];      // 総括ページ（改善策）
}

/** 口コミ競合比較の1行（評価・口コミ数） */
export interface CompetitorEntry {
  name: string;
  rating: number;
  reviewCount: number;
}

/** 口コミ競合比較（同エリア）。月次でDB保存されたスナップショット */
export interface CompetitorComparison {
  month: string;    // "2026/7"（レポートの紐付けキー）
  keyword: string;  // 検索に使ったKW
  self: (CompetitorEntry & { rank: number }) | null; // リスト内の自店（上位20圏外はnull）
  competitors: CompetitorEntry[]; // 上位20（自店含む・検索結果順）
  fetchedAt?: string | null; // 取得日時ISO（過去に遡れないため取得時点のスナップショット）
}

export interface RankingHistory {
  labels: string[];  // 月ラベル ["2025/10", "2025/11", ...]
  // outOfRange: そのセルが明示的に「圏外」だったか（空欄=未計測 と区別するため。2026-07-31追加）
  datasets: { word: string; ranks: (number | null)[]; outOfRange?: boolean[] }[];
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
  /** 計測地点の間隔(m)。推定・手動データ（overrides）は間隔不明のため null（表示側は半径を出さない） */
  intervalM: number | null;
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
  pageComments?: PageComments | null;
  // AI総評の分析実行時点（ISO）。表は表示時に再計算されるため総評との数値ズレの説明に使う
  analysisDate?: string | null;
  competitorComparison?: CompetitorComparison | null;
  searchQueries: { latest: SearchQueryEntry[]; latestMonth: string; history: SearchQueryMonthData[] };
  gridRanking?: GridRankingReport;
  analysisTargetMonth?: string | null;
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
  /** GBPメインカテゴリ（例：ラーメン屋、美容院） */
  category?: string;
  /** GBPアカウント表示名（例：JAPAN SELECT, Spotlight Navigator） */
  gbpAccountLabel?: string;
}
