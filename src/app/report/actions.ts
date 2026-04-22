"use server";

import { revalidatePath } from "next/cache";
import { getShopsFromSpreadsheet, getReportFromSpreadsheet } from "@/lib/spreadsheet";
import { writeShopListToCache, writeReportDataToCache } from "@/lib/report-cache";

/** 全店舗データをスプレッドシートから取得 → Supabaseキャッシュに保存 */
export async function syncAllData() {
  try {
    // 1. スプレッドシートから店舗一覧取得
    const shops = await getShopsFromSpreadsheet();
    if (!shops || shops.length === 0) {
      return { success: false, error: "スプレッドシートからデータを取得できませんでした", timestamp: new Date().toISOString() };
    }

    // 2. 店舗一覧をSupabaseに保存
    await writeShopListToCache(shops);

    // 3. 各店舗のレポートデータも取得して保存（5件ずつ並列）
    let synced = 0;
    for (let i = 0; i < shops.length; i += 5) {
      const batch = shops.slice(i, i + 5);
      await Promise.all(
        batch.map(async (shop) => {
          try {
            const report = await getReportFromSpreadsheet(shop.name);
            if (report) {
              await writeReportDataToCache(shop.name, report);
              synced++;
            }
          } catch (e) {
            console.error(`[sync] ${shop.name} error:`, e);
          }
        })
      );
    }

    // 4. Next.jsキャッシュを無効化
    revalidatePath("/report", "layout");

    return { success: true, count: synced, total: shops.length, timestamp: new Date().toISOString() };
  } catch (e: any) {
    return { success: false, error: e?.message || "同期に失敗しました", timestamp: new Date().toISOString() };
  }
}

/** 指定店舗のみ同期 */
export async function syncShopData(shopIds: string[]) {
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
