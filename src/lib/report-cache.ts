/**
 * レポートデータのSupabaseキャッシュ読み書きモジュール
 *
 * 「反映する」ボタン押下時のみスプレッドシートから取得 → Supabaseに保存
 * 通常のページ表示はSupabaseから高速読み取り
 */

import { createClient } from "@supabase/supabase-js";
import type { ShopListItem, ReportData } from "./report-data";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

/** 読み取り用（anon key） */
function readClient() {
  return createClient(SUPABASE_URL, ANON_KEY || SERVICE_KEY);
}

/** 書き込み用（service role key - RLSバイパス） */
function writeClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY || ANON_KEY);
}

// ── 店舗一覧キャッシュ ──

export async function readShopListFromCache(): Promise<ShopListItem[] | null> {
  const sb = readClient();
  const { data, error } = await sb
    .from("report_shop_list")
    .select("*")
    .order("name", { ascending: true });

  if (error || !data || data.length === 0) return null;

  return data.map((r: any) => ({
    id: r.id,
    name: r.name,
    address: r.address || "",
    period: r.period || "",
    rating: r.rating || 0,
    totalReviews: r.total_reviews || 0,
    area: r.area || undefined,
    prevRating: r.prev_rating || undefined,
    prevTotalReviews: r.prev_total_reviews || undefined,
    searchTotal: r.search_total || undefined,
    prevSearchTotal: r.prev_search_total || undefined,
    mapTotal: r.map_total || undefined,
    prevMapTotal: r.prev_map_total || undefined,
    actionTotal: r.action_total || undefined,
    prevActionTotal: r.prev_action_total || undefined,
    analyzed: r.analyzed || false,
  }));
}

export async function writeShopListToCache(shops: ShopListItem[]): Promise<void> {
  const sb = writeClient();

  // 全削除 → 一括挿入
  await sb.from("report_shop_list").delete().neq("id", "");

  if (shops.length === 0) return;

  const rows = shops.map(s => ({
    id: s.id,
    name: s.name,
    address: s.address,
    period: s.period,
    rating: s.rating,
    total_reviews: s.totalReviews,
    area: s.area || null,
    prev_rating: s.prevRating ?? null,
    prev_total_reviews: s.prevTotalReviews ?? null,
    search_total: s.searchTotal ?? null,
    prev_search_total: s.prevSearchTotal ?? null,
    map_total: s.mapTotal ?? null,
    prev_map_total: s.prevMapTotal ?? null,
    action_total: s.actionTotal ?? null,
    prev_action_total: s.prevActionTotal ?? null,
    analyzed: false,
    synced_at: new Date().toISOString(),
  }));

  // 100件ずつバッチ挿入
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const { error } = await sb.from("report_shop_list").insert(batch);
    if (error) console.error("[report-cache] shop list insert error:", error.message);
  }
}

// ── レポートデータキャッシュ ──

export async function readReportDataFromCache(shopName: string): Promise<ReportData | null> {
  const sb = readClient();
  const { data, error } = await sb
    .from("report_data_cache")
    .select("report_json")
    .eq("shop_name", shopName)
    .maybeSingle();

  if (error || !data) return null;
  return data.report_json as ReportData;
}

export async function writeReportDataToCache(shopName: string, reportData: ReportData): Promise<void> {
  const sb = writeClient();
  const { error } = await sb
    .from("report_data_cache")
    .upsert({
      shop_name: shopName,
      report_json: reportData,
      synced_at: new Date().toISOString(),
    }, { onConflict: "shop_name" });

  if (error) console.error("[report-cache] report data upsert error:", error.message);
}

// ── 最終同期日時 ──

export async function getLastSyncTime(): Promise<string | null> {
  const sb = readClient();
  const { data } = await sb
    .from("report_shop_list")
    .select("synced_at")
    .order("synced_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.synced_at || null;
}
