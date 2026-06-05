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

/** 指定店舗のみレポートデータを同期（検索語句API同期を含む） */
export async function syncShopData(shopIds: string[]) {
  const { getReportFromSpreadsheet } = await import("@/lib/spreadsheet");
  const { writeReportDataToCache } = await import("@/lib/report-cache");
  const { syncShopSearchKeywords } = await import("@/lib/gbp-search-keywords");
  const { createClient } = await import("@supabase/supabase-js");

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
  );

  try {
    let synced = 0;
    for (const shopName of shopIds) {
      try {
        const report = await getReportFromSpreadsheet(shopName);
        if (report) {
          await writeReportDataToCache(shopName, report);
          synced++;
        }

        // 検索語句API同期: 共有lib の統一関数を使用（IDベース）
        try {
          const { data: shop } = await supabase
            .from("shops")
            .select("id, name, gbp_location_name")
            .eq("name", shopName)
            .limit(1)
            .single();

          if (shop?.gbp_location_name) {
            const result = await syncShopSearchKeywords(shop.id, shop.name, shop.gbp_location_name, 12);
            if (result.success) {
              console.log(`[sync] ${shopName}: 検索語句API同期完了 (${result.totalMonths}ヶ月)`);
            }
          }
        } catch (e) {
          console.error(`[sync] ${shopName}: 検索語句API同期エラー (続行):`, e);
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
