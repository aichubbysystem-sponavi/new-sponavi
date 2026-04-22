"use server";

import { revalidatePath } from "next/cache";
import { getShopsFromSpreadsheet } from "@/lib/spreadsheet";
import { writeShopListToCache } from "@/lib/report-cache";

/**
 * 全店舗反映: 店舗一覧のみスプレッドシートから取得 → Supabaseに保存
 * （個別レポートは店舗ページ表示時にオンデマンドでキャッシュ）
 */
export async function syncAllData() {
  try {
    const shops = await getShopsFromSpreadsheet();
    if (!shops || shops.length === 0) {
      return { success: false, error: "スプレッドシートからデータを取得できませんでした", timestamp: new Date().toISOString() };
    }

    await writeShopListToCache(shops);
    revalidatePath("/report", "layout");

    return { success: true, count: shops.length, total: shops.length, timestamp: new Date().toISOString() };
  } catch (e: any) {
    return { success: false, error: e?.message || "同期に失敗しました", timestamp: new Date().toISOString() };
  }
}

/** 指定店舗のみレポートデータを同期 */
export async function syncShopData(shopIds: string[]) {
  const { getReportFromSpreadsheet } = await import("@/lib/spreadsheet");
  const { writeReportDataToCache } = await import("@/lib/report-cache");

  try {
    let synced = 0;
    for (const shopName of shopIds) {
      try {
        const report = await getReportFromSpreadsheet(shopName);
        if (report) {
          await writeReportDataToCache(shopName, report);
          synced++;
        }
      } catch (e) {
        console.error(`[sync] ${shopName} error:`, e);
      }
    }

    for (const id of shopIds) {
      revalidatePath(`/report/${encodeURIComponent(id)}`);
    }
    revalidatePath("/report");

    return { success: true, count: synced, timestamp: new Date().toISOString() };
  } catch (e: any) {
    return { success: false, error: e?.message, count: 0, timestamp: new Date().toISOString() };
  }
}
