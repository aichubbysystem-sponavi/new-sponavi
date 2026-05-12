/**
 * GET /api/report/search-reviews?shop=店舗名&keyword=ワード
 * 指定店舗の直近2ヶ月の口コミからキーワード関連のものを検索
 * 部分一致 → ヒット0件なら全件返却
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

function formatReview(r: any) {
  const comment = r.comment || "";
  const displayComment = comment.includes("(Original)")
    ? (comment.split("(Original)").pop()?.trim() || comment)
    : comment.split(/\s*\(Translated by Google\)\s*/)[0] || comment;
  return {
    reviewer: r.reviewer_name || "匿名",
    comment: displayComment,
    reply: r.reply_comment || null,
    date: r.create_time?.slice(0, 10) || "不明",
    starRating: (r.star_rating || "").toUpperCase().replace(/_STARS?/, ""),
  };
}

export async function GET(request: NextRequest) {
  const shopName = request.nextUrl.searchParams.get("shop") || "";
  const keyword = request.nextUrl.searchParams.get("keyword") || "";

  if (!shopName || !keyword) {
    return NextResponse.json({ reviews: [], matched: false });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const { data: shop } = await supabase
    .from("shops")
    .select("id")
    .eq("name", shopName)
    .maybeSingle();

  if (!shop) {
    return NextResponse.json({ reviews: [], matched: false });
  }

  const twoMonthsAgo = new Date();
  twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
  twoMonthsAgo.setDate(1);

  const { data: reviews } = await supabase
    .from("reviews")
    .select("reviewer_name, star_rating, comment, reply_comment, create_time")
    .eq("shop_id", shop.id)
    .gte("create_time", twoMonthsAgo.toISOString())
    .order("create_time", { ascending: false });

  if (!reviews || reviews.length === 0) {
    return NextResponse.json({ reviews: [], matched: false });
  }

  // キーワードの各単語で部分一致検索（「雑なシャンプー」→「シャンプー」でもヒット）
  const words = keyword.replace(/[なのがをはでにと、。]/g, " ").split(/\s+/).filter(w => w.length >= 2);
  const matched = reviews.filter((r: any) => {
    const text = r.comment || "";
    return words.some(w => text.includes(w));
  });

  if (matched.length > 0) {
    return NextResponse.json({ reviews: matched.map(formatReview), matched: true });
  }

  // ヒット0件 → 分析対象の全口コミを返す
  return NextResponse.json({
    reviews: reviews.filter((r: any) => r.comment?.trim()).slice(0, 20).map(formatReview),
    matched: false,
  });
}
