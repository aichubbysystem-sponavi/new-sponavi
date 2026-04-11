import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const DIFY_BASE_URL = process.env.DIFY_BASE_URL || "";
const DIFY_DATASET_API_KEY = process.env.DIFY_DATASET_API_KEY || "";
const DIFY_DATASET_ID = process.env.DIFY_DATASET_ID || "";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
}

/**
 * GET /api/report/tasks
 * 全機能から未完了タスクを集約して返す
 */
export async function GET() {
  const supabase = getSupabase();
  const tasks: { category: string; label: string; count: number; priority: "high" | "medium" | "low"; detail?: string }[] = [];

  // 1. 口コミ未返信
  const { count: unreplied } = await supabase
    .from("reviews")
    .select("id", { count: "exact", head: true })
    .is("reply_comment", null);
  if (unreplied && unreplied > 0) {
    tasks.push({ category: "reviews", label: "口コミ未返信", count: unreplied, priority: unreplied > 50 ? "high" : "medium" });
  }

  // 2. 悪い口コミ未確認
  const { count: badReviews } = await supabase
    .from("bad_review_alerts")
    .select("id", { count: "exact", head: true })
    .eq("confirmed", false);
  if (badReviews && badReviews > 0) {
    tasks.push({ category: "reviews", label: "要注意口コミ（★3以下）未確認", count: badReviews, priority: "high" });
  }

  // 3. NAP不一致
  const { count: napNG } = await supabase
    .from("nap_check_results")
    .select("id", { count: "exact", head: true })
    .neq("status", "OK")
    .neq("status", "エラー")
    .neq("status", "GBP取得エラー");
  if (napNG && napNG > 0) {
    tasks.push({ category: "nap", label: "NAP不一致店舗", count: napNG, priority: "medium" });
  }

  // 4. 投稿頻度不足（30日以内に投稿がない店舗数をpost_logsから推定）
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recentPosts } = await supabase
    .from("post_logs")
    .select("shop_id")
    .gte("created_at", thirtyDaysAgo);
  const { count: totalShops } = await supabase
    .from("shops")
    .select("id", { count: "exact", head: true })
    .not("gbp_location_name", "is", null);
  const activeShops = new Set((recentPosts || []).map((p) => p.shop_id)).size;
  const inactiveShops = (totalShops || 0) - activeShops;
  if (inactiveShops > 0) {
    tasks.push({ category: "posts", label: "30日間投稿なし店舗", count: inactiveShops, priority: inactiveShops > 100 ? "low" : "medium" });
  }

  // タスクサマリーテキスト生成（AI社長用）
  const summary = tasks.length === 0
    ? "現在未完了タスクはありません。全業務が順調です。"
    : tasks.map((t) => `- ${t.label}: ${t.count}件（優先度: ${t.priority === "high" ? "高" : t.priority === "medium" ? "中" : "低"}）`).join("\n");

  return NextResponse.json({ tasks, summary, totalTasks: tasks.reduce((s, t) => s + t.count, 0) });
}

/**
 * POST /api/report/tasks
 * 完了した業務をDifyナレッジベースに記録
 */
export async function POST(request: Request) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const { action, detail } = await request.json();
  if (!action) return NextResponse.json({ error: "actionが必要です" }, { status: 400 });

  if (!DIFY_BASE_URL || !DIFY_DATASET_API_KEY || !DIFY_DATASET_ID) {
    return NextResponse.json({ error: "Difyナレッジベース設定がありません" }, { status: 500 });
  }

  const now = new Date();
  const title = `業務ログ_${now.toISOString().slice(0, 10)}_${now.getTime()}`;
  const text = `【日時】${now.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}\n【業務】${action}\n【詳細】${detail || "なし"}`;

  try {
    const res = await fetch(`${DIFY_BASE_URL}/datasets/${DIFY_DATASET_ID}/document/create-by-text`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DIFY_DATASET_API_KEY}`,
      },
      body: JSON.stringify({
        name: title,
        text,
        indexing_technique: "high_quality",
        process_rule: { mode: "automatic" },
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      return NextResponse.json({ error: `Dify API ${res.status}: ${err.slice(0, 100)}` }, { status: 500 });
    }

    return NextResponse.json({ success: true, title });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "ナレッジ保存失敗" }, { status: 500 });
  }
}
