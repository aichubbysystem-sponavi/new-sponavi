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

  // 店舗検索: 同名の全IDを取得（重複店舗対応）
  const shopIds: string[] = [];
  const { data: exactShops } = await supabase
    .from("shops").select("id").eq("name", shopName);
  if (exactShops && exactShops.length > 0) {
    shopIds.push(...exactShops.map(s => s.id));
  } else {
    const simpleName = shopName.replace(/[【】\[\]（）()_\s]/g, "").toLowerCase();
    const { data: fuzzyShops } = await supabase
      .from("shops").select("id, name").ilike("name", `%${shopName.split(/[【（\[]/)[0].trim().slice(0, 10)}%`).limit(10);
    const matches = fuzzyShops?.filter(s => s.name.replace(/[【】\[\]（）()_\s]/g, "").toLowerCase() === simpleName) || [];
    shopIds.push(...matches.map(s => s.id));
  }

  if (shopIds.length === 0) {
    console.log(`[search-reviews] shop not found: "${shopName}"`);
    return NextResponse.json({ reviews: [], matched: false });
  }

  // キーワードを分割
  // 「メンズカット技術の不足」→ ["メンズ", "カット", "技術", "不足"]
  // 1. 括弧・助詞で分割
  const rawWords = keyword
    .replace(/[（(【\[）)】\]]/g, " ")
    .replace(/[なのがをはでにと・、。さ]/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 2);
  // 2. カタカナ⇔漢字の境界でさらに分割（漢字1文字もOK）
  const words: string[] = [];
  for (const w of rawWords) {
    const subTokens = w.match(/[\u30A0-\u30FF\uFF66-\uFF9F]+|[\u4E00-\u9FFF\u3400-\u4DBF]+|[\u3040-\u309F]+|[a-zA-Z0-9]+/g);
    if (subTokens) {
      for (const t of subTokens) {
        // 漢字は1文字OK、それ以外は2文字以上
        const isKanji = /^[\u4E00-\u9FFF\u3400-\u4DBF]+$/.test(t);
        if (isKanji || t.length >= 2) words.push(t);
      }
    } else if (w.length >= 2) {
      words.push(w);
    }
  }
  // 重複除去
  const uniqueWords = Array.from(new Set(words));

  // 直近1年の口コミからキーワード検索（同名重複店舗の全IDで検索）
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const oneYearAgoStr = oneYearAgo.toISOString();
  const { data: allReviews } = await supabase
    .from("reviews")
    .select("reviewer_name, star_rating, comment, reply_comment, create_time")
    .in("shop_id", shopIds)
    .not("comment", "is", null)
    .gte("create_time", oneYearAgoStr)
    .order("create_time", { ascending: false });

  if (!allReviews || allReviews.length === 0) {
    if (debug) return NextResponse.json({ reviews: [], matched: false, debug: { shopIds, reviewCount: 0, uniqueWords } });
    return NextResponse.json({ reviews: [], matched: false });
  }
  if (debug) {
    return NextResponse.json({ debug: { shopIds, reviewCount: allReviews.length, uniqueWords, sampleComment: allReviews[0]?.comment?.slice(0, 100) } });
  }

  // キーワードマッチ（直近1年）
  const matchReviews = (reviews: any[], filter: (text: string) => boolean, useRatingFilter: boolean) => {
    return reviews.filter((r: any) => {
      const text = r.comment || "";
      if (!filter(text)) return false;
      if (useRatingFilter && ratingFilter) {
        const rating = ((r.star_rating || "") as string).toUpperCase();
        return ratingFilter.has(rating);
      }
      return true;
    });
  };

  // 段階的に検索して結果をマージ（最大20件）
  const seen = new Set<string>();
  const allMatched: any[] = [];
  const addResults = (results: any[]) => {
    for (const r of results) {
      const key = r.comment || r.reviewer_name + r.create_time;
      if (!seen.has(key)) {
        seen.add(key);
        allMatched.push(r);
      }
    }
  };

  // 1. 元フレーズ全体で完全含有検索（最優先・星評価フィルタあり）
  addResults(matchReviews(allReviews, (text) => text.includes(keyword), true));

  // 2. 元フレーズ全体で完全含有検索（星評価フィルタなし — 逆評価でも原文含有なら表示）
  if (allMatched.length < 20) {
    addResults(matchReviews(allReviews, (text) => text.includes(keyword), false));
  }

  // 3. 分割ワードANDマッチ（星評価フィルタあり）
  if (allMatched.length < 20 && uniqueWords.length > 1) {
    addResults(matchReviews(allReviews, (text) => uniqueWords.every(w => text.includes(w)), true));
  }

  if (allMatched.length > 0) {
    return NextResponse.json({
      reviews: allMatched.sort((a, b) => (b.create_time || "").localeCompare(a.create_time || "")).slice(0, 20).map(formatReview),
      matched: true,
      matchedCount: allMatched.length,
    });
  }

  // 0件 → 空で返す（無関係な口コミは表示しない）
  return NextResponse.json({
    reviews: [],
    matched: false,
  });
}
