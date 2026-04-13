import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

/**
 * GET /api/report/churn-score
 * 解約予兆スコア: 全店舗の解約リスクをスコアリング
 */
export async function GET(request: NextRequest) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const { data: shops } = await supabase
    .from("shops")
    .select("id, name, gbp_location_name")
    .not("gbp_location_name", "is", null);

  if (!shops || shops.length === 0) {
    return NextResponse.json({ scores: [] });
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

  const scores: { shopId: string; shopName: string; score: number; risk: string; factors: string[] }[] = [];

  for (const shop of shops.slice(0, 100)) {
    let score = 0;
    const factors: string[] = [];

    // 1. 口コミ増加率（30日）
    const { count: recentReviews } = await supabase
      .from("reviews").select("id", { count: "exact", head: true })
      .eq("shop_id", shop.id).gte("create_time", thirtyDaysAgo);

    const { count: prevReviews } = await supabase
      .from("reviews").select("id", { count: "exact", head: true })
      .eq("shop_id", shop.id).gte("create_time", sixtyDaysAgo).lt("create_time", thirtyDaysAgo);

    if ((recentReviews || 0) === 0 && (prevReviews || 0) > 0) {
      score += 30;
      factors.push("口コミ増加が停止");
    } else if ((recentReviews || 0) < (prevReviews || 0) * 0.5) {
      score += 20;
      factors.push("口コミ増加率50%減");
    }

    // 2. 未返信口コミ率
    const { count: unreplied } = await supabase
      .from("reviews").select("id", { count: "exact", head: true })
      .eq("shop_id", shop.id).is("reply_comment", null);
    const { count: totalReviews } = await supabase
      .from("reviews").select("id", { count: "exact", head: true })
      .eq("shop_id", shop.id);

    const unrepliedRate = (totalReviews || 0) > 0 ? (unreplied || 0) / (totalReviews || 1) : 0;
    if (unrepliedRate > 0.5) {
      score += 25;
      factors.push(`未返信率${Math.round(unrepliedRate * 100)}%`);
    } else if (unrepliedRate > 0.3) {
      score += 15;
      factors.push(`未返信率${Math.round(unrepliedRate * 100)}%`);
    }

    // 3. 投稿頻度
    const { count: recentPosts } = await supabase
      .from("post_logs").select("id", { count: "exact", head: true })
      .eq("shop_id", shop.id).gte("created_at", thirtyDaysAgo);

    if ((recentPosts || 0) === 0) {
      score += 25;
      factors.push("30日間投稿なし");
    } else if ((recentPosts || 0) < 2) {
      score += 10;
      factors.push("投稿頻度低下");
    }

    // 4. 低評価口コミの増加
    const { count: badReviews } = await supabase
      .from("bad_review_alerts").select("id", { count: "exact", head: true })
      .eq("shop_id", shop.id).gte("created_at", thirtyDaysAgo);

    if ((badReviews || 0) >= 3) {
      score += 20;
      factors.push(`低評価口コミ${badReviews}件/月`);
    } else if ((badReviews || 0) >= 1) {
      score += 10;
      factors.push(`低評価口コミ${badReviews}件/月`);
    }

    const risk = score >= 60 ? "高リスク" : score >= 30 ? "要注意" : "安定";

    scores.push({
      shopId: shop.id,
      shopName: shop.name,
      score: Math.min(100, score),
      risk,
      factors: factors.length > 0 ? factors : ["問題なし"],
    });
  }

  scores.sort((a, b) => b.score - a.score);

  return NextResponse.json({
    scores,
    summary: {
      high: scores.filter(s => s.risk === "高リスク").length,
      warning: scores.filter(s => s.risk === "要注意").length,
      stable: scores.filter(s => s.risk === "安定").length,
    },
  });
}
