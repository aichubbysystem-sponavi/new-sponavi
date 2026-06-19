import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

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
  // ?month=2026/5 または ?month=2026-05 で対象月を指定可能（未指定なら今月）
  const monthParam = request.nextUrl.searchParams.get("month");
  const now = new Date();
  // target_monthカラムは "2026/5" 形式で統一
  const rawMonth = monthParam || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const currentMonth = rawMonth.includes("-")
    ? `${rawMonth.split("-")[0]}/${parseInt(rawMonth.split("-")[1])}`
    : rawMonth;

  // 全店舗取得（解約店舗を除外）
  const { data: shops } = await supabase
    .from("shops")
    .select("id, name")
    .not("gbp_location_name", "is", null)
    .is("cancelled_at", null);

  if (!shops || shops.length === 0) {
    return NextResponse.json({ success: true, message: "店舗なし", analyzed: 0 });
  }

  // 今月分析済みの店舗を除外（target_monthで正確にチェック）
  const { data: existingAnalysis } = await supabase
    .from("report_analysis")
    .select("shop_name")
    .eq("target_month", currentMonth);

  const analyzedSet = new Set((existingAnalysis || []).map(a => a.shop_name));
  const toAnalyze = shops.filter(s => !analyzedSet.has(s.name));

  let analyzed = 0;
  let errors = 0;
  const startTime = Date.now();
  const TIME_LIMIT = 750_000; // 750秒（maxDuration=800の安全マージン）

  // Vercel Pro maxDuration=800秒: 1店舗約5秒 → 最大130店舗/実行
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

    // 口コミ言語別集計（detectLanguageに生コメントをそのまま渡す — review-language-stats APIと同じ挙動）
    let langSection = "";
    try {
      const { detectLanguage } = await import("@/lib/detect-language");
      const lc: Record<string, { country: string; count: number }> = {};
      for (const r of reviews) {
        if (!r.comment) continue;
        const det = detectLanguage(r.comment);
        if (det.lang === "不明") continue;
        if (!lc[det.lang]) lc[det.lang] = { country: det.country, count: 0 };
        lc[det.lang].count++;
      }
      const sorted = Object.entries(lc).map(([lang, v]) => ({ lang, ...v })).sort((a, b) => b.count - a.count);
      if (sorted.length > 0) {
        langSection = `\n\n【口コミ言語別集計】\n${sorted.map(l => `${l.lang}: ${l.count}件`).join(", ")}\n※上記に含まれない言語を推測で記述しないこと。`;
      }
    } catch {}

    try {
      const prompt = `「${shop.name}」のMEOレポート総評を作成してください。読み手は店舗オーナーです。

${comments}
${langSection}

■ 出力形式（JSONのみ出力。他の文章は一切不要）
{
  "positive_words": ["原文そのままの短いフレーズ5個以上"],
  "negative_words": ["原文そのままの短いフレーズ5個以上"],
  "summary": "50文字以内の1行総評",
  "comments": ["コメント1", "コメント2", "コメント3"]
}

■ positive_words / negative_words のルール
- 口コミ原文の表現をそのまま抜き出す。言い換え・意訳は禁止
- 例: 原文「スープが熱々で美味しかった」→ ○「スープが熱々」 ✕「温かいスープ」
- 各2〜8文字。positive=★4-5、negative=★1-3 から抽出

■ comments のルール
comments配列は必ず3要素:

comments[0]「数値分析」: 口コミ動向から推定した概況を箇条書き3項目。各「・」で始め1文25文字以内
comments[1]「口コミ傾向と強み」: 高評価で繰り返し言及されるポイントを箇条書き3項目。「〜という声」の形で引用。各1文30文字以内
comments[2]「改善策」: 具体的アクションを a) b) c) で3つ。各1文30文字以内。今日から実行できる施策のみ

■ 制約
- 箇条書きのみ。長文段落は禁止
- 口コミの件数には言及しない。質と傾向のみ
- 改善策で店舗が行っていないキャンペーン・特典を捏造しない
- <strong>タグで重要な結論を1コメントにつき1〜2箇所だけ強調
${langSection ? "- 口コミ言語は上記集計に記載された言語のみ言及" : ""}`;

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

      const { error: upsertErr } = await supabase.from("report_analysis").upsert({
        shop_name: shop.name,
        target_month: currentMonth,
        average_rating: Math.round(avgRating * 10) / 10,
        review_count: reviews.length,
        positive_words: posWords,
        negative_words: negWords,
        summary: parsed.summary || "",
        comments: parsed.comments || [],
        analyzed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "shop_name,target_month" });

      if (upsertErr) { console.error(`[cron/monthly-analysis] upsert error for ${shop.name}:`, upsertErr.message); errors++; continue; }
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
