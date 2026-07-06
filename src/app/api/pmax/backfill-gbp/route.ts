import { NextRequest, NextResponse } from "next/server";
import { getSupabase, verifyCron } from "@/lib/supabase";
import { getAllGbpRows, normShopName, type PmaxGbpRow } from "@/lib/pmax-sheet";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/pmax/backfill-gbp
 * GBPシートの全月データを「広告側の店舗名」で pmax_gbp_data に一括upsert（バックフィル用）
 *
 * レポートは pmax_store_data（Google Ads由来）の店舗名でGBPデータを引くため、
 * シート側の表記ゆれ（全半角・空白・別名）があると数値が0になる。
 * ここでは Ads側の全店舗名を取得し、正規化照合でシート行を対応付けてAds名でupsertする。
 * 照合できなかった店舗は unmatched として返す（シート側の店名修正が必要な一覧）。
 *
 * 認証: CRON_SECRET（Authorization: Bearer）
 */
export async function POST(request: NextRequest) {
  const cronErr = verifyCron(request);
  if (cronErr) return cronErr;

  const sb = getSupabase();

  // 1. Ads側の店舗名一覧（pmax_store_data、1000行制限をページングで回避）
  const adsNames = new Set<string>();
  let from = 0;
  while (true) {
    const { data, error } = await sb.from("pmax_store_data").select("shop_name").range(from, from + 999);
    if (error) return NextResponse.json({ success: false, error: `pmax_store_data取得失敗: ${error.message}` }, { status: 500 });
    if (!data || data.length === 0) break;
    for (const r of data) if (r.shop_name) adsNames.add(r.shop_name);
    if (data.length < 1000) break;
    from += 1000;
  }
  if (adsNames.size === 0) {
    return NextResponse.json({ success: false, error: "pmax_store_data に店舗がありません" }, { status: 502 });
  }

  // 2. シート全行を正規化キーでグループ化（同一店×月の重複はシート後方=最新行を採用）
  const sheetRows = await getAllGbpRows();
  if (sheetRows.length === 0) {
    return NextResponse.json({ success: false, error: "シートからデータを取得できませんでした" }, { status: 502 });
  }
  const byNorm = new Map<string, Map<string, PmaxGbpRow>>(); // normName -> (month -> row)
  for (const r of sheetRows) {
    const k = normShopName(r.shopName);
    if (!byNorm.has(k)) byNorm.set(k, new Map());
    byNorm.get(k)!.set(r.month, r);
  }
  const sheetKeys = Array.from(byNorm.keys());

  // 3. Ads名ごとにシート行を照合（完全一致 → 一意な相互部分一致）してAds名でupsert
  const now = new Date().toISOString();
  const payload: Record<string, unknown>[] = [];
  const unmatched: string[] = [];
  const ambiguous: string[] = [];
  let matchedShops = 0;

  for (const adsName of Array.from(adsNames)) {
    const key = normShopName(adsName);
    let months = byNorm.get(key);
    if (!months) {
      // 部分一致（getGbpDataForShopと同基準）。ただし複数候補は誤マッチ防止でスキップ
      const cands = key.length > 0 ? sheetKeys.filter((k) => k.includes(key) || key.includes(k)) : [];
      if (cands.length === 1) months = byNorm.get(cands[0]);
      else if (cands.length > 1) {
        // タイブレーク: 「Ads名+店」への完全一致だけは安全に採用（例: CHILLRI 堀江 → CHILLRI 堀江店）
        const exactPlusTen = cands.filter((k) => k === `${key}店`);
        if (exactPlusTen.length === 1) months = byNorm.get(exactPlusTen[0]);
        else { ambiguous.push(adsName); continue; }
      }
    }
    if (!months) { unmatched.push(adsName); continue; }
    matchedShops++;
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

  let upserted = 0;
  const errors: string[] = [];
  for (let i = 0; i < payload.length; i += 100) {
    const batch = payload.slice(i, i + 100);
    const { error } = await sb.from("pmax_gbp_data").upsert(batch, { onConflict: "shop_name,month" });
    if (error) errors.push(`batch${Math.floor(i / 100) + 1}: ${error.message}`);
    else upserted += batch.length;
  }

  return NextResponse.json({
    success: errors.length === 0,
    adsShops: adsNames.size,
    matchedShops,
    upserted,
    unmatched: unmatched.sort(),   // シートに対応行が見つからなかったAds店舗名
    ambiguous: ambiguous.sort(),   // 複数候補があり照合を保留した店舗名
    errors: errors.slice(0, 5),
  });
}
