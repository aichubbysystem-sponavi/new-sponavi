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
import { createClient } from "@supabase/supabase-js";

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
      next: { revalidate: 0 },
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
    `Google検索数は${search.value.toLocaleString()}回（${search.compareLabel || "前月比"}${searchPct}）。${
      search.value >= search.prevValue
        ? "検索経由の認知が拡大しています。"
        : "季節的な変動の可能性もあるため、来月のデータで推移を確認します。"
    }`
  );

  // マップ表示
  const map = kpis[1];
  const mapPct = pctText(map.value, map.prevValue);
  comments.push(
    `Googleマップ表示数は${map.value.toLocaleString()}回（${map.compareLabel || "前月比"}${mapPct}）。${
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
    `ユーザーアクション合計${actions.value.toLocaleString()}件（${kpis[0].compareLabel || "前月比"}${actionPct}）。${
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

/**
 * 順位・順位履歴・検索語句を並列取得（パフォーマンス最適化）
 * shopId/locationFullPath指定時はGBP Performance APIから検索語句を優先取得
 */
async function fetchGridRankingData(
  shopId: string
): Promise<import("./report-data").GridRankingReport> {
  const empty: import("./report-data").GridRankingReport = { keywords: [], history: [] };
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "",
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
    );
    console.log(`[grid-ranking] fetching for shopId=${shopId}`);
    const { data: logs, error } = await sb
      .from("grid_ranking_logs")
      .select("keyword, grid_size, interval_m, results, measured_at")
      .eq("shop_id", shopId)
      .order("measured_at", { ascending: true });
    console.log(`[grid-ranking] logs=${logs?.length ?? 0}, error=${error?.message ?? "none"}`);
    if (!logs || logs.length === 0) return empty;

    const keywordSet = new Set<string>();
    const monthMap = new Map<string, import("./report-data").GridRankingSnapshot[]>();

    for (const log of logs) {
      keywordSet.add(log.keyword);
      const d = new Date(log.measured_at);
      const monthKey = `${d.getFullYear()}/${d.getMonth() + 1}`;
      const results: import("./report-data").GridPoint[] = log.results || [];
      const ranked = results.filter(r => r.rank > 0);
      const avg = ranked.length > 0 ? ranked.reduce((s, r) => s + r.rank, 0) / ranked.length : 0;
      const snapshot: import("./report-data").GridRankingSnapshot = {
        keyword: log.keyword,
        gridSize: log.grid_size,
        intervalM: log.interval_m,
        results,
        measuredAt: log.measured_at,
        avgRank: Math.round(avg * 10) / 10,
      };
      if (!monthMap.has(monthKey)) monthMap.set(monthKey, []);
      monthMap.get(monthKey)!.push(snapshot);
    }

    // 同月・同キーワードで複数回計測がある場合、最新のものだけ残す
    const history: import("./report-data").GridRankingMonthData[] = [];
    for (const entry of Array.from(monthMap.entries())) {
      const [month, snapshots] = entry;
      const byKw = new Map<string, import("./report-data").GridRankingSnapshot>();
      for (const s of snapshots) {
        const existing = byKw.get(s.keyword);
        if (!existing || new Date(s.measuredAt) > new Date(existing.measuredAt)) {
          byKw.set(s.keyword, s);
        }
      }
      history.push({ month, snapshots: Array.from(byKw.values()) });
    }

    return { keywords: Array.from(keywordSet), history };
  } catch (e) {
    console.error("[spreadsheet] grid ranking fetch error:", e);
    return empty;
  }
}

async function fetchAllExternalData(
  shopName: string,
  opts?: { shopId?: string; locationFullPath?: string }
): Promise<{
  keywords: Keyword[];
  rankingHistory: import("./report-data").RankingHistory;
  searchQueries: import("./report-data").ReportData["searchQueries"];
  gridRanking?: import("./report-data").GridRankingReport;
}> {
  const [rankingResult, searchResult, gridResult] = await Promise.all([
    // 順位 + 履歴を1モジュールで同時取得
    (async () => {
      try {
        const { fetchRankingFromSheets, fetchRankingHistoryFromSheets } = await import("./ranking-fetch");
        const [ranks, history] = await Promise.all([
          fetchRankingFromSheets(shopName),
          fetchRankingHistoryFromSheets(shopName),
        ]);
        return {
          keywords: ranks.map(r => ({ word: r.word, rank: r.rank, prevRank: r.prevRank })),
          history,
        };
      } catch (e) {
        console.error("[spreadsheet] ranking error:", e);
        return { keywords: [] as Keyword[], history: { labels: [], datasets: [] } };
      }
    })(),
    // 検索語句: API優先 → スプレッドシートフォールバック
    (async () => {
      try {
        if (opts?.shopId) {
          const { getSearchKeywords } = await import("./gbp-search-keywords");
          const data = await getSearchKeywords(opts.shopId, shopName, opts.locationFullPath || null);
          return { latest: data.latest, latestMonth: data.latestMonth, history: data.history };
        }
        // shopId未指定時はスプレッドシートから取得
        const { fetchSearchQueries } = await import("./search-query-fetch");
        const data = await fetchSearchQueries(shopName);
        return { latest: data.latestKeywords, latestMonth: data.latestMonth, history: data.months };
      } catch {
        return { latest: [] as { word: string; count: number }[], latestMonth: "", history: [] as any[] };
      }
    })(),
    // グリッド順位計測（overrides優先 → 実測データフォールバック）
    (async () => {
      try {
        // 1. overrides（手動編集/自動生成データ）を優先取得
        const { createClient } = await import("@supabase/supabase-js");
        const sb = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL || "",
          process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
        );
        const { data: overrides } = await sb
          .from("grid_ranking_overrides")
          .select("keyword, grid_size, results, updated_at")
          .eq("shop_name", shopName);
        if (overrides && overrides.length > 0) {
          const keywords = Array.from(new Set(overrides.map(o => o.keyword)));
          const history: import("./report-data").GridRankingMonthData[] = [];
          // overridesは月区分なしなので最新月として扱う
          const now = new Date();
          const monthKey = `${now.getFullYear()}/${now.getMonth() + 1}`;
          const snapshots = overrides.map(o => ({
            keyword: o.keyword,
            gridSize: o.grid_size || 7,
            intervalM: 1000,
            results: o.results || [],
            measuredAt: o.updated_at,
            avgRank: (() => {
              const ranked = (o.results || []).filter((r: any) => r.rank > 0);
              return ranked.length > 0 ? Math.round(ranked.reduce((s: number, r: any) => s + r.rank, 0) / ranked.length * 10) / 10 : 0;
            })(),
          }));
          history.push({ month: monthKey, snapshots });
          return { keywords, history };
        }
        // 2. 実測データにフォールバック
        if (!opts?.shopId) return undefined;
        return await fetchGridRankingData(opts.shopId);
      } catch {
        if (!opts?.shopId) return undefined;
        try { return await fetchGridRankingData(opts.shopId); } catch { return undefined; }
      }
    })(),
  ]);

  return {
    keywords: rankingResult.keywords,
    rankingHistory: rankingResult.history,
    searchQueries: searchResult,
    gridRanking: gridResult && gridResult.keywords.length > 0 ? gridResult : undefined,
  };
}

export async function buildReportData(
  shopName: string,
  perfRows: PerfRow[],
  reviewData: ShopReviewData | undefined,
  opts?: { shopId?: string; locationFullPath?: string }
): Promise<ReportData> {
  // 直近13ヶ月に絞り込み（前年比表示のため13ヶ月必要）
  const recent = perfRows.slice(-13);

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
  // 前年同月（KPIサマリーの%比較用）
  const yoy = recent.length >= 13 ? recent[recent.length - 13] : null;
  const hasYoyData = yoy !== null;

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
  }

  // 口コミ増減（KPI 8番目用）— 前月比 + 前年同月比
  let reviewMomDelta = 0;
  let reviewMomPrev = 0;
  let reviewYoyDelta: number | null = null;
  let reviewYoyPrev: number | null = null;
  if (reviewData && reviewData.monthly.length >= 2) {
    const rm = reviewData.monthly;
    // 前月比
    reviewMomPrev = rm[rm.length - 2].count;
    reviewMomDelta = totalReviews - reviewMomPrev;
    // 前年同月比
    if (rm.length >= 13) {
      reviewYoyPrev = rm[rm.length - 13].count;
      reviewYoyDelta = totalReviews - reviewYoyPrev;
    }
  }

  const kpis: KPI[] = [
    { label: "Google検索 合計", value: cur.searchMobile + cur.searchPC, prevValue: prev ? prev.searchMobile + prev.searchPC : 0, unit: "回", momValue: prev ? prev.searchMobile + prev.searchPC : null, yoyValue: yoy ? yoy.searchMobile + yoy.searchPC : null },
    { label: "Googleマップ 合計", value: cur.mapMobile + cur.mapPC, prevValue: prev ? prev.mapMobile + prev.mapPC : 0, unit: "回", momValue: prev ? prev.mapMobile + prev.mapPC : null, yoyValue: yoy ? yoy.mapMobile + yoy.mapPC : null },
    { label: "ウェブサイトクリック", value: cur.websites, prevValue: prev?.websites ?? 0, unit: "件", momValue: prev?.websites ?? null, yoyValue: yoy?.websites ?? null },
    { label: "ルート検索", value: cur.routes, prevValue: prev?.routes ?? 0, unit: "件", momValue: prev?.routes ?? null, yoyValue: yoy?.routes ?? null },
    { label: "通話", value: cur.calls, prevValue: prev?.calls ?? 0, unit: "件", momValue: prev?.calls ?? null, yoyValue: yoy?.calls ?? null },
    { label: "フードメニュークリック", value: cur.foodMenus, prevValue: prev?.foodMenus ?? 0, unit: "件", momValue: prev?.foodMenus ?? null, yoyValue: yoy?.foodMenus ?? null },
    { label: "予約", value: cur.bookings, prevValue: prev?.bookings ?? 0, unit: "件", momValue: prev?.bookings ?? null, yoyValue: yoy?.bookings ?? null },
    { label: `口コミ増減【${toLabel(curDate)}】`, value: reviewMomDelta, prevValue: reviewMomPrev, unit: "件", compareLabel: "前月比", momValue: reviewMomPrev, yoyValue: reviewYoyPrev },
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

  // DBの評価はスプレッドシートに値がない場合のみフォールバック
  if (analyzed.source === "db" && analyzed.rating && analyzed.rating > 0 && currentRating === 0) {
    currentRating = analyzed.rating;
  }
  // 口コミ数はスプレッドシートを常に優先（DBは古い値の場合がある）

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
    ...await fetchAllExternalData(shopName, opts),
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

  // 契約中の店舗のみに絞り込み（顧客管理スプレッドシート連携）
  let contractedShops: Map<string, { service: string }> | null = null;
  try {
    const { fetchCustomerSheet } = await import("./customer-sheet");
    const custMap = await fetchCustomerSheet();
    if (custMap.size > 0) contractedShops = new Map(Array.from(custMap.entries()).map(([k, v]) => [k, { service: v.service }]));
  } catch {}

  const shops: ShopListItem[] = [];

  data.perf.forEach((rows, shopName) => {
    if (rows.length === 0) return;

    // 顧客シートがある場合、契約中の店舗のみ表示
    if (contractedShops) {
      const key = shopName.replace(/\s+/g, " ").trim().toLowerCase();
      let found = contractedShops.has(key);
      if (!found) {
        for (const k of Array.from(contractedShops.keys())) {
          if (k.length >= 3 && key.length >= 3 && (key.includes(k) || k.includes(key))) { found = true; break; }
        }
      }
      if (!found) return; // 契約外の店舗はスキップ
    }

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

  // 既存店舗名のセット
  const existingNames = new Set(shops.map(s => s.name));

  // キーワードシートのタブからシートのみの店舗を追加
  try {
    const { fetchTabGidMap } = await import("./ranking-fetch");

    // ── Sheet1: タブ名 = 店舗名（A1取得不要）──
    const SHEET1_ID = "1JpehMxL2I-fgef1sckNaY8RIUDIknvmT2OqhHj0my1k";
    const SHEET1_SKIP = [
      /^RPA/, /住所/, /◯△/, /〇△/, /一覧/, /インサイト/, /ここから/, /これより/,
      /テスト計測/, /毎月レポート/, /←/, /→/, /新規店舗は追加/,
    ];
    try {
      const tabMap = await fetchTabGidMap(SHEET1_ID);
      for (const tabName of Array.from(tabMap.keys())) {
        if (!tabName || SHEET1_SKIP.some(p => p.test(tabName))) continue;
        if (existingNames.has(tabName)) continue;
        const reviewInfo = data.reviews.get(tabName);
        shops.push({
          id: tabName, name: tabName, address: "", period: "",
          rating: reviewInfo?.currentRating ?? 0,
          totalReviews: reviewInfo?.currentCount ?? 0,
          dataSource: "sheet_only",
        });
        existingNames.add(tabName);
      }
    } catch {}

    // ── Sheet2: タブ名は略称 → A1セルからフルネーム取得（Supabaseキャッシュ併用）──
    const SHEET2_KW_ID = "10hvP7iSEyst0Bp_96eVsjicM4_qxVfG0BmMkDgFyg-Q";
    const SHEET2_SKIP = [
      /インサイト/, /全店舗/, /まとめ/, /ひな型/, /一覧/, /地方/,
      /◯△/, /P-MAX/, /順位変動/, /ここより/, /kw\s/, /レディース\s/, /メンズ\s/,
      /口コミ/, /シート/,
    ];
    try {
      const tabMap = await fetchTabGidMap(SHEET2_KW_ID);
      const shopTabs: { gid: string; tabName: string }[] = [];
      for (const [tabName, gid] of Array.from(tabMap.entries())) {
        if (!tabName || SHEET2_SKIP.some(p => p.test(tabName))) continue;
        shopTabs.push({ gid, tabName });
      }

      // Supabaseからキャッシュ済みマッピングを取得
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || "",
        process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
      );
      const { data: cachedMappings } = await supabase
        .from("sheet_tab_mapping")
        .select("tab_gid, shop_name")
        .eq("sheet_id", SHEET2_KW_ID);
      const cachedMap = new Map<string, string>();
      for (const m of cachedMappings || []) {
        cachedMap.set(m.tab_gid, m.shop_name);
      }

      // キャッシュにないタブのみA1を取得
      const uncachedTabs = shopTabs.filter(t => !cachedMap.has(t.gid));
      const newMappings: { tab_gid: string; shop_name: string }[] = [];

      for (let i = 0; i < uncachedTabs.length; i += 20) {
        const batch = uncachedTabs.slice(i, i + 20);
        const results = await Promise.all(batch.map(async ({ gid }) => {
          try {
            const res = await fetch(
              `https://docs.google.com/spreadsheets/d/${SHEET2_KW_ID}/gviz/tq?tqx=out:csv&gid=${gid}&range=A1`,
              { headers: { "User-Agent": "Mozilla/5.0" }, redirect: "follow", signal: AbortSignal.timeout(10000) }
            );
            if (!res.ok) return null;
            const text = await res.text();
            return text.split("\n")[0]?.replace(/^"|"$/g, "").trim() || null;
          } catch { return null; }
        }));
        for (let j = 0; j < batch.length; j++) {
          if (results[j]) {
            cachedMap.set(batch[j].gid, results[j]!);
            newMappings.push({ tab_gid: batch[j].gid, shop_name: results[j]! });
          }
        }
      }

      // 新規マッピングをSupabaseに保存
      if (newMappings.length > 0) {
        const rows = newMappings.map(m => ({
          sheet_id: SHEET2_KW_ID,
          tab_gid: m.tab_gid,
          shop_name: m.shop_name,
          updated_at: new Date().toISOString(),
        }));
        await supabase.from("sheet_tab_mapping").upsert(rows, { onConflict: "sheet_id,tab_gid" }).then(() => {});
        console.log(`[spreadsheet] Cached ${newMappings.length} new tab→shop mappings`);
      }

      // 全タブの店舗名を追加
      for (const tab of shopTabs) {
        const shopName = cachedMap.get(tab.gid);
        if (!shopName || existingNames.has(shopName)) continue;
        if (!shopName.startsWith("エミナルクリニック") && !shopName.startsWith("メンズエミナル")) continue;
        const reviewInfo = data.reviews.get(shopName);
        shops.push({
          id: shopName, name: shopName, address: "", period: "",
          rating: reviewInfo?.currentRating ?? 0,
          totalReviews: reviewInfo?.currentCount ?? 0,
          dataSource: "sheet_only",
        });
        existingNames.add(shopName);
      }
    } catch (e) {
      console.error("[spreadsheet] Sheet2 tab import error:", e);
    }
  } catch {}

  // 既存店舗にdataSource="both"を設定
  for (const s of shops) {
    if (!s.dataSource) s.dataSource = "both";
  }

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

  // Supabaseから店舗ID・GBPロケーション名を取得（検索語句API用）
  let opts: { shopId?: string; locationFullPath?: string } | undefined;
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "",
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
    );
    // 完全一致 → 部分一致の順で検索（スプレッドシート名とDB名の表記揺れ対応）
    let shop: any = null;
    const { data: exact } = await supabase
      .from("shops")
      .select("id, gbp_location_name")
      .eq("name", shopName)
      .maybeSingle();
    shop = exact;
    if (!shop) {
      // 【】→スペースに変換して部分一致
      const simpleName = shopName.replace(/[【】\[\]（）()]/g, " ").replace(/\s+/g, " ").trim();
      const { data: fuzzy } = await supabase
        .from("shops")
        .select("id, gbp_location_name, name")
        .ilike("name", `%${simpleName.split(" ")[0]}%`)
        .limit(10);
      if (fuzzy && fuzzy.length > 0) {
        // 最も名前が近いものを選択
        const normalize = (s: string) => s.replace(/[【】\[\]（）()_\s]/g, "").toLowerCase();
        const target = normalize(shopName);
        shop = fuzzy.find(s => normalize(s.name) === target)
          || fuzzy.find(s => target.includes(normalize(s.name)) || normalize(s.name).includes(target))
          || null;
      }
    }
    if (shop) {
      console.log(`[spreadsheet] shop matched: "${shopName}" → DB id=${shop.id}, loc=${shop.gbp_location_name}`);
      opts = { shopId: shop.id, locationFullPath: shop.gbp_location_name || undefined };
    } else {
      console.log(`[spreadsheet] shop not found in DB: "${shopName}"`);
    }
  } catch (e: any) {
    console.error("[spreadsheet] shop lookup error:", e?.message || e);
    console.error("[spreadsheet] shop lookup stack:", e?.stack?.slice(0, 300));
  }

  // ログ: opts の状態を出力
  if (opts) {
    console.log(`[spreadsheet] opts OK: shopId=${opts.shopId}, loc=${opts.locationFullPath}`);
  } else {
    console.log(`[spreadsheet] opts is undefined for "${shopName}" → API検索語句をスキップ`);
  }

  return await buildReportData(shopName, perfRows, reviewData, opts);
}
