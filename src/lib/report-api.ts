/**
 * レポートデータ取得モジュール
 * Google Spreadsheet からデータ取得 → ReportData 形式に変換
 * 取得失敗時はモックデータにフォールバック
 */

import type { ReportData, ShopListItem } from "./report-data";
import { mockReportData, mockShopList } from "./report-data";
import { getShopsFromSpreadsheet, getReportFromSpreadsheet } from "./spreadsheet";

/**
 * 店舗一覧を取得（スプレッドシート → モックフォールバック）
 */
export async function getShopList(): Promise<{
  shops: ShopListItem[];
  source: "spreadsheet" | "mock";
}> {
  const shops = await getShopsFromSpreadsheet();

  if (shops && shops.length > 0) {
    return { shops, source: "spreadsheet" };
  }

  return { shops: mockShopList, source: "mock" };
}

/**
 * 特定店舗のレポートデータを取得（スプレッドシート → モックフォールバック）
 */
export async function getReportData(shopId: string): Promise<{
  data: ReportData | null;
  source: "spreadsheet" | "mock";
}> {
  // まずスプレッドシートから取得
  const shopName = decodeURIComponent(shopId);
  const data = await getReportFromSpreadsheet(shopName);

  if (data) {
    return { data, source: "spreadsheet" };
  }

  // モックデータから検索（旧IDにも対応）
  const mockData = mockReportData[shopId] ?? null;
  if (mockData) {
    return { data: mockData, source: "mock" };
  }

  return { data: null, source: "mock" };
}
