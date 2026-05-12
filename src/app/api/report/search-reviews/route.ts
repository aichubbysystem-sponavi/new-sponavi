/**
 * GET /api/report/search-reviews?shop=店舗名&keyword=ワード
 * 指定店舗の直近2ヶ月の口コミからキーワードを含むものを検索
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export async function GET(request: NextRequest) {
  const shopName = request.nextUrl.searchParams.get("shop") || "";
  const keyword = request.nextUrl.searchParams.get("keyword") || "";

  if (!shopName || !keyword) {
    return NextResponse.json({ reviews: [] });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // 店舗IDを取得
  const { data: shop } = await supabase
    .from("shops")
    .select("id")
    .eq("name", shopName)
    .maybeSingle();

  if (!shop) {
    return NextResponse.json({ reviews: [] });
  }

  // 直近2ヶ月の口コミを取得
  const twoMonthsAgo = new Date();
  twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
  twoMonthsAgo.setDate(1);

  const { data: reviews } = await supabase
    .from("reviews")
    .select("reviewer_name, star_rating, comment, create_time")
    .eq("shop_id", shop.id)
    .gte("create_time", twoMonthsAgo.toISOString())
    .order("create_time", { ascending: false });

  if (!reviews) {
    return NextResponse.json({ reviews: [] });
  }

  // キーワードを含む口コミをフィルタ
  const matched = reviews
    .filter((r: any) => r.comment && r.comment.includes(keyword))
    .map((r: any) => {
      const comment = r.comment || "";
      const displayComment = comment.includes("(Original)")
        ? (comment.split("(Original)").pop()?.trim() || comment)
        : comment.split(/\s*\(Translated by Google\)\s*/)[0] || comment;
      return {
        reviewer: r.reviewer_name || "匿名",
        comment: displayComment,
        date: r.create_time?.slice(0, 10) || "不明",
        starRating: (r.star_rating || "").toUpperCase().replace(/_STARS?/, ""),
      };
    });

  return NextResponse.json({ reviews: matched });
}
