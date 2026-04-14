import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

  // N+1解消: 全データを一括取得してメモリ上で集計
  const [reviewsData, postLogsData, badAlertsData] = await Promise.all([
    supabase.from("reviews").select("shop_id, create_time, reply_comment").gte("create_time", sixtyDaysAgo),
    supabase.from("post_logs").select("shop_id, created_at").gte("created_at", thirtyDaysAgo),
    supabase.from("bad_review_alerts").select("shop_id, created_at").gte("created_at", thirtyDaysAgo),
  ]);

  // 店舗ごとに集計
  const reviewsByShop = new Map<string, { recent: number; prev: number; unreplied: number; total: number }>();
  (reviewsData.data || []).forEach(r => {
    if (!reviewsByShop.has(r.shop_id)) reviewsByShop.set(r.shop_id, { recent: 0, prev: 0, unreplied: 0, total: 0 });
    const s = reviewsByShop.get(r.shop_id)!;
    s.total++;
    if (!r.reply_comment) s.unreplied++;
    if (r.create_time >= thirtyDaysAgo) s.recent++;
    else s.prev++;
  });

  const postsByShop = new Map<string, number>();
  (postLogsData.data || []).forEach(p => {
    postsByShop.set(p.shop_id, (postsByShop.get(p.shop_id) || 0) + 1);
  });

  const badByShop = new Map<string, number>();
  (badAlertsData.data || []).forEach(b => {
    badByShop.set(b.shop_id, (badByShop.get(b.shop_id) || 0) + 1);
  });

  const scores: { shopId: string; shopName: string; score: number; risk: string; factors: string[] }[] = [];

  for (const shop of shops) {
    let score = 0;
    const factors: string[] = [];
    const rv = reviewsByShop.get(shop.id) || { recent: 0, prev: 0, unreplied: 0, total: 0 };

    // 1. 口コミ増加率
    if (rv.recent === 0 && rv.prev > 0) { score += 30; factors.push("口コミ増加が停止"); }
    else if (rv.recent < rv.prev * 0.5 && rv.prev > 0) { score += 20; factors.push("口コミ増加率50%減"); }

    // 2. 未返信口コミ率
    const unrepliedRate = rv.total > 0 ? rv.unreplied / rv.total : 0;
    if (unrepliedRate > 0.5) { score += 25; factors.push(`未返信率${Math.round(unrepliedRate * 100)}%`); }
    else if (unrepliedRate > 0.3) { score += 15; factors.push(`未返信率${Math.round(unrepliedRate * 100)}%`); }

    // 3. 投稿頻度
    const postCount = postsByShop.get(shop.id) || 0;
    if (postCount === 0) { score += 25; factors.push("30日間投稿なし"); }
    else if (postCount < 2) { score += 10; factors.push("投稿頻度低下"); }

    // 4. 低評価口コミ
    const badCount = badByShop.get(shop.id) || 0;
    if (badCount >= 3) { score += 20; factors.push(`低評価口コミ${badCount}件/月`); }
    else if (badCount >= 1) { score += 10; factors.push(`低評価口コミ${badCount}件/月`); }

    const risk = score >= 60 ? "高リスク" : score >= 30 ? "要注意" : "安定";
    scores.push({
      shopId: shop.id, shopName: shop.name,
      score: Math.min(100, score), risk,
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
