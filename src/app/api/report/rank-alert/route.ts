import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

/**
 * GET /api/report/rank-alert?shopId=xxx
 * 順位変動アラート: 前回比で急落/急上昇したキーワードを検出
 */
export async function GET(request: NextRequest) {
  const shopId = request.nextUrl.searchParams.get("shopId");
  if (!shopId) return NextResponse.json({ error: "shopIdが必要です" }, { status: 400 });

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const { data: logs } = await supabase
    .from("ranking_search_logs")
    .select("search_words, rank, searched_at, point_label")
    .eq("shop_id", shopId)
    .eq("is_display", true)
    .order("searched_at", { ascending: false })
    .limit(500);

  if (!logs || logs.length === 0) {
    return NextResponse.json({ alerts: [], message: "データなし" });
  }

  // キーワードごとにグループ化し、最新と前回を比較
  const groups = new Map<string, { latest: number; prev: number; latestDate: string }>();
  for (const log of logs) {
    let kw: string;
    try {
      const parsed = JSON.parse(log.search_words);
      kw = Array.isArray(parsed) ? parsed.join(", ") : String(log.search_words);
    } catch { kw = String(log.search_words); }

    if (!groups.has(kw)) {
      groups.set(kw, { latest: log.rank || 0, prev: 0, latestDate: log.searched_at });
    } else {
      const g = groups.get(kw)!;
      if (g.prev === 0) g.prev = log.rank || 0;
    }
  }

  const alerts: { keyword: string; latest: number; prev: number; change: number; type: "up" | "down"; date: string }[] = [];
  groups.forEach((data, kw) => {
    if (data.prev === 0) return;
    const change = data.latest - data.prev;
    // 5位以上の変動でアラート
    if (Math.abs(change) >= 5) {
      alerts.push({
        keyword: kw,
        latest: data.latest,
        prev: data.prev,
        change,
        type: change < 0 ? "up" : "down", // 順位は小さい方が良い
        date: data.latestDate,
      });
    }
  });

  alerts.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

  return NextResponse.json({ alerts, total: groups.size });
}
