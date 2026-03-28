// ===== Mock Data for Chubby MEO Platform Demo =====

export const currentStore = {
  name: "焼肉ダイニング 炎 渋谷店",
  address: "東京都渋谷区道玄坂1-2-3",
  phone: "03-1234-5678",
  category: "焼肉店",
  rating: 4.2,
  reviewCount: 287,
  meoScore: 78,
};

export const kpiData = {
  searchViews: { value: 12450, change: 8.3, label: "検索表示回数" },
  profileViews: { value: 3820, change: 12.1, label: "プロフィール閲覧" },
  phoneClicks: { value: 245, change: -2.4, label: "電話タップ" },
  routeClicks: { value: 389, change: 15.7, label: "経路検索" },
  webClicks: { value: 567, change: 5.2, label: "Webサイトクリック" },
  reviewsThisMonth: { value: 18, change: 28.6, label: "今月の口コミ数" },
};

export const monthlyInsights = [
  { month: "10月", 検索表示: 9200, プロフィール: 2800, 経路検索: 280, 電話: 180 },
  { month: "11月", 検索表示: 10100, プロフィール: 3100, 経路検索: 310, 電話: 195 },
  { month: "12月", 検索表示: 11800, プロフィール: 3500, 経路検索: 360, 電話: 230 },
  { month: "1月", 検索表示: 10500, プロフィール: 3200, 経路検索: 320, 電話: 210 },
  { month: "2月", 検索表示: 11200, プロフィール: 3600, 経路検索: 350, 電話: 225 },
  { month: "3月", 検索表示: 12450, プロフィール: 3820, 経路検索: 389, 電話: 245 },
];

export const reviewRatingDistribution = [
  { rating: "★5", count: 142, percentage: 49.5 },
  { rating: "★4", count: 78, percentage: 27.2 },
  { rating: "★3", count: 38, percentage: 13.2 },
  { rating: "★2", count: 18, percentage: 6.3 },
  { rating: "★1", count: 11, percentage: 3.8 },
];

export const reviewTrend = [
  { month: "10月", 件数: 12, 平均評価: 4.1 },
  { month: "11月", 件数: 15, 平均評価: 4.0 },
  { month: "12月", 件数: 22, 平均評価: 4.3 },
  { month: "1月", 件数: 14, 平均評価: 4.1 },
  { month: "2月", 件数: 16, 平均評価: 4.2 },
  { month: "3月", 件数: 18, 平均評価: 4.4 },
];

export const reviews = [
  {
    id: 1,
    author: "田中太郎",
    rating: 5,
    date: "2026-03-15",
    text: "初めて訪問しましたが、お肉の質が素晴らしかったです。特にカルビとハラミが絶品でした。スタッフの方も笑顔で対応してくれて、とても気持ちの良い時間を過ごせました。",
    replied: false,
    language: "ja",
    sentiment: "positive",
    topics: ["料理", "接客"],
    aiReplies: [
      "田中様、この度はご来店いただき誠にありがとうございます！カルビとハラミをお気に召していただけて大変嬉しく思います。スタッフ一同、心温まるお言葉に励まされております。渋谷でのお食事に、またぜひ当店の焼肉をお楽しみください。スタッフ一同お待ちしております。",
      "田中様、嬉しいお言葉をいただきありがとうございます！お肉の品質には特にこだわっておりますので、ご満足いただけて光栄です。次回はぜひタン塩もお試しください。またのご来店を心よりお待ちしております。",
      "田中太郎様、素敵なレビューをありがとうございます。お肉もサービスもご満足いただけたとのこと、大変嬉しく思います。季節限定メニューもご用意しておりますので、ぜひまたお越しくださいませ。",
    ],
  },
  {
    id: 2,
    author: "Sarah M.",
    rating: 4,
    date: "2026-03-12",
    text: "Great yakiniku experience! The meat quality was excellent and the sauce selection was impressive. Only minor issue was the wait time during peak hours.",
    replied: false,
    language: "en",
    sentiment: "positive",
    topics: ["料理", "待ち時間"],
    aiReplies: [
      "Thank you so much for visiting our restaurant, Sarah! We're delighted to hear you enjoyed our meat quality and sauce selection. We sincerely apologize for the wait during peak hours — we're working on improving our seating efficiency. We hope to welcome you back soon!",
      "Dear Sarah, thank you for your wonderful review! We appreciate your feedback about the wait time and are actively implementing a reservation system to reduce it. We look forward to serving you again!",
      "Sarah, thank you for your kind words! We're glad you enjoyed the yakiniku experience. Your feedback about peak hour wait times is valuable — we're taking steps to improve. Please visit us again!",
    ],
  },
  {
    id: 3,
    author: "佐藤花子",
    rating: 2,
    date: "2026-03-10",
    text: "お肉は美味しかったのですが、店内が少し暗くてメニューが見づらかったです。また、注文してから料理が出てくるまでに30分以上かかりました。",
    replied: true,
    language: "ja",
    sentiment: "negative",
    topics: ["内装", "待ち時間"],
    aiReplies: [],
  },
  {
    id: 4,
    author: "김민수",
    rating: 5,
    date: "2026-03-08",
    text: "시부야에서 최고의 야키니쿠 맛집! 고기 품질이 정말 좋고 직원들도 친절해요. 한국어 메뉴도 있어서 편했습니다.",
    replied: false,
    language: "ko",
    sentiment: "positive",
    topics: ["料理", "接客", "多言語"],
    aiReplies: [
      "김민수님, 방문해 주셔서 감사합니다! 저희 고기 품질과 서비스에 만족해 주셔서 기쁩니다. 한국어 메뉴도 계속 업데이트하고 있으니 다음에도 꼭 방문해 주세요!",
      "감사합니다, 김민수님! 시부야 최고의 야키니쿠라는 말씀에 큰 힘이 됩니다. 다음 방문 시에도 최고의 서비스로 모시겠습니다. 또 뵙겠습니다!",
    ],
  },
];

export const scheduledPosts = [
  {
    id: 1,
    date: "2026-03-20",
    time: "12:00",
    type: "通常投稿",
    title: "春の限定メニュー登場！",
    content: "桜をイメージした特別コースをご用意しました。春の訪れを感じながら、厳選された和牛をお楽しみください。期間限定のため、お早めにご予約ください。",
    status: "scheduled",
    platform: "GBP",
  },
  {
    id: 2,
    date: "2026-03-22",
    time: "18:00",
    type: "特典投稿",
    title: "【平日限定】ドリンク1杯サービス",
    content: "平日ディナー限定！ご来店いただいたお客様にドリンク1杯をサービスいたします。ぜひこの機会にお越しください。",
    status: "scheduled",
    platform: "GBP",
  },
  {
    id: 3,
    date: "2026-03-25",
    time: "11:00",
    type: "イベント投稿",
    title: "お花見焼肉パーティープラン",
    content: "お花見シーズンに合わせた特別パーティープランをご用意！10名様以上で幹事様無料。テラス席で桜を眺めながらの焼肉をお楽しみください。",
    status: "draft",
    platform: "GBP + Instagram",
  },
  {
    id: 4,
    date: "2026-03-18",
    time: "19:00",
    type: "通常投稿",
    title: "本日のおすすめ：A5黒毛和牛",
    content: "本日入荷したばかりのA5ランク黒毛和牛。きめ細やかなサシが美しい極上の一品です。数量限定のため、お早めにどうぞ。",
    status: "published",
    platform: "GBP",
  },
];

export const competitors = [
  { name: "炭火焼肉 牛角 渋谷店", rating: 3.8, reviews: 523, score: 72 },
  { name: "叙々苑 渋谷店", rating: 4.1, reviews: 412, score: 81 },
  { name: "焼肉ライク 渋谷店", rating: 3.9, reviews: 345, score: 68 },
  { name: "自店舗", rating: 4.2, reviews: 287, score: 78, isSelf: true },
];

export const rankingData = [
  { keyword: "渋谷 焼肉", rank: 3, change: 1, volume: 12100 },
  { keyword: "渋谷 焼肉 おすすめ", rank: 5, change: -2, volume: 4400 },
  { keyword: "道玄坂 焼肉", rank: 1, change: 0, volume: 1900 },
  { keyword: "渋谷 焼肉 デート", rank: 7, change: 3, volume: 2900 },
  { keyword: "渋谷 和牛", rank: 4, change: 2, volume: 3200 },
  { keyword: "渋谷 焼肉 ランチ", rank: 8, change: -1, volume: 5500 },
];

export const sentimentAnalysis = {
  positive: { percentage: 76, topics: ["料理の質", "接客", "雰囲気", "コスパ"] },
  neutral: { percentage: 13, topics: ["立地", "メニュー数"] },
  negative: { percentage: 11, topics: ["待ち時間", "照明", "予約しづらい"] },
};

export const wordCloud = [
  { word: "美味しい", count: 89 },
  { word: "お肉", count: 76 },
  { word: "接客", count: 54 },
  { word: "雰囲気", count: 48 },
  { word: "カルビ", count: 42 },
  { word: "おすすめ", count: 38 },
  { word: "コスパ", count: 35 },
  { word: "デート", count: 31 },
  { word: "ハラミ", count: 29 },
  { word: "タン塩", count: 27 },
  { word: "待ち時間", count: 22 },
  { word: "予約", count: 20 },
];

export const diagnosisItems = [
  { item: "店舗名の最適化", score: 90, status: "good", detail: "主要キーワードが含まれています" },
  { item: "カテゴリ設定", score: 85, status: "good", detail: "メイン+サブカテゴリ3つ設定済み" },
  { item: "営業時間", score: 100, status: "good", detail: "正確に設定されています" },
  { item: "写真の充実度", score: 60, status: "warning", detail: "競合平均より15枚少ないです" },
  { item: "口コミ返信率", score: 45, status: "danger", detail: "未返信が32件あります" },
  { item: "投稿頻度", score: 70, status: "warning", detail: "週2回以上が推奨です（現在: 週1回）" },
  { item: "Q&A充実度", score: 30, status: "danger", detail: "Q&Aが3件のみ。10件以上推奨" },
  { item: "メニュー情報", score: 80, status: "good", detail: "メニュー52品登録済み" },
  { item: "NAP一貫性", score: 55, status: "warning", detail: "食べログの電話番号が不一致" },
  { item: "説明文", score: 75, status: "good", detail: "750文字中500文字使用。KW含有率OK" },
  { item: "属性設定", score: 40, status: "danger", detail: "設定可能な属性の40%が未設定" },
  { item: "外国語対応", score: 20, status: "danger", detail: "外国語ページ未作成" },
];

export const postCalendar = [
  { date: "2026-03-18", type: "通常", title: "本日のおすすめ" },
  { date: "2026-03-20", type: "通常", title: "春の限定メニュー" },
  { date: "2026-03-22", type: "特典", title: "平日限定ドリンク" },
  { date: "2026-03-25", type: "イベント", title: "お花見プラン" },
  { date: "2026-03-27", type: "通常", title: "シェフのこだわり" },
  { date: "2026-03-29", type: "写真", title: "店内リニューアル" },
];

export const aioData = {
  aiOverviewAppearances: 8,
  aiCitations: 23,
  topQueries: [
    { query: "渋谷で美味しい焼肉屋は？", appearances: 5, source: "Google AI" },
    { query: "渋谷のデートにおすすめの焼肉", appearances: 3, source: "Google AI" },
    { query: "渋谷 焼肉 個室", appearances: 2, source: "ChatGPT" },
    { query: "shibuya yakiniku recommended", appearances: 2, source: "Gemini" },
  ],
  qAndA: [
    { question: "個室はありますか？", answer: "はい、最大8名様までご利用いただける個室を3室ご用意しております。" },
    { question: "ランチ営業はしていますか？", answer: "はい、平日11:30〜14:00でランチ営業しております。ランチコースは1,500円〜ご用意しています。" },
    { question: "駐車場はありますか？", answer: "専用駐車場はございませんが、近隣にコインパーキングが複数ございます。" },
  ],
};
