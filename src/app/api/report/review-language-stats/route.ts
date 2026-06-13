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
 * POST /api/report/review-language-stats
 * body: { shopIds?: string[], shopNames?: string[] }
 * 指定店舗の口コミを言語別に集計
 */
export async function POST(request: NextRequest) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const shopIds: string[] = body.shopIds || [];
  const shopNames: string[] = body.shopNames || [];

  if (shopIds.length === 0 && shopNames.length === 0) {
    return NextResponse.json({ error: "shopIds または shopNames が必要です" }, { status: 400 });
  }

  const supabase = getSupabase();

  // shopNamesがあればshop_nameで検索、shopIdsがあればshop_idで検索
  let allReviews: any[] = [];
  const pageSize = 1000;

  const fetchByCol = async (col: string, values: string[]) => {
    for (let i = 0; i < values.length; i += 10) {
      const batch = values.slice(i, i + 10);
      let from = 0;
      while (from < 5000) {
        const { data, error } = await supabase
          .from("reviews")
          .select("shop_name, reviewer_name, star_rating, comment, create_time")
          .in(col, batch)
          .not("comment", "is", null)
          .neq("comment", "")
          .order("create_time", { ascending: false })
          .range(from, from + pageSize - 1);
        if (error) { console.error("[review-language-stats]", error.message); break; }
        if (!data || data.length === 0) break;
        allReviews.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
      }
    }
  };

  if (shopIds.length > 0) {
    await fetchByCol("shop_id", shopIds);
  }
  if (shopNames.length > 0) {
    await fetchByCol("shop_name", shopNames);
    // 完全一致で見つからなかった店舗はilike検索でフォールバック
    if (allReviews.length === 0) {
      for (const name of shopNames) {
        let from = 0;
        while (from < 5000) {
          const { data } = await supabase
            .from("reviews")
            .select("shop_name, reviewer_name, star_rating, comment, create_time")
            .ilike("shop_name", name)
            .not("comment", "is", null)
            .neq("comment", "")
            .order("create_time", { ascending: false })
            .range(from, from + pageSize - 1);
          if (!data || data.length === 0) break;
          allReviews.push(...data);
          if (data.length < pageSize) break;
          from += pageSize;
        }
      }
    }
  }

  // 言語判定 & 集計
  const langMap = new Map<string, LangStat>();
  const details: ReviewDetail[] = [];

  for (const r of allReviews) {
    try {
      const detected = detectLanguage(r.comment);
      const detLang = detected.lang;
      const detCountry = detected.country;
      const star = starToNum(r.star_rating);

      if (!langMap.has(detLang)) {
        langMap.set(detLang, { lang: detLang, country: detCountry, total: 0, star1: 0, star2: 0, star3: 0, star4: 0, star5: 0, lowRatingCount: 0 });
      }
      const stat = langMap.get(detLang)!;
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
          lang: detLang,
          country: detCountry,
          create_time: r.create_time,
        });
      }
    } catch (e) {
      console.error("[review-language-stats] detectLanguage error:", e, "comment:", (r.comment || "").slice(0, 50));
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
