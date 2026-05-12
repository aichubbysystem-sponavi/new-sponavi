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
  const { fetchSearchKeywordsFromGBP, cacheSearchKeywords } = await import("@/lib/gbp-search-keywords");
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

        // 検索語句API同期: shopsテーブルからlocationパスを取得して直接API取得
        try {
          const { data: shop } = await supabase
            .from("shops")
            .select("id, gbp_location_name")
            .eq("name", shopName)
            .maybeSingle();

          if (shop?.gbp_location_name) {
            const apiData = await fetchSearchKeywordsFromGBP(shop.gbp_location_name, 12);
            if (apiData.length > 0) {
              await cacheSearchKeywords(shop.id, shopName, apiData);
              // report_data_cacheのsearchQueriesも更新
              const latest = apiData[apiData.length - 1];
              const { data: reportCache } = await supabase
                .from("report_data_cache")
                .select("report_json")
                .eq("shop_name", shopName)
                .maybeSingle();
              if (reportCache?.report_json) {
                const reportJson = reportCache.report_json as any;
                reportJson.searchQueries = {
                  latest: latest.keywords.slice(0, 30),
                  latestMonth: latest.month,
                  history: apiData,
                };
                await supabase
                  .from("report_data_cache")
                  .update({ report_json: reportJson, synced_at: new Date().toISOString() })
                  .eq("shop_name", shopName);
              }
              console.log(`[sync] ${shopName}: 検索語句API同期完了 (${apiData.length}ヶ月)`);
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
