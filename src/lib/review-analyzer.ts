/**
 * 口コミ分析モジュール
 * Supabase DBから分析結果を読み取り、なければテンプレート生成
 */

import { createClient } from "@supabase/supabase-js";
import type { ReviewAnalysis } from "./report-data";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

interface StoredAnalysis {
  shop_name: string;
  positive_words: string[];
  negative_words: string[];
  summary: string;
  comments: string[];
  review_count: number;
  average_rating: number;
  analyzed_at: string;
}

/**
 * Supabase DBから保存済みの分析結果を取得
 */
export async function getStoredAnalysis(
  shopName: string
): Promise<{ analysis: ReviewAnalysis; comments: string[]; source: "db" } | null> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("report_analysis")
      .select("*")
      .eq("shop_name", shopName)
      .single();

    if (error || !data) return null;

    const stored = data as StoredAnalysis;

    return {
      analysis: {
        positiveWords: stored.positive_words || [],
        negativeWords: stored.negative_words || [],
        summary: stored.summary || "",
      },
      comments: stored.comments || [],
      rating: stored.average_rating || 0,
      reviewCount: stored.review_count || 0,
      source: "db",
    };
  } catch {
    return null;
  }
}

/**
 * 数値ベースのテンプレート分析（フォールバック）
 */
export function generateTemplateAnalysis(
  shopName: string,
  currentMonth: string,
  rating: number,
  totalReviews: number,
  reviewDelta: number,
  kpiData: { searchPct: string; mapPct: string; actionPct: string }
): { analysis: ReviewAnalysis; comments: string[] } {
  const ratingDesc =
    rating >= 4.5 ? "非常に高い" : rating >= 4.0 ? "高い" : rating >= 3.5 ? "標準的な" : "改善が必要な";

  return {
    analysis: {
      positiveWords: [],
      negativeWords: [],
      summary: `口コミ評価は${rating}と${ratingDesc}水準を維持しています。${currentMonth}は+${reviewDelta}件の増加で、累計${totalReviews.toLocaleString()}件。${
        reviewDelta >= 20
          ? "月間増加ペースも好調です。"
          : reviewDelta >= 10
            ? "安定した増加ペースを維持しています。"
            : "口コミ獲得施策の強化を検討する必要があります。"
      }`,
    },
    comments: [
      `Google検索数は前月比${kpiData.searchPct}。${kpiData.searchPct.startsWith("+") ? "検索経由の認知が拡大しています。" : "検索アルゴリズム変動の影響を注視します。"}`,
      `Googleマップ表示数は前月比${kpiData.mapPct}。${kpiData.mapPct.startsWith("+") ? "マップ経由の集客力が強化されています。" : "GBP情報の最適化を継続します。"}`,
      `口コミは+${reviewDelta}件で累計${totalReviews.toLocaleString()}件。評価${rating}を維持しており${rating >= 4.0 ? "良好" : "、改善の余地あり"}。`,
      `ユーザーアクション合計は前月比${kpiData.actionPct}。${kpiData.actionPct.startsWith("+") ? "ユーザーの反応が改善傾向にあります。" : "投稿頻度の向上やメニュー情報の充実で改善を図ります。"}`,
      "来月はGBP投稿の強化と口コミ獲得施策を継続し、各指標の改善を目指します。",
    ],
  };
}

/**
 * 店舗の口コミ分析を取得（DB → テンプレートフォールバック）
 */
export async function getReviewAnalysis(
  shopName: string,
  currentMonth: string,
  rating: number,
  totalReviews: number,
  reviewDelta: number,
  kpiData: { searchPct: string; mapPct: string; actionPct: string }
): Promise<{ analysis: ReviewAnalysis; comments: string[]; rating?: number; reviewCount?: number; source: "db" | "template" }> {
  // まずDBから取得を試行
  const stored = await getStoredAnalysis(shopName);
  if (stored) return stored;

  // フォールバック: テンプレート生成
  const template = generateTemplateAnalysis(shopName, currentMonth, rating, totalReviews, reviewDelta, kpiData);
  return { ...template, source: "template" };
}
