import { NextRequest, NextResponse } from "next/server";
import { getSupabase, requireRole } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/report/grid-export
 * 全計測データをCSV形式でエクスポート
 * ?month=YYYY-MM でフィルタ可能（省略時は今月）
 */
export async function GET(request: NextRequest) {
  const r = await requireRole(request, ["president", "manager"]);
  if (r.error) return r.error;

  const sb = getSupabase();
  const monthParam = request.nextUrl.searchParams.get("month");

  // 対象期間
  const now = new Date();
  let startDate: string;
  let endDate: string;
  let monthLabel: string;

  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [y, m] = monthParam.split("-").map(Number);
    startDate = `${monthParam}-01T00:00:00`;
    const lastDay = new Date(y, m, 0).getDate();
    endDate = `${monthParam}-${String(lastDay).padStart(2, "0")}T23:59:59`;
    monthLabel = `${y}年${m}月`;
  } else {
    startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01T00:00:00`;
    endDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-31T23:59:59`;
    monthLabel = `${now.getFullYear()}年${now.getMonth() + 1}月`;
  }

  // 計測ログ取得
  const { data: logs, error } = await sb
    .from("grid_ranking_logs")
    .select("shop_id, keyword, grid_size, interval_m, results, measured_at")
    .gte("measured_at", startDate)
    .lte("measured_at", endDate)
    .order("measured_at", { ascending: false })
    .limit(50000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // shop_id → 店舗名マッピング
  const shopIds = Array.from(new Set((logs || []).map((l: { shop_id: string }) => l.shop_id)));
  const { data: shopRows } = await sb
    .from("shops")
    .select("id, name")
    .in("id", shopIds.length > 0 ? shopIds : ["__none__"])
    .limit(5000);
  const nameMap = new Map((shopRows || []).map((s: { id: string; name: string }) => [s.id, s.name]));

  // CSV生成
  const BOM = "\uFEFF";
  const header = "店舗名,キーワード,グリッドサイズ,間隔(m),平均順位,TOP3率,TOP10率,圏外率,計測日時";
  const rows = (logs || []).map((log: {
    shop_id: string; keyword: string; grid_size: number;
    interval_m: number; results: { rank: number }[]; measured_at: string;
  }) => {
    const shopName = nameMap.get(log.shop_id) || log.shop_id;
    const results = log.results || [];
    const total = results.length;
    const ranked = results.filter(r => r.rank > 0);
    const avgRank = ranked.length > 0
      ? (ranked.reduce((a, b) => a + b.rank, 0) / ranked.length).toFixed(1)
      : "-";
    const top3 = total > 0 ? ((ranked.filter(r => r.rank <= 3).length / total) * 100).toFixed(1) + "%" : "-";
    const top10 = total > 0 ? ((ranked.filter(r => r.rank <= 10).length / total) * 100).toFixed(1) + "%" : "-";
    const outOfRange = total > 0 ? ((results.filter(r => r.rank <= 0).length / total) * 100).toFixed(1) + "%" : "-";
    const date = new Date(log.measured_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

    // CSV値のエスケープ
    const esc = (v: string) => v.includes(",") || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v;
    return [esc(shopName), esc(log.keyword), log.grid_size, log.interval_m, avgRank, top3, top10, outOfRange, date].join(",");
  });

  const csv = BOM + header + "\n" + rows.join("\n");
  const filename = `grid_ranking_${monthParam || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
