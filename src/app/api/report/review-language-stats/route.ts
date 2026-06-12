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

  // shopNames → shop_idに変換（大文字小文字不一致対策）
  let resolvedIds: string[] = [...shopIds];
  if (shopNames.length > 0 && shopIds.length === 0) {
    for (let i = 0; i < shopNames.length; i += 30) {
      const batch = shopNames.slice(i, i + 30);
      // まず完全一致で検索
      const { data } = await supabase.from("reviews").select("shop_id, shop_name").in("shop_name", batch).limit(1000);
      if (data && data.length > 0) {
        const ids = Array.from(new Set(data.map((r: any) => r.shop_id)));
        resolvedIds.push(...ids);
      }
      // 完全一致で見つからなかった名前をilike検索
      const foundNames = new Set((data || []).map((r: any) => r.shop_name));
      const notFound = batch.filter(n => !foundNames.has(n));
      for (const name of notFound) {
        const { data: iData } = await supabase.from("reviews").select("shop_id").ilike("shop_name", name).limit(1);
        if (iData && iData.length > 0) resolvedIds.push(iData[0].shop_id);
      }
    }
    resolvedIds = Array.from(new Set(resolvedIds));
  }

  // 口コミを取得（常にshop_idで検索）
  let allReviews: any[] = [];
  const targets = resolvedIds;
  const col = "shop_id";
  const batchSize = 10;
  const debug: string[] = [];

  debug.push(`inputNames=${shopNames.length}, inputIds=${shopIds.length}, resolvedIds=${resolvedIds.length}, first3=${JSON.stringify(resolvedIds.slice(0, 3))}`);

  for (let i = 0; i < targets.length; i += batchSize) {
    const batch = targets.slice(i, i + batchSize);

    // ページネーション: 1バッチ最大5000件まで取得
    let from = 0;
    const pageSize = 1000;
    while (from < 5000) {
      const { data, error } = await supabase
        .from("reviews")
        .select("shop_name, reviewer_name, star_rating, comment, create_time")
        .in(col, batch)
        .not("comment", "is", null)
        .neq("comment", "")
        .order("create_time", { ascending: false })
        .range(from, from + pageSize - 1);
      if (error) { debug.push(`error: ${error.message}`); break; }
      if (!data || data.length === 0) break;
      allReviews.push(...data);
      if (data.length < pageSize) break; // 最終ページ
      from += pageSize;
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

  debug.push(`totalReviews=${allReviews.length}`);

  return NextResponse.json({
    totalReviews,
    totalLowRating,
    shopCount: new Set(allReviews.map(r => r.shop_name)).size,
    stats,
    details: details.sort((a, b) => a.star_rating - b.star_rating || a.create_time.localeCompare(b.create_time)),
    _debug: debug,
  });
}
