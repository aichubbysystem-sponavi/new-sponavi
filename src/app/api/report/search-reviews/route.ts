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
  const type = request.nextUrl.searchParams.get("type") || ""; // "positive" or "negative"

  const debug = request.nextUrl.searchParams.get("debug") === "1";

  if (!shopName || !keyword) {
    return NextResponse.json({ reviews: [], matched: false });
  }

  // 星評価フィルタ: ネガティブ→★1-3、ポジティブ→★4-5
  const negativeRatings = new Set(["ONE", "TWO", "THREE", "ONE_STAR", "TWO_STARS", "THREE_STARS"]);
  const positiveRatings = new Set(["FOUR", "FIVE", "FOUR_STARS", "FIVE_STARS"]);
  const ratingFilter = type === "negative" ? negativeRatings : type === "positive" ? positiveRatings : null;

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
    if (debug) {
      const { data: fuzzySearch } = await supabase.from("shops").select("id, name").ilike("name", "%よし乃%").limit(5);
      const { data: allShops, count: totalCount } = await supabase.from("shops").select("id, name", { count: "exact" }).limit(5);
      return NextResponse.json({ reviews: [], matched: false, debug: { shopNotFound: shopName, shopNameLength: shopName.length, hasServiceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY, totalShops: totalCount, fuzzyYoshino: fuzzySearch, firstShops: allShops?.map(s => s.name) } });
    }
    return NextResponse.json({ reviews: [], matched: false });
  }

  // キーワードを分割
  // 「メンズカット技術の不足」→ ["メンズ", "カット", "技術", "不足"]
  // 1. 括弧・助詞で分割
  const rawWords = keyword
    .replace(/[（(【\[）)】\]]/g, " ")
    .replace(/[なのがをはでにとい・、。さ]/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 2);
  // 2. カタカナ⇔漢字の境界でさらに分割
  const words: string[] = [];
  for (const w of rawWords) {
    const subTokens = w.match(/[\u30A0-\u30FF\uFF66-\uFF9F]+|[\u4E00-\u9FFF\u3400-\u4DBF]+|[\u3040-\u309F]+|[a-zA-Z0-9]+/g);
    if (subTokens) {
      for (const t of subTokens) {
        if (t.length >= 2) words.push(t);
      }
    } else if (w.length >= 2) {
      words.push(w);
    }
  }
  // 重複除去
  const uniqueWords = Array.from(new Set(words));

  // 全期間の口コミからキーワード検索（関連する口コミだけを正確に返す）
  const { data: allReviews } = await supabase
    .from("reviews")
    .select("reviewer_name, star_rating, comment, reply_comment, create_time")
    .eq("shop_id", shopId)
    .not("comment", "is", null)
    .order("create_time", { ascending: false });

  if (!allReviews || allReviews.length === 0) {
    if (debug) return NextResponse.json({ reviews: [], matched: false, debug: { shopId, reviewCount: 0, uniqueWords } });
    return NextResponse.json({ reviews: [], matched: false });
  }
  if (debug) {
    return NextResponse.json({ debug: { shopId, reviewCount: allReviews.length, uniqueWords, sampleComment: allReviews[0]?.comment?.slice(0, 100) } });
  }

  // キーワードマッチ + 星評価フィルタ（全期間）
  const matched = allReviews.filter((r: any) => {
    const text = r.comment || "";
    const hasKeyword = uniqueWords.some(w => text.includes(w));
    if (!hasKeyword) return false;
    // 星評価フィルタ（ネガティブワード→低評価のみ、ポジティブ→高評価のみ）
    if (ratingFilter) {
      const rating = ((r.star_rating || "") as string).toUpperCase();
      return ratingFilter.has(rating);
    }
    return true;
  });

  if (matched.length > 0) {
    return NextResponse.json({
      reviews: matched.slice(0, 20).map(formatReview),
      matched: true,
      matchedCount: matched.length,
    });
  }

  // 星評価フィルタなしでキーワードマッチを再試行（フィルタ厳しすぎた場合）
  const keywordOnly = allReviews.filter((r: any) => {
    const text = r.comment || "";
    return uniqueWords.some(w => text.includes(w));
  });

  if (keywordOnly.length > 0) {
    return NextResponse.json({
      reviews: keywordOnly.slice(0, 20).map(formatReview),
      matched: true,
      matchedCount: keywordOnly.length,
    });
  }

  // 完全に0件 → 同じ評価帯の口コミ10件を参考表示
  const fallback = ratingFilter
    ? allReviews.filter((r: any) => ratingFilter.has(((r.star_rating || "") as string).toUpperCase()))
    : allReviews;
  return NextResponse.json({
    reviews: fallback.slice(0, 10).map(formatReview),
    matched: false,
  });
}
