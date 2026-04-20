/**
 * Google Spreadsheet CSV取得・パース・ReportData変換モジュール
 *
 * データソース:
 *   Sheet2: 全店舗の口コミ評価・件数推移
 *   Sheet3: 全店舗パフォーマンス（検索/マップ/アクション）
 */

import type {
  ReportData,
  ShopListItem,
  KPI,
  Keyword,
  ChartData,
  ReviewAnalysis,
} from "./report-data";

// ── スプレッドシート設定 ──

const SHEET2_ID = "1czdHEs0cc2ci01uTlTgezVsuOGCHOBH6oyEGJAY-Ofk";
const SHEET2_GID = "806898743";

const SHEET3_ID = "1ZyBiy_TYO_xqdyEItXmjS4k4ORagLjN3C5KWetSe1vY";
const SHEET3_GID = "17303928";

// ── CSV パーサー（引用符付きフィールド対応）──

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let i = 0;
  const len = text.length;

  while (i < len) {
    const row: string[] = [];
    while (i < len) {
      if (text[i] === '"') {
        // 引用符付きフィールド
        i++;
        let field = "";
        while (i < len) {
          if (text[i] === '"') {
            if (i + 1 < len && text[i + 1] === '"') {
              field += '"';
              i += 2;
            } else {
              i++;
              break;
            }
          } else {
            field += text[i];
            i++;
          }
        }
        row.push(field);
        if (i < len && text[i] === ",") i++;
      } else {
        // 通常フィールド
        let field = "";
        while (i < len && text[i] !== "," && text[i] !== "\n" && text[i] !== "\r") {
          field += text[i];
          i++;
        }
        row.push(field);
        if (i < len && text[i] === ",") {
          i++;
        } else {
          break;
        }
      }
    }
    // 改行スキップ
    while (i < len && (text[i] === "\n" || text[i] === "\r")) i++;
    if (row.length > 1 || (row.length === 1 && row[0] !== "")) {
      rows.push(row);
    }
  }
  return rows;
}

// ── CSV取得 ──

async function fetchCSV(sheetId: string, gid: string): Promise<string[][] | null> {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      redirect: "follow",
    });
    if (!res.ok) {
      console.error(`[spreadsheet] fetch failed: ${res.status} ${res.statusText}`);
      return null;
    }
    const text = await res.text();
    return parseCSV(text);
  } catch (err) {
    console.error("[spreadsheet] fetch error:", err);
    return null;
  }
}

// ── 日付パース ──

/** "2025年3月" → { year: 2025, month: 3 } */
function parseDateJP(s: string): { year: number; month: number } | null {
  const m = s.match(/(\d{4})年(\d{1,2})月/);
  if (!m) return null;
  return { year: parseInt(m[1]), month: parseInt(m[2]) };
}

/** { year: 2025, month: 3 } → "2025/3" */
function toLabel(d: { year: number; month: number }): string {
  return `${d.year}/${d.month}`;
}

/** 日付ソート用の数値キー */
function dateKey(d: { year: number; month: number }): number {
  return d.year * 100 + d.month;
}

// ── 数値パース（カンマ・空白対応）──

function num(s: string | undefined): number {
  if (!s) return 0;
  const cleaned = s.replace(/,/g, "").trim();
  const n = parseInt(cleaned, 10);
  return isNaN(n) ? 0 : n;
}

function numFloat(s: string | undefined): number {
  if (!s) return 0;
  const cleaned = s.replace(/,/g, "").trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

// ── Sheet3 パース（全店舗パフォーマンス）──

interface PerfRow {
  date: { year: number; month: number };
  shopName: string;
  address: string;
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
  hotelBookings: number;
}

function parseSheet3(rows: string[][]): Map<string, PerfRow[]> {
  const shopMap = new Map<string, PerfRow[]>();

  // ヘッダー行と最初のデータ行をログ出力（列マッピングのデバッグ用）
  if (rows.length > 0) {
    console.log("[Sheet3] Header:", rows[0].map((h, i) => `${i}:${h}`).join(" | "));
  }
  if (rows.length > 1) {
    console.log("[Sheet3] Row1:", rows[1].map((v, i) => `${i}:${v?.slice(0, 20)}`).join(" | "));
  }

  // Row 0 = header, skip
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length < 17) continue;

    const dateStr = r[1]?.trim();
    const shopName = r[2]?.trim();
    if (!dateStr || !shopName) continue;

    const d = parseDateJP(dateStr);
    if (!d) continue;

    const row: PerfRow = {
      date: d,
      shopName,
      address: r[3]?.replace(/^Japan,\s*/, "").replace(/^〒\d{3}-?\d{4}\s*/, "").trim() || "",
      searchMobile: num(r[5]),
      searchPC: num(r[6]),
      mapMobile: num(r[7]),
      mapPC: num(r[8]),
      calls: num(r[9]),
      messages: num(r[10]),
      bookings: num(r[11]),
      routes: num(r[12]),
      websites: num(r[13]),
      foodOrders: num(r[14]),
      foodMenus: num(r[15]),
      hotelBookings: num(r[16]),
    };

    if (!shopMap.has(shopName)) {
      shopMap.set(shopName, []);
    }
    shopMap.get(shopName)!.push(row);
  }

  // 各店舗を日付順にソート
  shopMap.forEach((rows) => {
    rows.sort((a, b) => dateKey(a.date) - dateKey(b.date));
  });

  return shopMap;
}

// ── Sheet2 パース（口コミデータ）──

interface ReviewRow {
  label: string;
  rating: number;
  count: number;
}

interface ShopReviewData {
  monthly: ReviewRow[];
  currentRating: number;
  currentCount: number;
  /** 先月対比の件数増減（スプレッドシートcol 7の値、正確な増減数） */
  summaryDelta?: number;
  /** 先月対比の評価（col 4） */
  summaryRating?: number;
  /** 先月対比の件数（col 5） */
  summaryCount?: number;
}

function parseSheet2(rows: string[][]): Map<string, ShopReviewData> {
  const shopMap = new Map<string, ShopReviewData>();

  if (rows.length < 3) return shopMap;

  // ヘッダー行と最初のデータ行をログ出力
  if (rows.length > 0) {
    console.log("[Sheet2] Header:", rows[0].map((h, i) => `${i}:${h}`).slice(0, 15).join(" | "));
  }
  if (rows.length > 2) {
    console.log("[Sheet2] Row2:", rows[2].map((v, i) => `${i}:${v?.slice(0, 20)}`).slice(0, 15).join(" | "));
  }

  // Row 0: ヘッダー（月名）— 実際の列位置を追跡
  const headerRow = rows[0];
  const monthEntries: { label: string; colIdx: number }[] = [];
  for (let c = 0; c < headerRow.length; c++) {
    const label = headerRow[c]?.trim();
    if (!label) continue;
    const d = parseDateJP(label);
    if (d) {
      monthEntries.push({ label: toLabel(d), colIdx: c });
    }
  }
  console.log(`[Sheet2] Found ${monthEntries.length} month columns, first at col ${monthEntries[0]?.colIdx}, last at col ${monthEntries[monthEntries.length - 1]?.colIdx}`);

  // Row 2以降: データ
  for (let i = 2; i < rows.length; i++) {
    const r = rows[i];
    const shopName = r[0]?.trim();
    if (!shopName) continue;

    const monthly: ReviewRow[] = [];
    let lastRating = 0;
    let lastCount = 0;

    for (let j = 0; j < monthEntries.length; j++) {
      const colIdx = monthEntries[j].colIdx;
      const rating = numFloat(r[colIdx]);
      const count = num(r[colIdx + 1]);

      // データがある月のみ追加
      if (rating > 0 || count > 0) {
        monthly.push({
          label: monthEntries[j].label,
          rating,
          count,
        });
        lastRating = rating;
        lastCount = count;
      }
    }

    if (monthly.length > 0) {
      // 先月対比列（col 2-7）から正確な増減数・評価・件数を取得
      const summaryRating = numFloat(r[4]); // col 4: 今月評価
      const summaryCount = num(r[5]);       // col 5: 今月件数
      const deltaStr = (r[7] || "").trim(); // col 7: 件数増減 "+23(119.2%)"
      const deltaMatch = deltaStr.match(/([+-]?\d+)/);
      const summaryDelta = deltaMatch ? parseInt(deltaMatch[1]) : undefined;

      const finalCount = summaryCount > 0 ? summaryCount : lastCount;
      if (shopName.includes("よし乃")) {
        console.log(`[Sheet2 DEBUG] ${shopName}: summaryCount=${summaryCount}, lastCount=${lastCount}, finalCount=${finalCount}, summaryRating=${summaryRating}, lastRating=${lastRating}, deltaStr="${deltaStr}", monthly.length=${monthly.length}, lastMonthly=${monthly[monthly.length-1]?.label}:${monthly[monthly.length-1]?.count}`);
      }
      shopMap.set(shopName, {
        monthly,
        currentRating: summaryRating > 0 ? summaryRating : lastRating,
        currentCount: finalCount,
        summaryDelta: summaryDelta !== undefined ? summaryDelta : undefined,
        summaryRating: summaryRating > 0 ? summaryRating : undefined,
        summaryCount: summaryCount > 0 ? summaryCount : undefined,
      });
    }
  }

  return shopMap;
}

// ── ReportData 構築 ──

function pctText(cur: number, prev: number): string {
  if (prev === 0 && cur === 0) return "±0.0%";
  if (prev === 0) return "+∞";
  const pct = ((cur - prev) / prev) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

function generateComments(
  kpis: KPI[],
  reviewDelta: (number | null)[],
  currentRating: number,
  totalReviews: number,
  currentLabel: string
): string[] {
  const comments: string[] = [];

  // 検索数
  const search = kpis[0];
  const searchPct = pctText(search.value, search.prevValue);
  comments.push(
    `Google検索数は${search.value.toLocaleString()}回（前月比${searchPct}）。${
      search.value >= search.prevValue
        ? "検索経由の認知が拡大しています。"
        : "季節的な変動の可能性もあるため、来月のデータで推移を確認します。"
    }`
  );

  // マップ表示
  const map = kpis[1];
  const mapPct = pctText(map.value, map.prevValue);
  comments.push(
    `Googleマップ表示数は${map.value.toLocaleString()}回（前月比${mapPct}）。${
      map.value >= map.prevValue
        ? "マップ経由の集客力が強化されています。"
        : "マップ上での視認性向上のため、GBP情報の最適化を継続します。"
    }`
  );

  // 口コミ
  const deltaValues = reviewDelta.filter((d): d is number => d !== null);
  const latestReviewDelta = deltaValues.length > 0 ? deltaValues[deltaValues.length - 1] : 0;
  comments.push(
    `口コミ件数は${totalReviews.toLocaleString()}件、評価${currentRating}を維持。${currentLabel}は+${latestReviewDelta}件の増加。`
  );

  // アクション
  const actions = kpis[7];
  const actionPct = pctText(actions.value, actions.prevValue);
  comments.push(
    `ユーザーアクション合計${actions.value.toLocaleString()}件（前月比${actionPct}）。${
      actions.value >= actions.prevValue
        ? "ユーザーの反応が改善傾向にあります。"
        : "投稿頻度の向上やメニュー情報の充実で改善を図ります。"
    }`
  );

  // 来月の方針
  comments.push(
    "来月はGBP投稿の強化と口コミ獲得施策を継続し、各指標の改善を目指します。"
  );

  return comments;
}

function generateReviewAnalysis(
  currentRating: number,
  totalReviews: number,
  reviewDelta: (number | null)[]
): ReviewAnalysis {
  const avgDelta =
    reviewDelta.filter((d): d is number => d !== null).reduce((a, b) => a + b, 0) /
    Math.max(reviewDelta.filter((d) => d !== null).length, 1);

  const ratingDesc = currentRating >= 4.5 ? "非常に高い" : currentRating >= 4.0 ? "高い" : currentRating >= 3.5 ? "標準的な" : "改善が必要な";

  return {
    positiveWords: [],
    negativeWords: [],
    summary: `口コミ評価は${currentRating}と${ratingDesc}水準を維持しています。総口コミ数は${totalReviews.toLocaleString()}件で、月平均約${Math.round(avgDelta)}件のペースで推移しています。今後も口コミ返信対応の質を維持し、顧客満足度の向上に取り組みます。`,
  };
}

// ── ランキングデータ取得（Supabase → レポートP7用）──

async function fetchRankingKeywords(shopName: string): Promise<Keyword[]> {
  // 1. まずスプレッドシートからKW順位を取得（B列日付で最新月マッチ）
  try {
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000";
    const res = await fetch(`${baseUrl}/api/report/ranking-keywords?shopName=${encodeURIComponent(shopName)}`, {
      headers: { "Content-Type": "application/json", "x-internal-call": "1" },
      next: { revalidate: 1800 },
    });
    if (res.ok) {
      const data = await res.json();
      if (data.ranks && data.ranks.length > 0) {
        return data.ranks.map((r: any) => ({
          word: r.word,
          rank: r.rank || 0,
          prevRank: r.prevRank || r.rank || 0,
        }));
      }
    }
  } catch {}

  // 2. フォールバック: Supabase ranking_search_logsから取得
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];

  try {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    const { data: shop } = await supabase
      .from("shops").select("id")
      .or(`name.eq.${shopName},gbp_shop_name.eq.${shopName}`)
      .limit(1).maybeSingle();
    if (!shop) return [];

    const { data: logs } = await supabase
      .from("ranking_search_logs")
      .select("search_words, rank, searched_at, point_label")
      .eq("shop_id", shop.id).eq("is_display", true)
      .order("searched_at", { ascending: false }).limit(200);
    if (!logs || logs.length === 0) return [];

    const groups = new Map<string, { rank: number; prevRank: number }>();
    for (const log of logs) {
      let kw: string;
      try {
        const parsed = JSON.parse(log.search_words);
        kw = Array.isArray(parsed) ? parsed.join(", ") : String(log.search_words);
      } catch { kw = String(log.search_words); }

      if (!groups.has(kw)) {
        groups.set(kw, { rank: log.rank || 0, prevRank: 0 });
      } else {
        const existing = groups.get(kw)!;
        if (existing.prevRank === 0) existing.prevRank = log.rank || 0;
      }
    }

    return Array.from(groups.entries())
      .filter(([, data]) => data.rank > 0)
      .map(([word, data]) => ({ word, rank: data.rank, prevRank: data.prevRank || data.rank }));
  } catch (err) {
    console.error("[spreadsheet] fetchRankingKeywords error:", err);
    return [];
  }
}

export async function buildReportData(
  shopName: string,
  perfRows: PerfRow[],
  reviewData: ShopReviewData | undefined
): Promise<ReportData> {
  // 直近12ヶ月に絞り込み
  const recent = perfRows.slice(-12);

  const monthlyLabels = recent.map((r) => toLabel(r.date));

  const charts: ChartData = {
    searchMobile: recent.map((r) => r.searchMobile),
    searchPC: recent.map((r) => r.searchPC),
    mapMobile: recent.map((r) => r.mapMobile),
    mapPC: recent.map((r) => r.mapPC),
    calls: recent.map((r) => r.calls),
    routes: recent.map((r) => r.routes),
    websites: recent.map((r) => r.websites),
    bookings: recent.map((r) => r.bookings),
    foodMenus: recent.map((r) => r.foodMenus),
  };

  const cur = recent[recent.length - 1];
  const prev = recent.length >= 2 ? recent[recent.length - 2] : null;

  const curActions = cur.calls + cur.routes + cur.websites + cur.bookings + cur.foodMenus;
  const curDate = cur.date;

  // 口コミデータ（Sheet2）
  let reviewLabels: string[] = [];
  let reviewCounts: number[] = [];
  let reviewDelta: (number | null)[] = [];
  let currentRating = 0;
  let totalReviews = 0;

  if (reviewData && reviewData.monthly.length > 0) {
    const recentReviews = reviewData.monthly.slice(-14);
    reviewLabels = recentReviews.map((r) => r.label);
    reviewCounts = recentReviews.map((r) => r.count);
    reviewDelta = reviewCounts.map((c, i) => (i === 0 ? null : c - reviewCounts[i - 1]));
    currentRating = reviewData.currentRating;
    totalReviews = reviewData.currentCount;
    if (shopName.includes("よし乃")) {
      console.log(`[buildReport DEBUG] ${shopName}: currentCount=${reviewData.currentCount}, currentRating=${reviewData.currentRating}, summaryCount=${reviewData.summaryCount}, lastReviewCount=${reviewCounts[reviewCounts.length-1]}`);
    }
  }

  // 口コミ増減（KPI 8番目用）
  // 先月対比列（summaryDelta）を優先使用（月別データは契約後件数のみの店舗があるため）
  let reviewDeltaForKpi = 0;
  let prevReviewCount = 0;
  if (reviewData) {
    if (reviewData.summaryDelta !== undefined) {
      // 先月対比列の件数増減（スプレッドシートで正確に管理されている値）
      reviewDeltaForKpi = reviewData.summaryDelta;
      prevReviewCount = totalReviews - reviewDeltaForKpi;
    } else if (reviewData.monthly.length >= 2) {
      // フォールバック: 月別データから計算
      const rm = reviewData.monthly;
      prevReviewCount = rm[rm.length - 2].count;
      reviewDeltaForKpi = totalReviews - prevReviewCount;
    }
  }

  const kpis: KPI[] = [
    { label: "Google検索 合計", value: cur.searchMobile + cur.searchPC, prevValue: prev ? prev.searchMobile + prev.searchPC : 0, unit: "回" },
    { label: "Googleマップ 合計", value: cur.mapMobile + cur.mapPC, prevValue: prev ? prev.mapMobile + prev.mapPC : 0, unit: "回" },
    { label: "ウェブサイトクリック", value: cur.websites, prevValue: prev?.websites ?? 0, unit: "件" },
    { label: "ルート検索", value: cur.routes, prevValue: prev?.routes ?? 0, unit: "件" },
    { label: "通話", value: cur.calls, prevValue: prev?.calls ?? 0, unit: "件" },
    { label: "フードメニュークリック", value: cur.foodMenus, prevValue: prev?.foodMenus ?? 0, unit: "件" },
    { label: "予約", value: cur.bookings, prevValue: prev?.bookings ?? 0, unit: "件" },
    { label: `口コミ増減【${toLabel(curDate)}】`, value: reviewDeltaForKpi, prevValue: prevReviewCount, unit: "件" },
  ];

  // 対象期間
  const lastDay = new Date(curDate.year, curDate.month, 0).getDate();
  const period = {
    start: `${curDate.year}/${String(curDate.month).padStart(2, "0")}/01`,
    end: `${curDate.year}/${String(curDate.month).padStart(2, "0")}/${lastDay}`,
  };

  // 対策開始月（最古のデータ）
  const firstDate = perfRows[0].date;
  const startDate = `${firstDate.year}年${firstDate.month}月`;

  const currentLabel = toLabel(curDate);

  // DB → テンプレートフォールバックで口コミ分析取得
  const { getReviewAnalysis } = await import("./review-analyzer");
  const search = kpis[0];
  const map = kpis[1];
  const totalActionsVal = kpis.slice(2, 7).reduce((s, k) => s + k.value, 0);
  const prevTotalActionsVal = kpis.slice(2, 7).reduce((s, k) => s + k.prevValue, 0);
  const filteredDeltas = reviewDelta.filter((d): d is number => d !== null);
  const lastDelta = filteredDeltas.length > 0 ? filteredDeltas[filteredDeltas.length - 1] : 0;

  const analyzed = await getReviewAnalysis(
    shopName, currentLabel, currentRating, totalReviews, lastDelta,
    {
      searchPct: pctText(search.value, search.prevValue),
      mapPct: pctText(map.value, map.prevValue),
      actionPct: pctText(totalActionsVal, prevTotalActionsVal),
    }
  );

  const reviewAnalysis = analyzed.analysis;
  const comments = analyzed.comments;

  // DBの評価・口コミ数があればSpreadsheetデータを上書き
  if (analyzed.source === "db" && analyzed.rating && analyzed.rating > 0) {
    currentRating = analyzed.rating;
  }
  if (analyzed.source === "db" && analyzed.reviewCount && analyzed.reviewCount > 0) {
    totalReviews = analyzed.reviewCount;
  }

  return {
    shop: {
      name: shopName,
      address: cur.address || perfRows.find((r) => r.address)?.address || "",
      period,
      startDate,
      totalReviews,
      rating: currentRating,
    },
    kpis,
    monthlyLabels,
    charts,
    keywords: await fetchRankingKeywords(shopName),
    reviewLabels,
    reviewCounts,
    reviewDelta,
    reviewAnalysis,
    comments,
  };
}

// ── 公開API ──

async function loadData(): Promise<{
  perf: Map<string, PerfRow[]>;
  reviews: Map<string, ShopReviewData>;
} | null> {
  const [sheet3Rows, sheet2Rows] = await Promise.all([
    fetchCSV(SHEET3_ID, SHEET3_GID),
    fetchCSV(SHEET2_ID, SHEET2_GID),
  ]);

  if (!sheet3Rows) return null;

  const perf = parseSheet3(sheet3Rows);
  const reviews = sheet2Rows ? parseSheet2(sheet2Rows) : new Map<string, ShopReviewData>();

  return { perf, reviews };
}

/**
 * キャッシュクリア（反映ボタン用）— revalidateTagで制御
 */
export function clearSpreadsheetCache() {
  // インメモリキャッシュ廃止: Next.js fetchキャッシュ(revalidateTag)で管理
}

/**
 * 全店舗リストを取得
 */
export async function getShopsFromSpreadsheet(): Promise<ShopListItem[] | null> {
  const data = await loadData();
  if (!data) return null;

  const shops: ShopListItem[] = [];

  data.perf.forEach((rows, shopName) => {
    if (rows.length === 0) return;

    const latest = rows[rows.length - 1];
    const reviewInfo = data.reviews.get(shopName);

    const addr = latest.address || rows.find((r) => r.address)?.address || "";

    // エリア自動判定
    const areaMatch = addr.match(/(東京都|大阪府|北海道|京都府|愛知県|福岡県|神奈川県|埼玉県|千葉県|兵庫県|沖縄県|新潟県|広島県|宮城県|静岡県|岡山県|熊本県|鹿児島県|長野県|三重県|石川県|滋賀県|奈良県|和歌山県|岐阜県|群馬県|栃木県|茨城県|山梨県|長崎県|佐賀県|大分県|山口県|愛媛県|香川県|高知県|徳島県|福井県|富山県|岩手県|青森県|秋田県|山形県|福島県|鳥取県|島根県|宮崎県)/);
    const area = areaMatch ? areaMatch[1] : "その他";

    // 前月の口コミデータ（先月対比列を優先）
    let prevRating = 0;
    let prevTotalReviews = 0;
    if (reviewInfo) {
      if (reviewInfo.summaryDelta !== undefined && reviewInfo.summaryCount) {
        // 先月対比列から正確な前月件数を逆算
        prevTotalReviews = reviewInfo.summaryCount - reviewInfo.summaryDelta;
        prevRating = reviewInfo.monthly.length >= 2 ? reviewInfo.monthly[reviewInfo.monthly.length - 2].rating : 0;
      } else if (reviewInfo.monthly.length >= 2) {
        const prev = reviewInfo.monthly[reviewInfo.monthly.length - 2];
        prevRating = prev.rating;
        prevTotalReviews = prev.count;
      }
    }

    // パフォーマンス前月比
    const prev = rows.length >= 2 ? rows[rows.length - 2] : null;
    const searchTotal = latest.searchMobile + latest.searchPC;
    const prevSearchTotal = prev ? prev.searchMobile + prev.searchPC : 0;
    const mapTotal = latest.mapMobile + latest.mapPC;
    const prevMapTotal = prev ? prev.mapMobile + prev.mapPC : 0;
    const actionTotal = latest.calls + latest.routes + latest.websites + latest.bookings + latest.foodMenus;
    const prevActionTotal = prev ? prev.calls + prev.routes + prev.websites + prev.bookings + prev.foodMenus : 0;

    shops.push({
      id: shopName,
      name: shopName,
      address: addr,
      period: `${latest.date.year}年${latest.date.month}月`,
      rating: reviewInfo?.currentRating ?? 0,
      totalReviews: reviewInfo?.currentCount ?? 0,
      area,
      prevRating,
      prevTotalReviews,
      searchTotal,
      prevSearchTotal,
      mapTotal,
      prevMapTotal,
      actionTotal,
      prevActionTotal,
    });
  });

  // 店舗名でソート
  shops.sort((a, b) => a.name.localeCompare(b.name, "ja"));

  return shops;
}

/**
 * 特定店舗のレポートデータを取得
 */
export async function getReportFromSpreadsheet(
  shopName: string
): Promise<ReportData | null> {
  const data = await loadData();
  if (!data) return null;

  const perfRows = data.perf.get(shopName);
  if (!perfRows || perfRows.length === 0) return null;

  const reviewData = data.reviews.get(shopName);

  return await buildReportData(shopName, perfRows, reviewData);
}
