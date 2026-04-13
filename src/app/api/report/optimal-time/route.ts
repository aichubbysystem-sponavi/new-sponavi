import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

/**
 * GET /api/report/optimal-time?shopId=xxx
 * 最適投稿時間帯分析: 口コミ投稿時間帯から来店パターンを推定
 */
export async function GET(request: NextRequest) {
  const shopId = request.nextUrl.searchParams.get("shopId");
  if (!shopId) return NextResponse.json({ error: "shopIdが必要です" }, { status: 400 });

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // 口コミの投稿時間帯を分析（口コミの時間=来店後数時間のパターン）
  const { data: reviews } = await supabase
    .from("reviews")
    .select("create_time")
    .eq("shop_id", shopId)
    .not("create_time", "is", null)
    .limit(500);

  if (!reviews || reviews.length === 0) {
    return NextResponse.json({ optimal: null, message: "口コミデータ不足" });
  }

  // 曜日×時間帯の分布を計算
  const dayHour = Array.from({ length: 7 }, () => Array(24).fill(0));
  const dayNames = ["日", "月", "火", "水", "木", "金", "土"];

  reviews.forEach(r => {
    const d = new Date(r.create_time);
    const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000); // UTC→JST
    dayHour[jst.getUTCDay()][jst.getUTCHours()]++;
  });

  // 最もアクティブな曜日×時間帯TOP5
  const slots: { day: string; hour: number; count: number }[] = [];
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      if (dayHour[d][h] > 0) {
        slots.push({ day: dayNames[d], hour: h, count: dayHour[d][h] });
      }
    }
  }
  slots.sort((a, b) => b.count - a.count);

  // 投稿推奨: 来店時間の2-3時間前がベスト
  const bestSlots = slots.slice(0, 5).map(s => ({
    ...s,
    recommended: `${s.day} ${Math.max(0, s.hour - 3)}:00〜${Math.max(0, s.hour - 1)}:00`,
  }));

  // 曜日別の活性度
  const dayActivity = dayNames.map((name, i) => ({
    day: name,
    total: dayHour[i].reduce((s: number, v: number) => s + v, 0),
  }));

  return NextResponse.json({
    bestSlots,
    dayActivity,
    totalReviews: reviews.length,
    recommendation: bestSlots.length > 0
      ? `${bestSlots[0].day}曜日の${Math.max(0, bestSlots[0].hour - 3)}時〜${Math.max(0, bestSlots[0].hour - 1)}時の投稿が最も効果的です`
      : "データ不足で分析できません",
  });
}
