/**
 * GBPシート → pmax_gbp_data の「全月一括upsert」共通処理。
 *
 * 従来 sync は対象月の1ヶ月分しかGBPを書かなかったため、
 * エイリアス表（pmax-gbp-alias.ts）に対応を追加しても過去月が空のままになる
 * 「backfill実行忘れ」事故が起きた（2026-08-11判明: てっぱち札幌大通り店等が
 * 2026/06の1ヶ月分だけの状態で顧客レポートに出ていた）。
 * sync / backfill-gbp の両方がこの関数を使うことで、
 * 月次同期のたびにマッチ店舗の全月が最新化され、実行忘れの余地をなくす。
 */
import type { getSupabase } from "./supabase";
import { getAllGbpRows, normShopName, pickGbpMatch, type PmaxGbpRow } from "./pmax-sheet";

export interface GbpBackfillResult {
  matchedShops: number;
  upserted: number;
  unmatched: string[];
  ambiguous: string[];
  errors: string[];
}

/**
 * 指定したAds側店舗名について、GBPシートの全月データを pmax_gbp_data にupsertする。
 * 照合は pickGbpMatch（完全一致→エイリアス→一意な相互部分一致、複数候補はスキップ）。
 */
export async function upsertGbpAllMonths(
  sb: ReturnType<typeof getSupabase>,
  adsShopNames: string[],
): Promise<GbpBackfillResult> {
  const result: GbpBackfillResult = { matchedShops: 0, upserted: 0, unmatched: [], ambiguous: [], errors: [] };
  if (adsShopNames.length === 0) return result;

  const sheetRows = await getAllGbpRows();
  if (sheetRows.length === 0) {
    result.errors.push("GBPシートからデータを取得できませんでした");
    return result;
  }

  // normName -> (month -> row) 同一店×月の重複はシート後方=最新行を採用
  const byNorm = new Map<string, Map<string, PmaxGbpRow>>();
  for (const r of sheetRows) {
    const k = normShopName(r.shopName);
    if (!byNorm.has(k)) byNorm.set(k, new Map());
    byNorm.get(k)!.set(r.month, r);
  }
  const sheetKeys = Array.from(byNorm.keys());

  const now = new Date().toISOString();
  const payload: Record<string, unknown>[] = [];

  for (const adsName of adsShopNames) {
    const { key: matchKey, ambiguous: isAmbiguous } = pickGbpMatch(adsName, sheetKeys);
    if (isAmbiguous) { result.ambiguous.push(adsName); continue; }
    const months = matchKey ? byNorm.get(matchKey) : undefined;
    if (!months) { result.unmatched.push(adsName); continue; }
    result.matchedShops++;
    for (const r of Array.from(months.values())) {
      payload.push({
        shop_name: adsName, // レポートが引くキー=Ads名で保存
        month: r.month,
        total_impressions: r.totalImpressions,
        total_visits: r.totalVisits,
        phone: r.phone,
        directions: r.directions,
        website: r.website,
        menu_clicks: r.menuClicks,
        save_share: r.saveShare,
        reservation: r.reservation,
        synced_at: now,
      });
    }
  }

  for (let i = 0; i < payload.length; i += 100) {
    const batch = payload.slice(i, i + 100);
    const { error } = await sb.from("pmax_gbp_data").upsert(batch, { onConflict: "shop_name,month" });
    if (error) result.errors.push(`batch${Math.floor(i / 100) + 1}: ${error.message}`);
    else result.upserted += batch.length;
  }

  result.unmatched.sort();
  result.ambiguous.sort();
  return result;
}
