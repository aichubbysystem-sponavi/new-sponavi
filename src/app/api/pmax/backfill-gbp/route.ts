import { NextRequest, NextResponse } from "next/server";
import { getSupabase, verifyCron } from "@/lib/supabase";
import { upsertGbpAllMonths } from "@/lib/pmax-gbp-backfill";

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
 * 実処理は lib/pmax-gbp-backfill.ts（syncのGBPステップと共通）。
 *
 * 認証: CRON_SECRET（Authorization: Bearer）
 */
export async function POST(request: NextRequest) {
  const cronErr = verifyCron(request);
  if (cronErr) return cronErr;

  const sb = getSupabase();

  // Ads側の店舗名一覧（pmax_store_data、1000行制限をページングで回避）
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

  const result = await upsertGbpAllMonths(sb, Array.from(adsNames));
  if (result.errors.some((e) => e.includes("シートからデータを取得できません"))) {
    return NextResponse.json({ success: false, error: result.errors[0] }, { status: 502 });
  }

  return NextResponse.json({
    success: result.errors.length === 0,
    adsShops: adsNames.size,
    matchedShops: result.matchedShops,
    upserted: result.upserted,
    unmatched: result.unmatched, // シートに対応行が見つからなかったAds店舗名
    ambiguous: result.ambiguous, // 複数候補があり照合を保留した店舗名
    errors: result.errors.slice(0, 5),
  });
}
