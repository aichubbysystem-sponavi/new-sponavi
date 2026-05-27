import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5555";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

// Service role client（RLSバイパス、サーバーサイド書き込み用）
function getSupabaseAdmin() {
  const key = SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY;
  return createClient(SUPABASE_URL, key);
}

interface GBPReview {
  reviewId: string;
  reviewer: { displayName: string };
  starRating: string;
  comment: string;
  createTime: string;
}

interface ReviewListResponse {
  reviews: GBPReview[];
  averageRating: number;
  totalReviewCount: number;
}

// Supabase DBから口コミ取得（Go API不要）- 直近2ヶ月のみ
async function fetchReviews(shopId: string): Promise<ReviewListResponse | null> {
  try {
    const supabase = getSupabaseAdmin();
    // 直近2ヶ月の口コミのみ取得
    const twoMonthsAgo = new Date();
    twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
    twoMonthsAgo.setDate(1);
    twoMonthsAgo.setHours(0, 0, 0, 0);

    const { data: reviews, count } = await supabase
      .from("reviews")
      .select("review_id, reviewer_name, star_rating, comment, create_time", { count: "exact" })
      .eq("shop_id", shopId)
      .gte("create_time", twoMonthsAgo.toISOString())
      .order("create_time", { ascending: false })
      .limit(50);

    if (!reviews || reviews.length === 0) return null;

    // 平均評価を算出
    const ratingMap: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, ONE_STAR: 1, TWO_STARS: 2, THREE_STARS: 3, FOUR_STARS: 4, FIVE_STARS: 5 };
    const ratings = reviews.map((r: any) => ratingMap[(r.star_rating || "").toUpperCase()] || 0).filter((r: number) => r > 0);
    const avgRating = ratings.length > 0 ? Math.round((ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length) * 10) / 10 : 0;

    return {
      reviews: reviews.map((r: any) => {
        const comment = r.comment || "";
        const displayComment = comment.includes("(Original)")
          ? (comment.split("(Original)").pop()?.trim() || comment)
          : comment.split(/\s*\(Translated by Google\)\s*/)[0] || comment;
        return {
          reviewId: r.review_id,
          reviewer: { displayName: r.reviewer_name || "匿名" },
          starRating: (r.star_rating || "").toUpperCase().replace(/_STARS?/, ""),
          comment: displayComment,
          createTime: r.create_time,
        };
      }),
      averageRating: avgRating,
      totalReviewCount: count || reviews.length,
    };
  } catch {
    return null;
  }
}

// Claude APIで分析
async function analyzeWithClaude(
  shopName: string,
  reviews: GBPReview[],
  averageRating: number,
  totalReviewCount: number
): Promise<{
  positiveWords: string[];
  negativeWords: string[];
  positiveWordSources: { word: string; reviews: { reviewer: string; comment: string; date: string; starRating: string }[] }[];
  negativeWordSources: { word: string; reviews: { reviewer: string; comment: string; date: string; starRating: string }[] }[];
  summary: string;
  comments: string[];
} | null> {
  if (!ANTHROPIC_API_KEY) return null;

  const filteredReviews = reviews
    .filter((r) => r.comment && r.comment.trim())
    .slice(0, 50);

  const reviewTexts = filteredReviews
    .map((r, i) => `[#${i + 1}][${r.starRating}][${r.reviewer.displayName}][${r.createTime?.slice(0, 10) || "不明"}] ${r.comment}`)
    .join("\n");

  if (!reviewTexts) return null;

  const prompt = `あなたはMEO対策の専門家です。以下の店舗の直近2ヶ月の口コミを分析し、JSON形式で結果を返してください。

店舗名: ${shopName}
評価: ${averageRating} / 5.0（${totalReviewCount}件）

【口コミテキスト（直近2ヶ月）】
${reviewTexts}

【重要ルール】
- positiveWords・negativeWordsは、必ず口コミ原文に含まれる表現をそのまま抜き出してください。
- 要約・言い換え・意訳は禁止です。口コミテキスト内に実際に書かれているフレーズのみを使用してください。
- 例: 口コミに「スープが熱々で美味しかった」→ ○「スープが熱々」 ✕「温かいスープ」
- 各ワードは2〜8文字程度の短いフレーズにしてください。
- positiveWordsは★4-5の口コミから、negativeWordsは★1-3の口コミから抽出してください。

【出力形式】以下のJSON形式のみ出力してください。
{
  "positiveWords": ["ポジティブワード1", "ポジティブワード2", "ポジティブワード3", "ポジティブワード4", "ポジティブワード5", "ポジティブワード6"],
  "negativeWords": ["ネガティブワード1", "ネガティブワード2", "ネガティブワード3"],
  "positiveWordSources": [
    {
      "word": "ポジティブワード1",
      "reviewNumbers": [1, 2, 5]
    }
  ],
  "negativeWordSources": [
    {
      "word": "ネガティブワード1",
      "reviewNumbers": [3, 7]
    }
  ],
  "summary": "口コミ総評（3行程度。評価の傾向、特筆すべき点、改善点を含む）",
  "comments": [
    "担当者コメント1（数値データに基づく分析。strongタグで強調箇所を囲む）",
    "担当者コメント2",
    "担当者コメント3",
    "担当者コメント4",
    "担当者コメント5（来月の施策提案）"
  ]
}

positiveWordSources・negativeWordSourcesの各reviewNumbersは、口コミテキストの[#番号]に対応する番号の配列です。そのワードが含まれる・該当する口コミの番号を全て列挙してください。`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000); // 45秒タイムアウト
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    clearTimeout(timeout);

    if (!res.ok) {
      console.error("[analyze] Claude API error:", res.status, res.statusText);
      return null;
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      // reviewNumbersを実際の口コミデータに変換（共通ヘルパー）
      const convertSources = (sources: any[]) =>
        sources.map((src: any) => ({
          word: src.word,
          reviews: (src.reviewNumbers || [])
            .map((num: number) => {
              const r = filteredReviews[num - 1];
              if (!r) return null;
              return {
                reviewer: r.reviewer.displayName,
                comment: r.comment,
                date: r.createTime?.slice(0, 10) || "不明",
                starRating: r.starRating,
              };
            })
            .filter(Boolean),
        }));

      parsed.positiveWordSources = Array.isArray(parsed.positiveWordSources)
        ? convertSources(parsed.positiveWordSources) : [];
      parsed.negativeWordSources = Array.isArray(parsed.negativeWordSources)
        ? convertSources(parsed.negativeWordSources) : [];
      return parsed;
    } catch { return null; }
  } catch (err) {
    console.error("[analyze] Claude error:", err);
    return null;
  }
}

// POST /api/report/analyze
export async function POST(request: NextRequest) {
  // 認証チェック（JWT署名検証）
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  // リクエスト解析
  const body = await request.json();
  const shopIds: { id: string; name: string }[] = body.shops || [];
  const forceReanalyze: boolean = body.force || false;

  if (shopIds.length === 0) {
    return NextResponse.json({ error: "店舗が指定されていません" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const results: { shopId: string; shopName: string; status: string }[] = [];

  // 今月分析済み店舗を取得（スキップ用）
  const thisMonthStart = new Date();
  thisMonthStart.setDate(1);
  thisMonthStart.setHours(0, 0, 0, 0);
  const { data: existingAnalysis } = await supabase
    .from("report_analysis")
    .select("shop_name, analyzed_at")
    .gte("analyzed_at", thisMonthStart.toISOString());
  const analyzedNames = new Set((existingAnalysis || []).map((a: any) => a.shop_name));

  // 各店舗を逐次処理
  for (const shop of shopIds) {
    // 分析済みならスキップ（forceの場合は再分析）
    if (!forceReanalyze && analyzedNames.has(shop.name)) {
      results.push({ shopId: shop.id, shopName: shop.name, status: "already_done" });
      continue;
    }

    try {
      const reviewData = await fetchReviews(shop.id);
      if (!reviewData || !reviewData.reviews || reviewData.reviews.length === 0) {
        results.push({ shopId: shop.id, shopName: shop.name, status: "no_reviews" });
        continue;
      }

      // Claude APIで分析
      const analysis = await analyzeWithClaude(
        shop.name,
        reviewData.reviews,
        reviewData.averageRating,
        reviewData.totalReviewCount
      );

      if (!analysis) {
        results.push({ shopId: shop.id, shopName: shop.name, status: "analysis_failed" });
        continue;
      }

      // Supabaseに保存（upsert）
      const { error } = await supabase
        .from("report_analysis")
        .upsert(
          {
            shop_name: shop.name,
            shop_id: shop.id,
            positive_words: analysis.positiveWords,
            negative_words: analysis.negativeWords,
            positive_word_sources: analysis.positiveWordSources || [],
            negative_word_sources: analysis.negativeWordSources || [],
            summary: analysis.summary,
            comments: analysis.comments,
            review_count: reviewData.totalReviewCount,
            average_rating: reviewData.averageRating,
            analyzed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "shop_name" }
        );

      if (error) {
        console.error("[analyze] Supabase error:", error);
        results.push({ shopId: shop.id, shopName: shop.name, status: "db_error" });
      } else {
        results.push({ shopId: shop.id, shopName: shop.name, status: "success" });
      }
    } catch (err) {
      console.error("[analyze] Error for shop:", shop.name, err);
      results.push({ shopId: shop.id, shopName: shop.name, status: "error" });
    }
  }

  const successCount = results.filter((r) => r.status === "success").length;

  return NextResponse.json({
    success: true,
    total: shopIds.length,
    analyzed: successCount,
    results,
  });
}
