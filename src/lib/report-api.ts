/**
 * レポートデータ取得モジュール
 * Supabaseキャッシュ → スプレッドシートフォールバック
 */

import type { ReportData, ShopListItem } from "./report-data";
import { readShopListFromCache, readReportDataFromCache, writeReportDataToCache } from "./report-cache";
import { getShopsFromSpreadsheet, getReportFromSpreadsheet } from "./spreadsheet";

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
 * 特定店舗のレポートデータを取得（キャッシュ優先）
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
      return { data: cached, source: "cache" };
    }
  } catch {}

  // 2. フォールバック: スプレッドシートから取得 → 自動キャッシュ
  const data = await getReportFromSpreadsheet(shopName);
  if (data) {
    // 次回から高速読み取りできるようキャッシュに保存
    try { await writeReportDataToCache(shopName, data); } catch {}
    return { data, source: "spreadsheet" };
  }

  return { data: null, source: "mock" };
}
