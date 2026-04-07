/**
 * 口コミ分析モジュール
 * Go APIから口コミテキストを取得 → Claude APIで分析
 */

import type { ReviewAnalysis } from "./report-data";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5555";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";

// ── Go API 口コミ取得 ──

interface GBPReview {
  name: string;
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

/**
 * Go APIから口コミ一覧を取得
 * ※ Go APIが認証を要求する場合はnullを返す
 */
async function fetchReviewsFromAPI(shopId: string): Promise<GBPReview[] | null> {
  try {
    const res = await fetch(`${API_URL}/api/shop/${shopId}/review`, {
      headers: { "Content-Type": "application/json" },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const data: ReviewListResponse = await res.json();
    return data.reviews || [];
  } catch {
    return null;
  }
}

// ── Claude API 分析 ──

interface AnalysisResult {
  positiveWords: string[];
  negativeWords: string[];
  summary: string;
  comments: string[];
}

/**
 * 口コミテキストをClaude APIで分析
 */
async function analyzeWithClaude(
  shopName: string,
  reviews: GBPReview[],
  currentMonth: string,
  rating: number,
  totalReviews: number,
  kpiSummary: string
): Promise<AnalysisResult | null> {
  if (!ANTHROPIC_API_KEY) return null;

  // 最新50件の口コミテキストを抽出
  const recentReviews = reviews
    .filter((r) => r.comment && r.comment.trim())
    .slice(0, 50)
    .map((r) => `[${r.starRating}] ${r.comment}`)
    .join("\n");

  if (!recentReviews) return null;

  const prompt = `あなたはMEO対策の専門家です。以下の店舗の口コミを分析し、JSON形式で結果を返してください。

店舗名: ${shopName}
評価: ${rating} / 5.0（${totalReviews}件）
対象月: ${currentMonth}
パフォーマンス概要: ${kpiSummary}

【口コミテキスト】
${recentReviews}

【出力形式】以下のJSON形式で返してください。JSONのみ出力し、他の文字は不要です。
{
  "positiveWords": ["ポジティブワード1", "ポジティブワード2", ...],  // 上位6個
  "negativeWords": ["ネガティブワード1", ...],  // 上位3個
  "summary": "口コミ総評（3行程度。評価の傾向、特筆すべき点、改善点を含む）",
  "comments": [
    "担当者コメント1（数値データに基づく分析）",
    "担当者コメント2",
    "担当者コメント3",
    "担当者コメント4",
    "担当者コメント5（来月の施策提案）"
  ]
}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
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

    if (!res.ok) {
      console.error("[review-analyzer] Claude API error:", res.status);
      return null;
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || "";

    // JSONを抽出（コードブロック内の場合も対応）
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    return JSON.parse(jsonMatch[0]) as AnalysisResult;
  } catch (err) {
    console.error("[review-analyzer] analysis error:", err);
    return null;
  }
}

// ── 数値ベースの分析（Claude API未設定時のフォールバック） ──

function generateFromNumbers(
  shopName: string,
  currentMonth: string,
  rating: number,
  totalReviews: number,
  reviewDelta: number,
  kpiData: { searchPct: string; mapPct: string; actionPct: string }
): AnalysisResult {
  const ratingDesc =
    rating >= 4.5 ? "非常に高い" : rating >= 4.0 ? "高い" : rating >= 3.5 ? "標準的な" : "改善が必要な";

  return {
    positiveWords: [],
    negativeWords: [],
    summary: `口コミ評価は${rating}と${ratingDesc}水準を維持しています。${currentMonth}は+${reviewDelta}件の増加で、累計${totalReviews.toLocaleString()}件。${
      reviewDelta >= 20
        ? "月間増加ペースも好調です。"
        : reviewDelta >= 10
          ? "安定した増加ペースを維持しています。"
          : "口コミ獲得施策の強化を検討する必要があります。"
    }`,
    comments: [
      `Google検索数は前月比${kpiData.searchPct}。${kpiData.searchPct.startsWith("+") ? "検索経由の認知が拡大しています。" : "検索アルゴリズム変動の影響を注視します。"}`,
      `Googleマップ表示数は前月比${kpiData.mapPct}。${kpiData.mapPct.startsWith("+") ? "マップ経由の集客力が強化されています。" : "GBP情報の最適化を継続します。"}`,
      `口コミは+${reviewDelta}件で累計${totalReviews.toLocaleString()}件。評価${rating}を維持しており${rating >= 4.0 ? "良好" : "、改善の余地あり"}。`,
      `ユーザーアクション合計は前月比${kpiData.actionPct}。${kpiData.actionPct.startsWith("+") ? "ユーザーの反応が改善傾向にあります。" : "投稿頻度の向上やメニュー情報の充実で改善を図ります。"}`,
      "来月はGBP投稿の強化と口コミ獲得施策を継続し、各指標の改善を目指します。",
    ],
  };
}

// ── 公開API ──

/**
 * 店舗の口コミ分析を実行
 * 1. Go APIから口コミテキスト取得を試行
 * 2. Claude APIで分析（テキストがある場合）
 * 3. フォールバック: 数値ベースの分析
 */
export async function analyzeReviews(
  shopId: string,
  shopName: string,
  currentMonth: string,
  rating: number,
  totalReviews: number,
  reviewDelta: number,
  kpiData: { searchPct: string; mapPct: string; actionPct: string }
): Promise<{ analysis: ReviewAnalysis; comments: string[]; source: "claude" | "template" }> {
  // Go APIから口コミ取得を試行
  const reviews = await fetchReviewsFromAPI(shopId);

  if (reviews && reviews.length > 0 && ANTHROPIC_API_KEY) {
    // Claude APIで分析
    const kpiSummary = `検索${kpiData.searchPct}、マップ${kpiData.mapPct}、アクション${kpiData.actionPct}、口コミ+${reviewDelta}件`;
    const result = await analyzeWithClaude(shopName, reviews, currentMonth, rating, totalReviews, kpiSummary);

    if (result) {
      return {
        analysis: {
          positiveWords: result.positiveWords,
          negativeWords: result.negativeWords,
          summary: result.summary,
        },
        comments: result.comments,
        source: "claude",
      };
    }
  }

  // フォールバック: 数値ベース
  const fallback = generateFromNumbers(shopName, currentMonth, rating, totalReviews, reviewDelta, kpiData);
  return {
    analysis: {
      positiveWords: fallback.positiveWords,
      negativeWords: fallback.negativeWords,
      summary: fallback.summary,
    },
    comments: fallback.comments,
    source: "template",
  };
}
