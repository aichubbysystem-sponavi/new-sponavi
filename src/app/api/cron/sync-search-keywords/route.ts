/**
 * GET /api/cron/sync-search-keywords
 * 全店舗の検索語句をGBP Performance APIから一括同期
 * Vercel Cron: 毎日5:00 JST (UTC 20:00)
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchSearchKeywordsFromGBP, cacheSearchKeywords } from "@/lib/gbp-search-keywords";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // gbp_location_nameが設定されている全店舗を取得
  const { data: shops, error } = await supabase
    .from("shops")
    .select("id, name, gbp_location_name")
    .not("gbp_location_name", "is", null)
    .neq("gbp_location_name", "");

  if (error || !shops || shops.length === 0) {
    return NextResponse.json({ error: "No shops found", detail: error?.message }, { status: 200 });
  }

  let synced = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const shop of shops) {
    try {
      const apiData = await fetchSearchKeywordsFromGBP(shop.gbp_location_name, 12);
      if (apiData.length === 0) {
        console.log(`[cron/sync-search-keywords] ${shop.name}: API returned 0 months`);
        continue;
      }

      await cacheSearchKeywords(shop.id, shop.name, apiData);

      // report_data_cacheのsearchQueriesも更新
      const latest = apiData[apiData.length - 1];
      const { data: reportCache } = await supabase
        .from("report_data_cache")
        .select("report_json")
        .eq("shop_name", shop.name)
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
          .eq("shop_name", shop.name);
      }

      synced++;
      console.log(`[cron/sync-search-keywords] ${shop.name}: ${apiData.length}ヶ月同期完了`);
    } catch (e: any) {
      failed++;
      errors.push(`${shop.name}: ${e?.message || "unknown"}`);
      console.error(`[cron/sync-search-keywords] ${shop.name}: error:`, e);
    }
  }

  console.log(`[cron/sync-search-keywords] done: ${synced}/${shops.length} synced, ${failed} failed`);
  return NextResponse.json({
    success: true,
    total: shops.length,
    synced,
    failed,
    errors: errors.slice(0, 10),
  });
}
