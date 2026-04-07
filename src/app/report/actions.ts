"use server";

import { revalidatePath } from "next/cache";
import { clearSpreadsheetCache } from "@/lib/spreadsheet";

/** 全店舗データを最新化 */
export async function syncAllData() {
  clearSpreadsheetCache();
  revalidatePath("/report", "layout");
  return { success: true, timestamp: new Date().toISOString() };
}

/** 指定店舗のレポートページを再生成 */
export async function syncShopData(shopIds: string[]) {
  clearSpreadsheetCache();
  for (const id of shopIds) {
    revalidatePath(`/report/${encodeURIComponent(id)}`);
  }
  revalidatePath("/report");
  return { success: true, count: shopIds.length, timestamp: new Date().toISOString() };
}
