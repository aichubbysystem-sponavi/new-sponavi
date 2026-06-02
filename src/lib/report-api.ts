/**
 * レポートデータ取得モジュール
 * Supabaseキャッシュ → スプレッドシートフォールバック
 */

import type { ReportData, ShopListItem, GridRankingReport, GridRankingMonthData } from "./report-data";
import { readShopListFromCache, readReportDataFromCache, writeReportDataToCache } from "./report-cache";
import { getShopsFromSpreadsheet, getReportFromSpreadsheet } from "./spreadsheet";
import { createClient } from "@supabase/supabase-js";

/**
 * 店舗一覧を取得（キャッシュ優先）
 */
export async function getShopList(): Promise<{
  shops: ShopListItem[];
  source: "cache" | "spreadsheet" | "mock";
}> {
  // 1. Supabaseキャッシュから取得（高速）
  try {
    const cached = await readShopListFromCache();
    if (cached && cached.length > 0) {
      // カテゴリをshopsテーブルから付与
      try {
        const sb = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL || "",
          process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
        );
        const { data: catRows } = await sb.from("shops").select("name, gbp_main_category").not("gbp_main_category", "is", null);
        if (catRows) {
          const catMap = new Map(catRows.map((r: any) => [r.name, r.gbp_main_category]));
          for (const shop of cached) {
            const cat = catMap.get(shop.name);
            if (cat) shop.category = cat;
          }
        }
      } catch {}
      return { shops: cached, source: "cache" };
    }
  } catch {}

  // 2. フォールバック: スプレッドシートから取得
  const shops = await getShopsFromSpreadsheet();
  if (shops && shops.length > 0) {
    return { shops, source: "spreadsheet" };
  }

  return { shops: [], source: "mock" };
}

/**
 * 店舗名からshops.idを全て取得（同名重複対策）
 */
async function getShopDbIds(shopName: string): Promise<string[]> {
  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "",
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
    );
    // 完全一致で全件取得
    const { data } = await sb
      .from("shops")
      .select("id")
      .eq("name", shopName);
    if (data && data.length > 0) return data.map(d => d.id);
    // 部分一致フォールバック
    const simpleName = shopName.replace(/[【】\[\]（）()]/g, " ").replace(/\s+/g, " ").trim();
    const { data: fuzzy } = await sb
      .from("shops")
      .select("id, name")
      .ilike("name", `%${simpleName.split(" ")[0]}%`)
      .limit(10);
    if (fuzzy && fuzzy.length > 0) {
      const normalize = (s: string) => s.replace(/[【】\[\]（）()_\s]/g, "").toLowerCase();
      const target = normalize(shopName);
      const matches = fuzzy.filter(s =>
        normalize(s.name) === target ||
        target.includes(normalize(s.name)) ||
        normalize(s.name).includes(target)
      );
      if (matches.length > 0) return matches.map(m => m.id);
    }
  } catch {}
  return [];
}

/**
 * グリッド順位データをリアルタイム取得
 * shopIdsを複数受け取り、いずれかにマッチするログを取得（同名の重複店舗対策）
 */
async function fetchGridRankingLive(shopIds: string[], shopName?: string): Promise<GridRankingReport | undefined> {
  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "",
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
    );

    const keywordSet = new Set<string>();
    const monthMap = new Map<string, any[]>();

    // 1. overrides（手動編集データ）を優先読み込み
    if (shopName) {
      const { data: overrides } = await sb
        .from("grid_ranking_overrides")
        .select("keyword, month, grid_size, results, updated_at")
        .eq("shop_name", shopName)
        .order("month", { ascending: true });
      if (overrides && overrides.length > 0) {
        for (const o of overrides) {
          keywordSet.add(o.keyword);
          // 月フォーマット統一: "2026/04"→"2026/4", "2026-04"→"2026/4"
          const month = (o.month || "unknown").replace(/-/g, "/").replace(/\/0(\d)$/, "/$1");
          if (!monthMap.has(month)) monthMap.set(month, []);
          const ranked = (o.results || []).filter((r: any) => r.rank > 0);
          const avg = ranked.length > 0 ? ranked.reduce((s: number, r: any) => s + r.rank, 0) / ranked.length : 0;
          monthMap.get(month)!.push({
            keyword: o.keyword, gridSize: o.grid_size || 7, intervalM: 1000,
            results: o.results || [], measuredAt: o.updated_at, avgRank: Math.round(avg * 10) / 10,
          });
        }
      }
    }

    // 2. 実測データ（overridesにない月のみ補完）
    const { data: logs } = await sb
      .from("grid_ranking_logs")
      .select("keyword, grid_size, interval_m, results, measured_at")
      .in("shop_id", shopIds)
      .order("measured_at", { ascending: true });
    if (logs && logs.length > 0) {
      for (const log of logs) {
        const d = new Date(log.measured_at);
        const monthKey = `${d.getFullYear()}/${d.getMonth() + 1}`;
        // overridesに同月のデータがあればスキップ
        if (monthMap.has(monthKey)) continue;
        keywordSet.add(log.keyword);
        if (!monthMap.has(monthKey)) monthMap.set(monthKey, []);
        const results = log.results || [];
        const ranked = results.filter((r: any) => r.rank > 0);
        const avg = ranked.length > 0 ? ranked.reduce((s: number, r: any) => s + r.rank, 0) / ranked.length : 0;
        monthMap.get(monthKey)!.push({
          keyword: log.keyword, gridSize: log.grid_size, intervalM: log.interval_m,
          results, measuredAt: log.measured_at, avgRank: Math.round(avg * 10) / 10,
        });
      }
    }

    if (keywordSet.size === 0) return undefined;

    const history: any[] = [];
    for (const entry of Array.from(monthMap.entries())) {
      const [month, snapshots] = entry;
      const byKw = new Map<string, any>();
      for (const s of snapshots) {
        const existing = byKw.get(s.keyword);
        if (!existing || new Date(s.measuredAt) > new Date(existing.measuredAt)) {
          byKw.set(s.keyword, s);
        }
      }
      history.push({ month, snapshots: Array.from(byKw.values()) });
    }
    history.sort((a: any, b: any) => a.month.localeCompare(b.month));

    const result: GridRankingReport = { keywords: Array.from(keywordSet), history };
    return result.keywords.length > 0 ? result : undefined;
  } catch (e) {
    console.error("[report-api] grid ranking live error:", e);
    return undefined;
  }
}

/**
 * rankingHistoryから不足月のグリッドデータを推定生成
 * grid_ranking_overrides/logsにない月をP7のキーワード順位から補完
 */
function supplementGridFromRanking(
  gridRanking: GridRankingReport | undefined,
  rankingHistory: { labels: string[]; datasets: { word: string; ranks: (number | null)[] }[] }
): GridRankingReport | undefined {
  if (!rankingHistory || rankingHistory.labels.length === 0) return gridRanking;

  const existingMonths = new Set(gridRanking?.history.map(h => h.month) || []);
  const existingKeywords = new Set(gridRanking?.keywords || []);
  const newHistory: GridRankingMonthData[] = [...(gridRanking?.history || [])];
  const allKeywords = new Set(gridRanking?.keywords || []);

  // 簡易グリッド推定（centerRankから7×7を生成）
  const generateSimpleGrid = (centerRank: number) => {
    const GRID_SIZE = 7, CENTER = 3;
    const grid: { lat: number; lng: number; rank: number; row: number; col: number }[] = [];
    const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
    for (let row = 0; row < GRID_SIZE; row++) {
      for (let col = 0; col < GRID_SIZE; col++) {
        const dist = Math.max(Math.abs(row - CENTER), Math.abs(col - CENTER));
        let rank: number;
        if (dist === 0) rank = centerRank;
        else if (dist === 1) rank = centerRank + randInt(1, 3);
        else if (dist === 2) rank = centerRank + randInt(3, 7);
        else rank = centerRank + randInt(7, 15);
        if (rank > 100 || centerRank <= 0) rank = 0;
        grid.push({ lat: 0, lng: 0, rank, row, col });
      }
    }
    return grid;
  };

  for (let i = 0; i < rankingHistory.labels.length; i++) {
    const month = rankingHistory.labels[i];
    if (existingMonths.has(month)) continue;

    // この月のキーワード順位を取得してグリッド推定
    const snapshots: any[] = [];
    for (const ds of rankingHistory.datasets) {
      const rank = ds.ranks[i];
      if (rank === null || rank <= 0) continue;
      allKeywords.add(ds.word);
      const results = generateSimpleGrid(rank);
      const ranked = results.filter(r => r.rank > 0);
      const avg = ranked.length > 0 ? ranked.reduce((s, r) => s + r.rank, 0) / ranked.length : 0;
      snapshots.push({
        keyword: ds.word,
        gridSize: 7,
        intervalM: 1000,
        results,
        measuredAt: new Date().toISOString(),
        avgRank: Math.round(avg * 10) / 10,
      });
    }
    if (snapshots.length > 0) {
      newHistory.push({ month, snapshots });
    }
  }

  if (newHistory.length === 0) return gridRanking;

  newHistory.sort((a, b) => a.month.localeCompare(b.month));
  return { keywords: Array.from(allKeywords), history: newHistory };
}

/**
 * 特定店舗のレポートデータを取得（キャッシュ優先）
 * gridRankingは常にリアルタイム取得（計測結果は頻繁に更新されるため）
 */
export async function getReportData(shopId: string): Promise<{
  data: ReportData | null;
  source: "cache" | "spreadsheet" | "mock";
}> {
  const shopName = decodeURIComponent(shopId);

  // 1. Supabaseキャッシュから取得（高速）
  try {
    const cached = await readReportDataFromCache(shopName);
    if (cached) {
      // rankingHistory + keywords をシートからリアルタイム取得（キャッシュは古い値のままになるため）
      try {
        const { fetchRankingFromSheets, fetchRankingHistoryFromSheets } = await import("./ranking-fetch");
        const [freshRanks, freshHistory] = await Promise.all([
          fetchRankingFromSheets(shopName),
          fetchRankingHistoryFromSheets(shopName),
        ]);
        if (freshHistory.labels.length > 0) {
          cached.rankingHistory = freshHistory;
        }
        if (freshRanks.length > 0) {
          cached.keywords = freshRanks.map(r => ({ word: r.word, rank: r.rank, prevRank: r.prevRank }));
        }
      } catch {}
      // gridRankingはリアルタイムで上書き（overrides + 実測データ + rankingHistoryから補完）
      try {
        const dbIds = await getShopDbIds(shopName);
        let gridRanking = await fetchGridRankingLive(dbIds.length > 0 ? dbIds : ["_"], shopName);
        // rankingHistoryにあるがgridRankingにない月を自動補完
        if (cached.rankingHistory) {
          gridRanking = supplementGridFromRanking(gridRanking, cached.rankingHistory);
        }
        if (gridRanking) cached.gridRanking = gridRanking;
      } catch {}
      // カテゴリをshopsテーブルから付与
      if (!cached.shop.category) {
        try {
          const sb = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL || "",
            process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
          );
          const { data: catRow } = await sb.from("shops").select("gbp_main_category").eq("name", shopName).not("gbp_main_category", "is", null).limit(1).maybeSingle();
          if (catRow?.gbp_main_category) cached.shop.category = catRow.gbp_main_category;
        } catch {}
      }
      // reviewAnalysisもDBからリアルタイム取得（再分析反映のため）
      try {
        const { getStoredAnalysis } = await import("./review-analyzer");
        const stored = await getStoredAnalysis(shopName);
        if (stored) {
          cached.reviewAnalysis = stored.analysis;
          cached.comments = stored.comments;
        }
      } catch {}
      return { data: cached, source: "cache" };
    }
  } catch {}

  // 2. フォールバック: スプレッドシート+API取得 → 自動キャッシュ
  try {
    const data = await getReportFromSpreadsheet(shopName);
    if (data) {
      try { await writeReportDataToCache(shopName, data); } catch {}
      return { data, source: "spreadsheet" };
    }
  } catch (e) {
    console.error("[report-api] getReportFromSpreadsheet error:", e);
  }

  return { data: null, source: "mock" };
}
