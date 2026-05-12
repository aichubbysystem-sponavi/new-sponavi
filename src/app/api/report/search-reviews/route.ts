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

  // 店舗検索: 完全一致 → 部分一致
  let shopId: string | null = null;
  const { data: exactShop } = await supabase
    .from("shops").select("id").eq("name", shopName).maybeSingle();
  if (exactShop) {
    shopId = exactShop.id;
  } else {
    const simpleName = shopName.replace(/[【】\[\]（）()_\s]/g, "").toLowerCase();
    const { data: fuzzyShops } = await supabase
      .from("shops").select("id, name").ilike("name", `%${shopName.split(/[【（\[]/)[0].trim().slice(0, 10)}%`).limit(10);
    const match = fuzzyShops?.find(s => s.name.replace(/[【】\[\]（）()_\s]/g, "").toLowerCase() === simpleName);
    if (match) shopId = match.id;
  }

  if (!shopId) {
    console.log(`[search-reviews] shop not found: "${shopName}"`);
    return NextResponse.json({ reviews: [], matched: false });
  }

  // 直近2ヶ月の口コミを取得（コメントありのみ）
  const twoMonthsAgo = new Date();
  twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
  twoMonthsAgo.setDate(1);

  const { data: reviews } = await supabase
    .from("reviews")
    .select("reviewer_name, star_rating, comment, reply_comment, create_time")
    .eq("shop_id", shopId)
    .gte("create_time", twoMonthsAgo.toISOString())
    .not("comment", "is", null)
    .order("create_time", { ascending: false });

  if (!reviews || reviews.length === 0) {
    // 2ヶ月で0件なら全期間から最新20件
    const { data: allReviews } = await supabase
      .from("reviews")
      .select("reviewer_name, star_rating, comment, reply_comment, create_time")
      .eq("shop_id", shopId)
      .not("comment", "is", null)
      .order("create_time", { ascending: false })
      .limit(20);
    return NextResponse.json({
      reviews: (allReviews || []).map(formatReview),
      matched: false,
    });
  }

  // キーワードを分割して部分一致検索
  // 「施術の不正確さ（長さ・仕上がり）」→ ["施術", "不正確", "長さ", "仕上がり"]
  const words = keyword
    .replace(/[（(【\[]/g, " ").replace(/[）)】\]]/g, " ")
    .replace(/[なのがをはでにとい・、。]/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 2);

  const matched = reviews.filter((r: any) => {
    const text = r.comment || "";
    return words.some(w => text.includes(w));
  });

  if (matched.length > 0) {
    return NextResponse.json({ reviews: matched.map(formatReview), matched: true });
  }

  // ヒット0件 → 直近2ヶ月の全口コミを返す
  return NextResponse.json({
    reviews: reviews.filter((r: any) => r.comment?.trim()).slice(0, 20).map(formatReview),
    matched: false,
  });
}
