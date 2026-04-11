import { createClient } from "@supabase/supabase-js";
import DashboardClient from "./client";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export default async function CustomerDashboardPage({ params }: { params: { shopId: string } }) {
  const shopId = decodeURIComponent(params.shopId);
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // 店舗情報取得（IDまたは名前で検索）
  let shop: any = null;
  const { data: byId } = await supabase.from("shops").select("*").eq("id", shopId).maybeSingle();
  if (byId) { shop = byId; }
  else {
    const { data: byName } = await supabase.from("shops").select("*").ilike("name", `%${shopId}%`).limit(1).maybeSingle();
    shop = byName;
  }

  if (!shop) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-2xl p-8 shadow-lg text-center">
          <p className="text-gray-500">店舗が見つかりませんでした</p>
        </div>
      </div>
    );
  }

  // 口コミ統計
  const { count: totalReviews } = await supabase
    .from("reviews").select("id", { count: "exact", head: true }).eq("shop_id", shop.id);
  const { count: unrepliedCount } = await supabase
    .from("reviews").select("id", { count: "exact", head: true }).eq("shop_id", shop.id).is("reply_comment", null);

  // 最新口コミ5件
  const { data: recentReviews } = await supabase
    .from("reviews").select("reviewer_name, star_rating, comment, reply_comment, create_time")
    .eq("shop_id", shop.id).order("create_time", { ascending: false }).limit(5);

  // 月別口コミ統計
  const { data: allReviews } = await supabase
    .from("reviews").select("create_time, star_rating").eq("shop_id", shop.id).order("create_time", { ascending: true }).limit(3000);

  const ratingMap: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, ONE_STAR: 1, TWO_STARS: 2, THREE_STARS: 3, FOUR_STARS: 4, FIVE_STARS: 5 };
  const monthlyStats: { month: string; count: number; avgRating: number }[] = [];
  if (allReviews) {
    const byMonth = new Map<string, { count: number; total: number }>();
    allReviews.forEach((r) => {
      if (!r.create_time) return;
      const m = r.create_time.slice(0, 7);
      if (!byMonth.has(m)) byMonth.set(m, { count: 0, total: 0 });
      const d = byMonth.get(m)!;
      d.count++;
      d.total += ratingMap[(r.star_rating || "").toUpperCase().replace(/_STARS?/, "")] || 0;
    });
    byMonth.forEach((d, m) => monthlyStats.push({ month: m.slice(2), count: d.count, avgRating: Math.round((d.total / d.count) * 100) / 100 }));
    monthlyStats.sort((a, b) => a.month.localeCompare(b.month));
  }

  // 順位データ
  const { data: rankingData } = await supabase
    .from("ranking_search_logs").select("search_words, rank, searched_at")
    .eq("shop_id", shop.id).eq("is_display", true)
    .order("searched_at", { ascending: false }).limit(30);

  // AI分析結果
  const { data: analysis } = await supabase
    .from("report_analysis").select("positive_words, negative_words, summary")
    .eq("shop_id", shop.id).order("created_at", { ascending: false }).limit(1).maybeSingle();

  const avgRating = allReviews && allReviews.length > 0
    ? Math.round((allReviews.reduce((s, r) => s + (ratingMap[(r.star_rating || "").toUpperCase().replace(/_STARS?/, "")] || 0), 0) / allReviews.length) * 100) / 100
    : 0;

  return (
    <DashboardClient
      shop={shop}
      totalReviews={totalReviews || 0}
      unrepliedCount={unrepliedCount || 0}
      avgRating={avgRating}
      recentReviews={recentReviews || []}
      monthlyStats={monthlyStats.slice(-12)}
      rankingData={rankingData || []}
      analysis={analysis}
    />
  );
}
