import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 900;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
}

const RATING_MAP: Record<string, number> = {
  ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5,
  ONE_STAR: 1, TWO_STARS: 2, THREE_STARS: 3, FOUR_STARS: 4, FIVE_STARS: 5,
};

/**
 * GET /api/cron/monthly-analysis
 * 毎月1日に全店舗の口コミ分析を自動実行
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY未設定" }, { status: 500 });
  }

  const supabase = getSupabase();
  // ?month=2026-05 で対象月を指定可能（未指定なら今月）
  const monthParam = request.nextUrl.searchParams.get("month");
  const now = new Date();
  const currentMonth = monthParam || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // 全店舗取得
  const { data: shops } = await supabase
    .from("shops")
    .select("id, name")
    .not("gbp_location_name", "is", null);

  if (!shops || shops.length === 0) {
    return NextResponse.json({ success: true, message: "店舗なし", analyzed: 0 });
  }

  // 今月分析済みの店舗を除外
  const { data: existingAnalysis } = await supabase
    .from("report_analysis")
    .select("shop_name")
    .gte("created_at", `${currentMonth}-01T00:00:00`);

  const analyzedSet = new Set((existingAnalysis || []).map(a => a.shop_name));
  const toAnalyze = shops.filter(s => !analyzedSet.has(s.name));

  let analyzed = 0;
  let errors = 0;
  const startTime = Date.now();
  const TIME_LIMIT = 850_000; // 850秒（maxDuration=900の安全マージン）

  // Vercel Pro maxDuration=900秒: 1店舗約5秒 → 最大150店舗/実行
  for (const shop of toAnalyze.slice(0, 150)) {
    if (Date.now() - startTime > TIME_LIMIT) break;
    // 口コミ取得（shop_nameで検索 — reviews.shop_idはGo API IDでSupabase shops.idとは異なる）
    const { data: reviews } = await supabase
      .from("reviews")
      .select("comment, star_rating")
      .eq("shop_name", shop.name)
      .not("comment", "is", null)
      .order("create_time", { ascending: false })
      .limit(20);

    if (!reviews || reviews.length === 0) continue;

    const comments = reviews.map(r => {
      const stars = RATING_MAP[(r.star_rating || "").toUpperCase().replace(/_STARS?$/, "")] || 0;
      const text = (r.comment || "").replace(/\(Translated by Google\)[\s\S]*/i, "").slice(0, 200);
      return `★${stars}: ${text}`;
    }).join("\n");

    const avgRating = reviews.reduce((s, r) => {
      return s + (RATING_MAP[(r.star_rating || "").toUpperCase().replace(/_STARS?$/, "")] || 0);
    }, 0) / reviews.length;

    try {
      const prompt = `「${shop.name}」の口コミを分析してください。

${comments}

【重要ルール】
- positive_words・negative_wordsは、必ず口コミ原文に含まれる表現をそのまま抜き出してください。
- 要約・言い換え・意訳は禁止です。口コミテキスト内に実際に書かれているフレーズのみを使用してください。
- 例: 口コミに「スープが熱々で美味しかった」→ ○「スープが熱々」 ✕「温かいスープ」
- 各ワードは2〜8文字程度の短いフレーズにしてください。
- positive_wordsは★4-5の口コミから、negative_wordsは★1-3の口コミから抽出してください。

以下のJSON形式で出力（JSONのみ、他の文章は不要）:
{
  "positive_words": ["ポジティブワード1", "ポジティブワード2", ...最大5個],
  "negative_words": ["ネガティブワード1", ...最大5個],
  "summary": "口コミ分析の総評（100文字以内）",
  "comments": ["担当者コメント1", "担当者コメント2", ...5項目]
}`;

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 800, messages: [{ role: "user", content: prompt }] }),
        signal: AbortSignal.timeout(30000),
      });

      if (!res.ok) { errors++; continue; }
      const data = await res.json();
      const text = data.content?.[0]?.text?.trim() || "";

      let parsed: any = {};
      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      } catch { errors++; continue; }

      // 口コミ原文に存在しないワードを除去
      const allCommentText = reviews.map(r => r.comment || "").join(" ");
      const posWords = (parsed.positive_words || []).filter((w: string) => allCommentText.includes(w));
      const negWords = (parsed.negative_words || []).filter((w: string) => allCommentText.includes(w));

      await supabase.from("report_analysis").upsert({
        shop_name: shop.name,
        month: currentMonth,
        rating: Math.round(avgRating * 10) / 10,
        review_count: reviews.length,
        positive_words: posWords,
        negative_words: negWords,
        summary: parsed.summary || "",
        comments: parsed.comments || [],
        created_at: new Date().toISOString(),
      }, { onConflict: "shop_name,month" });

      analyzed++;
    } catch {
      errors++;
    }
  }

  const remaining = toAnalyze.length - analyzed - errors;
  console.log(`[cron/monthly-analysis] analyzed: ${analyzed}, errors: ${errors}, remaining: ${remaining}, total: ${toAnalyze.length}`);
  return NextResponse.json({
    success: true,
    analyzed,
    errors,
    remaining,
    total: toAnalyze.length,
    skipped: analyzedSet.size,
  });
}
