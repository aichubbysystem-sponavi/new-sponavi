/**
 * レポートデータ取得モジュール
 * Google Spreadsheet からデータ取得
 */

import type { ReportData, ShopListItem } from "./report-data";
import { getShopsFromSpreadsheet, getReportFromSpreadsheet } from "./spreadsheet";

/**
 * 店舗一覧を取得（スプレッドシートのみ）
 */
export async function getShopList(): Promise<{
  shops: ShopListItem[];
  source: "spreadsheet" | "mock";
}> {
  const shops = await getShopsFromSpreadsheet();

  if (shops && shops.length > 0) {
    return { shops, source: "spreadsheet" };
  }

  return { shops: [], source: "mock" };
}

/**
 * 特定店舗のレポートデータを取得（スプレッドシートのみ）
 */
export async function getReportData(shopId: string): Promise<{
  data: ReportData | null;
  source: "spreadsheet" | "mock";
}> {
  const shopName = decodeURIComponent(shopId);
  const data = await getReportFromSpreadsheet(shopName);

  if (data) {
    return { data, source: "spreadsheet" };
  }

  return { data: null, source: "mock" };
}
