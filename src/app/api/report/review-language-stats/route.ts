import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { detectLanguage, starToNum } from "@/lib/detect-language";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
}

interface LangStat {
  lang: string;
  country: string;
  total: number;
  star1: number;
  star2: number;
  star3: number;
  star4: number;
  star5: number;
  lowRatingCount: number; // star1+star2+star3
}

interface ReviewDetail {
  shop_name: string;
  reviewer_name: string;
  star_rating: number;
  comment: string;
  lang: string;
  country: string;
  create_time: string;
}

/**
 * GET /api/report/review-language-stats?shopIds=id1,id2,...
 * 指定店舗の口コミを言語別に集計
 */
export async function GET(request: NextRequest) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const shopIds = request.nextUrl.searchParams.get("shopIds")?.split(",").filter(Boolean) || [];
  const shopNames = request.nextUrl.searchParams.get("shopNames")?.split(",").filter(Boolean) || [];

  if (shopIds.length === 0 && shopNames.length === 0) {
    return NextResponse.json({ error: "shopIds または shopNames が必要です" }, { status: 400 });
  }

  const supabase = getSupabase();

  // 口コミを取得（shopIdsまたはshopNamesで検索）
  let allReviews: any[] = [];
  const batchSize = 30;

  if (shopIds.length > 0) {
    for (let i = 0; i < shopIds.length; i += batchSize) {
      const batch = shopIds.slice(i, i + batchSize);
      const { data } = await supabase
        .from("reviews")
        .select("shop_name, reviewer_name, star_rating, comment, create_time")
        .in("shop_id", batch)
        .not("comment", "is", null)
        .order("create_time", { ascending: false });
      if (data) allReviews.push(...data);
    }
  } else {
    for (let i = 0; i < shopNames.length; i += batchSize) {
      const batch = shopNames.slice(i, i + batchSize);
      const { data } = await supabase
        .from("reviews")
        .select("shop_name, reviewer_name, star_rating, comment, create_time")
        .in("shop_name", batch)
        .not("comment", "is", null)
        .order("create_time", { ascending: false });
      if (data) allReviews.push(...data);
    }
  }

  // 言語判定 & 集計
  const langMap = new Map<string, LangStat>();
  const details: ReviewDetail[] = [];

  for (const r of allReviews) {
    const { lang, country } = detectLanguage(r.comment);
    const star = starToNum(r.star_rating);

    if (!langMap.has(lang)) {
      langMap.set(lang, { lang, country, total: 0, star1: 0, star2: 0, star3: 0, star4: 0, star5: 0, lowRatingCount: 0 });
    }
    const stat = langMap.get(lang)!;
    stat.total++;
    if (star === 1) stat.star1++;
    else if (star === 2) stat.star2++;
    else if (star === 3) stat.star3++;
    else if (star === 4) stat.star4++;
    else if (star === 5) stat.star5++;
    if (star >= 1 && star <= 3) stat.lowRatingCount++;

    // 星3以下の詳細を保持
    if (star >= 1 && star <= 3) {
      details.push({
        shop_name: r.shop_name,
        reviewer_name: r.reviewer_name || "匿名",
        star_rating: star,
        comment: r.comment || "",
        lang,
        country,
        create_time: r.create_time,
      });
    }
  }

  // ソート: total降順
  const stats = Array.from(langMap.values()).sort((a, b) => b.total - a.total);
  const totalReviews = allReviews.length;
  const totalLowRating = stats.reduce((s, st) => s + st.lowRatingCount, 0);

  return NextResponse.json({
    totalReviews,
    totalLowRating,
    shopCount: new Set(allReviews.map(r => r.shop_name)).size,
    stats,
    details: details.sort((a, b) => a.star_rating - b.star_rating || a.create_time.localeCompare(b.create_time)),
  });
}
