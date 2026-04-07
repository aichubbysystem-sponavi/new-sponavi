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
}

// ── Mock Data ──

const homerunData: ReportData = {
  shop: {
    name: '西口酒場ホームラン',
    address: '東京都新宿区西新宿7-9-14 巨匠ビル B1F',
    period: { start: '2026/02/01', end: '2026/02/28' },
    startDate: '2023年3月',
    totalReviews: 1872,
    rating: 4.6,
  },
  kpis: [
    { label: 'Google検索数', value: 7310, prevValue: 10573, unit: '回' },
    { label: 'Googleマップ表示', value: 180792, prevValue: 161990, unit: '回' },
    { label: '通話クリック', value: 200, prevValue: 221, unit: '件' },
    { label: 'ルート検索', value: 556, prevValue: 688, unit: '件' },
    { label: 'ウェブサイト', value: 434, prevValue: 561, unit: '件' },
    { label: '予約数', value: 0, prevValue: 0, unit: '件' },
    { label: 'フードメニュー', value: 113, prevValue: 116, unit: '件' },
    { label: '合計アクション', value: 1303, prevValue: 1586, unit: '件' },
  ],
  monthlyLabels: ['2025/3','2025/4','2025/5','2025/6','2025/7','2025/8','2025/9','2025/10','2025/11','2025/12','2026/1','2026/2'],
  charts: {
    searchMobile: [34404,27303,20474,11413,11547,11266,10490,10303,9178,7625,6825,5712],
    searchPC: [5200,4307,3530,2102,2012,2020,1938,1818,1556,1305,1224,1598],
    mapMobile: [13453,13471,13624,13752,13988,26571,81764,152689,163440,176299,176750,178071],
    mapPC: [1630,1396,1370,1498,1381,2530,8282,11555,2576,2627,2590,2721],
    calls: [257,210,298,204,222,252,261,239,260,234,221,200],
    routes: [720,675,784,618,679,706,726,678,727,663,688,556],
    websites: [461,393,532,386,442,450,502,468,508,454,561,434],
    bookings: [0,0,0,0,0,0,0,0,0,0,0,0],
    foodMenus: [81,67,107,64,99,88,103,86,134,118,116,113],
  },
  keywords: [
    { word: '新宿 居酒屋', rank: 8, prevRank: 12 },
    { word: '西新宿 飲み放題', rank: 3, prevRank: 5 },
    { word: '新宿西口 居酒屋', rank: 6, prevRank: 8 },
    { word: '新宿 宴会', rank: 15, prevRank: 18 },
    { word: '西新宿 居酒屋 安い', rank: 2, prevRank: 4 },
    { word: '新宿 飲み放題 個室', rank: 11, prevRank: 14 },
  ],
  reviewLabels: ['2025/1','2025/2','2025/3','2025/4','2025/5','2025/6','2025/7','2025/8','2025/9','2025/10','2025/11','2025/12','2026/1','2026/2'],
  reviewCounts: [1658,1670,1693,1710,1726,1741,1758,1778,1798,1818,1840,1854,1863,1872],
  reviewDelta: [null,12,16,17,16,15,17,20,20,20,22,14,9,9],
  reviewAnalysis: {
    positiveWords: ['料理が美味しい','コスパ最高','雰囲気が良い','スタッフが親切','飲み放題が充実','駅近で便利'],
    negativeWords: ['待ち時間が長い','席が狭い','騒がしい'],
    summary: '全体的に高評価を維持しており、特に料理の品質とコストパフォーマンスが高く評価されています。一方で、混雑時の待ち時間や席の広さに関する改善要望が見られます。口コミ件数は順調に増加しており、月平均約16件のペースで推移しています。',
  },
  comments: [
    'Google検索数は前月比-30.9%と減少していますが、Googleマップ表示数は前月比+11.6%と大幅に増加しており、マップ経由の集客力が強化されています。',
    '口コミ件数は1,872件に到達し、評価4.6を維持。新規口コミ獲得ペースの向上が今後の課題です。',
    'キーワード「西新宿 居酒屋 安い」で2位を獲得。コスパ訴求の投稿強化が順位向上に貢献しています。',
    'ユーザー反応数（通話・ルート・Webサイト）は全体的に減少傾向。季節要因の可能性もあるため、3月のデータで改善を確認します。',
    '来月はGBP投稿頻度を週2回に増やし、春メニューの訴求で反応数の改善を目指します。',
  ],
};

const teppachiData: ReportData = {
  shop: {
    name: 'てっぱち札幌大通店',
    address: '北海道札幌市中央区南3条西3丁目',
    period: { start: '2026/02/01', end: '2026/02/28' },
    startDate: '2024年1月',
    totalReviews: 1580,
    rating: 4.7,
  },
  kpis: [
    { label: 'Google検索数', value: 12450, prevValue: 11800, unit: '回' },
    { label: 'Googleマップ表示', value: 385200, prevValue: 362100, unit: '回' },
    { label: '通話クリック', value: 315, prevValue: 298, unit: '件' },
    { label: 'ルート検索', value: 892, prevValue: 845, unit: '件' },
    { label: 'ウェブサイト', value: 623, prevValue: 580, unit: '件' },
    { label: '予約数', value: 287, prevValue: 263, unit: '件' },
    { label: 'フードメニュー', value: 198, prevValue: 175, unit: '件' },
    { label: '合計アクション', value: 2315, prevValue: 2161, unit: '件' },
  ],
  monthlyLabels: ['2025/3','2025/4','2025/5','2025/6','2025/7','2025/8','2025/9','2025/10','2025/11','2025/12','2026/1','2026/2'],
  charts: {
    searchMobile: [8200,8900,9500,10100,10800,11200,11500,11900,12100,11400,10800,10650],
    searchPC: [1500,1600,1700,1800,1900,2000,2100,2200,2300,2100,1900,1800],
    mapMobile: [280000,295000,305000,315000,328000,340000,350000,360000,370000,355000,348000,380200],
    mapPC: [3500,3800,4000,4200,4500,4800,5000,5200,5400,5100,4800,5000],
    calls: [220,235,260,275,290,310,320,330,315,298,285,315],
    routes: [650,700,730,760,800,840,860,880,870,845,820,892],
    websites: [380,410,440,470,510,540,560,580,590,580,560,623],
    bookings: [163,175,190,205,220,240,255,270,285,263,250,287],
    foodMenus: [95,105,120,135,150,165,175,185,180,175,168,198],
  },
  keywords: [],
  reviewLabels: ['2025/1','2025/2','2025/3','2025/4','2025/5','2025/6','2025/7','2025/8','2025/9','2025/10','2025/11','2025/12','2026/1','2026/2'],
  reviewCounts: [1320,1340,1360,1382,1405,1428,1450,1472,1495,1518,1540,1554,1567,1580],
  reviewDelta: [null,20,20,22,23,23,22,22,23,23,22,14,13,13],
  reviewAnalysis: {
    positiveWords: ['ラーメンが絶品','ボリューム満点','接客が丁寧','清潔感がある','味噌ラーメンが最高','トッピングが豊富'],
    negativeWords: ['行列が長い','駐車場がない'],
    summary: '味噌ラーメンを中心に非常に高い評価を獲得しています。ボリュームと味の評価が特に高く、リピーターが多い傾向です。行列の長さに関するコメントは人気の裏返しでもあります。口コミ件数は月平均約20件の安定したペースで増加中です。',
  },
  comments: [
    'Google検索数・マップ表示ともに前月比増加しており、安定した成長を維持しています。特にマップ表示は38.5万回と過去最高を更新しました。',
    '予約数が前月比+9.1%と好調。GBPの予約ボタン活用が効果を発揮しています。',
    '口コミ件数1,580件、評価4.7と非常に高水準。今後も返信対応の質を維持していきます。',
    '全アクション数が2,315件と前月比+7.1%。特にウェブサイトクリックとフードメニュー閲覧の伸びが顕著です。',
    '3月は卒業・歓送迎会シーズンに向けた投稿を強化し、宴会需要の取り込みを図ります。',
  ],
};

export const mockShopList: ShopListItem[] = [
  {
    id: 'homerun',
    name: '西口酒場ホームラン',
    address: '東京都新宿区西新宿7-9-14 巨匠ビル B1F',
    period: '2026年2月',
    rating: 4.6,
    totalReviews: 1872,
  },
  {
    id: 'teppachi',
    name: 'てっぱち札幌大通店',
    address: '北海道札幌市中央区南3条西3丁目',
    period: '2026年2月',
    rating: 4.7,
    totalReviews: 1580,
  },
];

export const mockReportData: Record<string, ReportData> = {
  homerun: homerunData,
  teppachi: teppachiData,
};
