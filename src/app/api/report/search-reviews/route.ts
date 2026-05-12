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

  // キーワードを分割
  // 「施術の不正確さ（長さ・仕上がり）」→ ["施術", "不正確", "長さ", "仕上がり"]
  const words = keyword
    .replace(/[（(【\[]/g, " ").replace(/[）)】\]]/g, " ")
    .replace(/[なのがをはでにとい・、。さ]/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 2);

  // 全期間の口コミからキーワード検索（関連する口コミだけを正確に返す）
  const { data: allReviews } = await supabase
    .from("reviews")
    .select("reviewer_name, star_rating, comment, reply_comment, create_time")
    .eq("shop_id", shopId)
    .not("comment", "is", null)
    .order("create_time", { ascending: false });

  if (!allReviews || allReviews.length === 0) {
    return NextResponse.json({ reviews: [], matched: false });
  }

  // キーワードマッチ（全期間）
  const matched = allReviews.filter((r: any) => {
    const text = r.comment || "";
    return words.some(w => text.includes(w));
  });

  if (matched.length > 0) {
    return NextResponse.json({
      reviews: matched.slice(0, 20).map(formatReview),
      matched: true,
      matchedCount: matched.length,
    });
  }

  // 完全に0件 → 直近の口コミ10件（分析対象の参考として）
  return NextResponse.json({
    reviews: allReviews.slice(0, 10).map(formatReview),
    matched: false,
  });
}
