import { NextRequest, NextResponse } from "next/server";
import { getSupabase, requireRole } from "@/lib/supabase";
import { centerCell } from "@/lib/report-utils";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/report/grid-export
 * 全計測データをCSV形式でエクスポート
 * ?month=YYYY-MM でフィルタ可能（省略時は今月）。
 * 月は帰属月(report_month)基準: 月初1〜3日計測は前月分（レポート表示と同じ）
 */
export async function GET(request: NextRequest) {
  const r = await requireRole(request, ["president", "executive", "manager"]);
  if (r.error) return r.error;

  const sb = getSupabase();
  const monthParam = request.nextUrl.searchParams.get("month");

  // 対象帰属月（"YYYY/M" 形式。grid_ranking_logs.report_month と同じ）
  const now = new Date();
  let reportMonth: string;
  let monthLabel: string;

  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [y, m] = monthParam.split("-").map(Number);
    reportMonth = `${y}/${m}`;
    monthLabel = `${y}年${m}月`;
  } else {
    reportMonth = `${now.getFullYear()}/${now.getMonth() + 1}`;
    monthLabel = `${now.getFullYear()}年${now.getMonth() + 1}月`;
  }

  // 計測ログ取得
  const { data: logs, error } = await sb
    .from("grid_ranking_logs")
    .select("shop_id, keyword, grid_size, interval_m, results, measured_at")
    .eq("report_month", reportMonth)
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

  // CSV生成（中心地点の順位のみ）
  const BOM = "\uFEFF";
  const header = "店舗名,キーワード,中心順位,計測日時";
  const rows = (logs || []).map((log: {
    shop_id: string; keyword: string; grid_size: number;
    results: { row: number; col: number; rank: number }[]; measured_at: string;
  }) => {
    const shopName = nameMap.get(log.shop_id) || log.shop_id;
    const results = log.results || [];
    // 奇数グリッド=中心地点の順位、偶数グリッド（斜め4地点計測）=圏内地点の平均順位で代替
    const centerPoint = centerCell(results, log.grid_size);
    let centerRank: string | number;
    if (centerPoint) {
      centerRank = centerPoint.rank > 0 ? centerPoint.rank : "圏外";
    } else {
      const ranked = results.filter(r => r.rank > 0);
      centerRank = ranked.length > 0
        ? `平均${(ranked.reduce((s, r) => s + r.rank, 0) / ranked.length).toFixed(1)}`
        : "圏外";
    }
    const date = new Date(log.measured_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

    const esc = (v: string) => v.includes(",") || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v;
    return [esc(shopName), esc(log.keyword), centerRank, date].join(",");
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
