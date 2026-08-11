import { NextRequest, NextResponse } from "next/server";
import { getSupabase, verifyCron } from "@/lib/supabase";
import { notifySlackText } from "@/lib/slack-notify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type HealthItem = { shop: string; adsMax?: string; gbpMax?: string; since?: string; maxDate?: string; days?: number };
type HealthStats = {
  gbp_stale: HealthItem[];
  gbp_missing_new: HealthItem[];
  daily_stale_prev: HealthItem[];
  daily_stale_cur: HealthItem[];
};

/**
 * GET /api/cron/pmax-health
 * 週次: P-MAXレポートのデータ欠損を検知してSlack通知する。
 * 集計は本番DBのRPC pmax_health_stats()（sql/2026-08-11_pmax_health_stats.sql）。
 *
 * 背景（2026-08-11）: 店舗名の照合漏れでGBP月次が1ヶ月分しか無い店舗、
 * 日次キャッシュが月初の1日分で凍結した店舗が、顧客に指摘されるまで
 * 1年以上誰も気づけなかった。名寄せ問題は新店舗のたびに再発しうるため、
 * 「壊れたら数日で気づける」ことをこのcronで担保する。
 */
export async function GET(request: NextRequest) {
  const cronErr = verifyCron(request);
  if (cronErr) return cronErr;

  const sb = getSupabase();
  const { data, error } = await sb.rpc("pmax_health_stats");
  if (error) {
    // RPC未作成（マイグレーション未適用）もここに出る。握りつぶさず通知する
    console.error("[cron/pmax-health] RPC error:", error.message);
    await notifySlackText(`:warning: P-MAX健全性チェックが実行できませんでした: ${error.message}\n（sql/2026-08-11_pmax_health_stats.sql が本番に適用済みか確認してください）`);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const stats = data as HealthStats;
  const counts = {
    gbpStale: stats.gbp_stale.length,
    gbpMissingNew: stats.gbp_missing_new.length,
    dailyStalePrev: stats.daily_stale_prev.length,
    dailyStaleCur: stats.daily_stale_cur.length,
  };
  const total = counts.gbpStale + counts.gbpMissingNew + counts.dailyStalePrev + counts.dailyStaleCur;

  let notified = false;
  if (total > 0) {
    const listShops = (items: HealthItem[], max = 10) => {
      const names = items.map((i) => i.shop);
      return names.slice(0, max).join("、") + (names.length > max ? ` 他${names.length - max}件` : "");
    };
    const lines = [
      `:mag: *P-MAXレポート データ健全性チェック*（異常 ${total} 件）`,
      counts.gbpStale > 0 ? `• GBP月次が2ヶ月以上遅れ: ${counts.gbpStale}店舗 — ${listShops(stats.gbp_stale)}\n  → シート店名とAds名の照合を確認し、必要なら pmax-gbp-alias.ts に追加` : null,
      counts.gbpMissingNew > 0 ? `• 新店舗でGBPデータなし: ${counts.gbpMissingNew}店舗 — ${listShops(stats.gbp_missing_new)}\n  → LP系なら正常。店舗系なら名前照合漏れの可能性` : null,
      counts.dailyStalePrev > 0 ? `• 前月の日次が月末まで無い: ${counts.dailyStalePrev}店舗 — ${listShops(stats.daily_stale_prev)}` : null,
      counts.dailyStaleCur > 0 ? `• 当月の日次が2日以上遅れ: ${counts.dailyStaleCur}店舗 — ${listShops(stats.daily_stale_cur)}` : null,
      `詳細: /api/cron/pmax-health のレスポンス参照`,
    ].filter(Boolean);
    notified = await notifySlackText(lines.join("\n"));
  }

  return NextResponse.json({ success: true, counts, notified, stats });
}
