/**
 * レポートデータ取得モジュール
 * Supabaseキャッシュ → スプレッドシートフォールバック
 */

import type { ReportData, ShopListItem, GridRankingReport } from "./report-data";
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
 * 店舗名からshops.idを取得
 */
async function getShopDbId(shopName: string): Promise<string | null> {
  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "",
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
    );
    const { data } = await sb
      .from("shops")
      .select("id")
      .eq("name", shopName)
      .maybeSingle();
    if (data?.id) return data.id;
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
      const match = fuzzy.find(s => normalize(s.name) === target)
        || fuzzy.find(s => target.includes(normalize(s.name)) || normalize(s.name).includes(target));
      return match?.id || null;
    }
  } catch {}
  return null;
}

/**
 * グリッド順位データをリアルタイム取得
 */
async function fetchGridRankingLive(shopDbId: string): Promise<GridRankingReport | undefined> {
  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "",
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
    );
    const { data: logs } = await sb
      .from("grid_ranking_logs")
      .select("keyword, grid_size, interval_m, results, measured_at")
      .eq("shop_id", shopDbId)
      .order("measured_at", { ascending: true });
    console.log(`[report-api] grid ranking live: shopDbId=${shopDbId}, logs=${logs?.length ?? 0}`);
    if (!logs || logs.length === 0) return undefined;

    const keywordSet = new Set<string>();
    const monthMap = new Map<string, any[]>();

    for (const log of logs) {
      keywordSet.add(log.keyword);
      const d = new Date(log.measured_at);
      const monthKey = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}`;
      const results = log.results || [];
      const ranked = results.filter((r: any) => r.rank > 0);
      const avg = ranked.length > 0 ? ranked.reduce((s: number, r: any) => s + r.rank, 0) / ranked.length : 0;
      const snapshot = {
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

    const result: GridRankingReport = { keywords: Array.from(keywordSet), history };
    return result.keywords.length > 0 ? result : undefined;
  } catch (e) {
    console.error("[report-api] grid ranking live error:", e);
    return undefined;
  }
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
      // gridRankingはリアルタイムで上書き
      try {
        const dbId = await getShopDbId(shopName);
        if (dbId) {
          const gridRanking = await fetchGridRankingLive(dbId);
          cached.gridRanking = gridRanking;
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
