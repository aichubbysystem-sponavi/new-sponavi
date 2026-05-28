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
  ratingDistribution: Record<number, number>;
}

// Supabase DBから口コミ取得（Go API不要）- 直近1年
async function fetchReviews(shopId: string): Promise<ReviewListResponse | null> {
  try {
    const supabase = getSupabaseAdmin();
    // 直近1年の口コミを取得
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    oneYearAgo.setDate(1);
    oneYearAgo.setHours(0, 0, 0, 0);

    const { data: reviews, count } = await supabase
      .from("reviews")
      .select("review_id, reviewer_name, star_rating, comment, create_time", { count: "exact" })
      .eq("shop_id", shopId)
      .gte("create_time", oneYearAgo.toISOString())
      .not("comment", "is", null)
      .order("create_time", { ascending: false });

    if (!reviews || reviews.length === 0) return null;

    // 評価別集計
    const ratingMap: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, ONE_STAR: 1, TWO_STARS: 2, THREE_STARS: 3, FOUR_STARS: 4, FIVE_STARS: 5 };
    const ratings = reviews.map((r: any) => ratingMap[(r.star_rating || "").toUpperCase()] || 0).filter((r: number) => r > 0);
    const avgRating = ratings.length > 0 ? Math.round((ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length) * 10) / 10 : 0;
    const ratingDist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of ratings) ratingDist[r] = (ratingDist[r] || 0) + 1;

    return {
      ratingDistribution: ratingDist,
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

// Claude APIで分析（リトライ付き: 失敗時は件数を半分に減らして再試行）
async function analyzeWithClaude(
  shopName: string,
  reviews: GBPReview[],
  averageRating: number,
  totalReviewCount: number,
  ratingDistribution?: Record<number, number>
): Promise<{
  positiveWords: string[];
  negativeWords: string[];
  positiveWordSources: { word: string; reviews: { reviewer: string; comment: string; date: string; starRating: string }[] }[];
  negativeWordSources: { word: string; reviews: { reviewer: string; comment: string; date: string; starRating: string }[] }[];
  summary: string;
  comments: string[];
} | null> {
  if (!ANTHROPIC_API_KEY) return null;

  const allFiltered = reviews.filter((r) => r.comment && r.comment.trim());
  if (allFiltered.length === 0) return null;

  // 段階的リトライ: 全件 → 50件（最大2回、合計60秒以内に収める）
  const limits = allFiltered.length > 50 ? [allFiltered.length, 50] : [allFiltered.length];

  for (const limit of limits) {
    const result = await tryAnalyze(shopName, allFiltered.slice(0, limit), averageRating, totalReviewCount, ratingDistribution);
    if (result) return result;
    console.log(`[analyze] ${shopName}: ${limit}件で失敗、リトライ...`);
  }
  return null;
}

async function tryAnalyze(
  shopName: string,
  filteredReviews: GBPReview[],
  averageRating: number,
  totalReviewCount: number,
  ratingDistribution?: Record<number, number>
): Promise<any | null> {
  const reviewTexts = filteredReviews
    .map((r, i) => `[#${i + 1}][${r.starRating}][${r.reviewer.displayName}][${r.createTime?.slice(0, 10) || "不明"}] ${r.comment.slice(0, 300)}`)
    .join("\n");

  if (!reviewTexts) return null;

  // 口コミの統計データを事前計算
  const ratingMapLocal: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
  const dist = ratingDistribution || (() => {
    const d: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of filteredReviews) d[ratingMapLocal[r.starRating] || 0] = (d[ratingMapLocal[r.starRating] || 0] || 0) + 1;
    return d;
  })();
  const totalRated = Object.values(dist).reduce((a, b) => a + b, 0);
  const pctOf = (n: number) => totalRated > 0 ? Math.round(n / totalRated * 100) : 0;
  const statsText = `★5: ${dist[5]}件(${pctOf(dist[5])}%), ★4: ${dist[4]}件(${pctOf(dist[4])}%), ★3: ${dist[3]}件(${pctOf(dist[3])}%), ★2: ${dist[2]}件(${pctOf(dist[2])}%), ★1: ${dist[1]}件(${pctOf(dist[1])}%)`;
  const positiveCount = (dist[4] || 0) + (dist[5] || 0);
  const negativeCount = (dist[1] || 0) + (dist[2] || 0) + (dist[3] || 0);

  const prompt = `あなたはMEO対策の専門家です。以下の店舗の直近1年の口コミを分析し、JSON形式で結果を返してください。

店舗名: ${shopName}
Google評価: ${averageRating} / 5.0（${totalReviewCount}件）

【正確な統計データ（以下の数値をcommentsで使用すること。独自に数えないでください）】
直近1年の口コミ: ${totalRated}件
評価分布: ${statsText}
高評価(★4-5): ${positiveCount}件(${pctOf(positiveCount)}%)
低評価(★1-3): ${negativeCount}件(${pctOf(negativeCount)}%)

【口コミテキスト（直近1年・${filteredReviews.length}件）】
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
  "summary": "口コミの全体傾向を1行で要約（50文字以内。例: 味の評価は高いが接客面に課題あり）",
  "comments": [
    "コメント1（口コミデータに基づく具体的な分析。strongタグで強調箇所を囲む）",
    "コメント2",
    "コメント3",
    "コメント4",
    "コメント5（来月の施策提案）"
  ]
}

【commentsのルール】
- コメント内に口コミの参照番号（#1, #6, [#10]等）を絶対に含めないでください。お客様に見せるレポートです。
- 具体的な口コミ内容を引用する場合は「○○という声がある」のように表現してください。
- 数値（件数、割合、評価値）は必ず上記の「正確な統計データ」セクションの値を使用してください。口コミテキストから独自に数えた数値は使わないでください。
- Google評価の数値もそのまま使用してください。

【WordSourcesのルール】
- positiveWordSources・negativeWordSourcesの各reviewNumbersは、口コミテキストの[#番号]に対応する番号の配列です。
- positiveWordsの全ワードがpositiveWordSourcesに、negativeWordsの全ワードがnegativeWordSourcesに必ず含まれていること。
- 各ワードのreviewNumbersには、そのワード（フレーズ）が実際に含まれている口コミの番号を全て列挙してください。
- reviewNumbersが空配列にならないようにしてください。該当口コミが見つからないワードは出力しないでください。`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30秒タイムアウト
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
        max_tokens: 2048,
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

      // WordSourcesに対応がないワードを自動補完（口コミテキストから検索）
      const autoFillSources = (words: string[], sources: any[], ratingFilter?: Set<string>) => {
        const sourceWords = new Set(sources.map((s: any) => s.word));
        for (const w of words) {
          if (sourceWords.has(w)) continue;
          const matched = filteredReviews.filter(r => {
            if (!r.comment.includes(w)) return false;
            if (ratingFilter) return ratingFilter.has(r.starRating);
            return true;
          });
          if (matched.length > 0) {
            sources.push({
              word: w,
              reviews: matched.slice(0, 5).map(r => ({
                reviewer: r.reviewer.displayName,
                comment: r.comment,
                date: r.createTime?.slice(0, 10) || "不明",
                starRating: r.starRating,
              })),
            });
          }
        }
      };
      const posRatings = new Set(["FOUR", "FIVE", "4", "5"]);
      const negRatings = new Set(["ONE", "TWO", "THREE", "1", "2", "3"]);
      autoFillSources(parsed.positiveWords || [], parsed.positiveWordSources, posRatings);
      autoFillSources(parsed.negativeWords || [], parsed.negativeWordSources, negRatings);

      // 口コミが紐付かないワードを削除
      const posSourceWords = new Set(parsed.positiveWordSources.filter((s: any) => s.reviews.length > 0).map((s: any) => s.word));
      const negSourceWords = new Set(parsed.negativeWordSources.filter((s: any) => s.reviews.length > 0).map((s: any) => s.word));
      parsed.positiveWords = (parsed.positiveWords || []).filter((w: string) => posSourceWords.has(w));
      parsed.negativeWords = (parsed.negativeWords || []).filter((w: string) => negSourceWords.has(w));
      // 空のソースも除去
      parsed.positiveWordSources = parsed.positiveWordSources.filter((s: any) => s.reviews.length > 0);
      parsed.negativeWordSources = parsed.negativeWordSources.filter((s: any) => s.reviews.length > 0);

      // コメントから口コミ参照番号を除去（#6, [#10], (#3)等）
      if (Array.isArray(parsed.comments)) {
        parsed.comments = parsed.comments.map((c: string) =>
          c.replace(/[\[（(]?#\d+[\]）)]?/g, "").replace(/\s{2,}/g, " ").trim()
        );
      }
      if (parsed.summary) {
        parsed.summary = parsed.summary.replace(/[\[（(]?#\d+[\]）)]?/g, "").replace(/\s{2,}/g, " ").trim();
      }

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

      // Google公式評価をshopsテーブルから取得（AI独自計算より正確）
      let shopRow = (await supabase.from("shops").select("rating, review_count").eq("id", shop.id).maybeSingle()).data;
      // shop.idで見つからない場合、shop.nameでフォールバック検索
      if (!shopRow?.rating) {
        const { data: nameRow } = await supabase.from("shops").select("rating, review_count").eq("name", shop.name).not("rating", "is", null).maybeSingle();
        if (nameRow?.rating) shopRow = nameRow;
      }
      const officialRating = shopRow?.rating ?? reviewData.averageRating;
      const officialCount = shopRow?.review_count ?? reviewData.totalReviewCount;
      if (!shopRow?.rating) {
        console.warn(`[analyze] ${shop.name}: shopsテーブルにrating未保存。DB口コミから算出した${officialRating}を使用。口コミ再同期でshops.ratingが更新されます。`);
      }

      // Claude APIで分析
      const analysis = await analyzeWithClaude(
        shop.name,
        reviewData.reviews,
        officialRating,
        officialCount,
        reviewData.ratingDistribution
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
