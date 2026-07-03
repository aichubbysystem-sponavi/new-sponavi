import { NextRequest, NextResponse } from "next/server";
import { getSupabase, verifyAuth, verifyShopAccess } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/report/dashboard-data?shopId=<IDまたは店舗名>
 * 顧客ダッシュボードのデータを認証付きで返す。
 * 以前は dashboard/[shopId]/page.tsx がanonキーで未認証取得しHTMLに埋め込んでいた。
 */
export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid || !auth.sub) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const shopIdParam = request.nextUrl.searchParams.get("shopId");
  if (!shopIdParam) return NextResponse.json({ error: "shopIdが必要です" }, { status: 400 });
  const shopId = decodeURIComponent(shopIdParam);

  const supabase = getSupabase();

  // 店舗情報取得（IDまたは名前で検索）
  let shop: any = null;
  const { data: byId } = await supabase.from("shops").select("*").eq("id", shopId).maybeSingle();
  if (byId) { shop = byId; }
  else {
    const { data: byName } = await supabase.from("shops").select("*").ilike("name", `%${shopId}%`).limit(1).maybeSingle();
    shop = byName;
  }

  if (!shop) return NextResponse.json({ error: "店舗が見つかりませんでした" }, { status: 404 });

  // 店舗アクセス権チェック
  if (!(await verifyShopAccess(auth.sub, shop.name))) {
    return NextResponse.json({ error: "この店舗へのアクセス権がありません" }, { status: 403 });
  }

  // 口コミ統計（shop_nameで検索 — reviews.shop_idはGo API IDでSupabase shops.idとは異なる）
  const shopName = shop.name;
  const { count: totalReviews } = await supabase
    .from("reviews").select("id", { count: "exact", head: true }).eq("shop_name", shopName);
  const { count: unrepliedCount } = await supabase
    .from("reviews").select("id", { count: "exact", head: true }).eq("shop_name", shopName).is("reply_comment", null);

  // 最新口コミ5件
  const { data: recentReviews } = await supabase
    .from("reviews").select("reviewer_name, star_rating, comment, reply_comment, create_time")
    .eq("shop_name", shopName).order("create_time", { ascending: false }).limit(5);

  // 月別口コミ統計
  const { data: allReviews } = await supabase
    .from("reviews").select("create_time, star_rating").eq("shop_name", shopName).order("create_time", { ascending: true }).limit(3000);

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

  // 順位データ（ranking_search_logsはshop_idカラムのみ — shop.idで検索）
  const { data: rankingData } = await supabase
    .from("ranking_search_logs").select("search_words, rank, searched_at")
    .eq("shop_id", shop.id).eq("is_display", true)
    .order("searched_at", { ascending: false }).limit(30);

  // AI分析結果
  const { data: analysis } = await supabase
    .from("report_analysis").select("positive_words, negative_words, summary")
    .eq("shop_name", shopName).order("created_at", { ascending: false }).limit(1).maybeSingle();

  const avgRating = allReviews && allReviews.length > 0
    ? Math.round((allReviews.reduce((s, r) => s + (ratingMap[(r.star_rating || "").toUpperCase().replace(/_STARS?/, "")] || 0), 0) / allReviews.length) * 100) / 100
    : 0;

  return NextResponse.json({
    shop,
    totalReviews: totalReviews || 0,
    unrepliedCount: unrepliedCount || 0,
    avgRating,
    recentReviews: recentReviews || [],
    monthlyStats: monthlyStats.slice(-12),
    rankingData: rankingData || [],
    analysis,
  });
}
