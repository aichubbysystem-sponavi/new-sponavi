import { NextRequest, NextResponse } from "next/server";
import { getSupabase, verifyCron } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";


const RATING_MAP: Record<string, number> = {
  ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5,
  ONE_STAR: 1, TWO_STARS: 2, THREE_STARS: 3, FOUR_STARS: 4, FIVE_STARS: 5,
};

/**
 * GET /api/cron/monthly-analysis
 * 毎月1日に全店舗の口コミ分析を自動実行
 */
export async function GET(request: NextRequest) {
  const cronErr = verifyCron(request); if (cronErr) return cronErr;

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
    } catch (e: unknown) {
      console.error(`[monthly-analysis] ${shop.name} 言語集計エラー:`, e instanceof Error ? e.message : e);
    }

    try {
      const prompt = `店舗の口コミ分析総評を作成。JSONのみ出力。

店舗: ${shop.name}
口コミ:
${comments}
${langSection}

■ 出力形式（JSON以外は一切書くな）
各項目は配列の独立した要素として出力。1つの文字列に複数項目を詰め込まない。

{
  "positive_words": ["原文フレーズ5個以上"],
  "negative_words": ["原文フレーズ5個以上"],
  "summary": "20文字の総評",
  "analysis": ["口コミ動向1", "口コミ動向2", "口コミ動向3"],
  "reviews": ["口コミ傾向1", "口コミ傾向2", "口コミ傾向3", "低評価傾向"],
  "actions": ["施策1", "施策2", "施策3"]
}

■ 正しい出力例
{
  "positive_words": ["味噌のコク", "駅直結"],
  "negative_words": ["愛想が悪い", "荷物置き場"],
  "summary": "味と立地が好評、接客に課題",
  "analysis": ["高評価が安定して継続している", "味と接客の両面で好意的な声が多い", "海外からの口コミも増加傾向"],
  "reviews": ["「味噌のコクが最高」と味への評価が高い", "「駅から近くて便利」と立地の良さが好評", "接客への不満が低評価の主因"],
  "actions": ["接客声かけマニュアルを作成する", "荷物置き場を確保する", "口コミ促進POPを設置する"]
}

■ ルール
- 各項目は1つの完全な文（20〜35文字）
- positive_words/negative_wordsは口コミ原文そのまま。各2〜8文字
- 口コミの件数には言及しない。捏造禁止
${langSection ? "- 口コミ言語は上記集計に記載された言語のみ言及" : ""}`;

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        cache: "no-store" as const,
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
      } catch (e: unknown) {
        console.error(`[monthly-analysis] ${shop.name} JSON parse error:`, e instanceof Error ? e.message : e);
        errors++; continue;
      }

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
        comments: (() => {
          const clean = (s: string) => s
            .replace(/^[・•]\s*/, "").replace(/^[a-c]\)\s*/, "")
            .replace(/・/g, "、")
            .replace(/。$/, "").replace(/[\u200B-\u200D\uFEFF\u00AD\uFFFD]/g, "").replace(/\s{2,}/g, " ").trim();
          const origComments = Array.isArray(parsed.comments) ? [...parsed.comments] : [];
          const toArr = (v: any): string[] => Array.isArray(v) ? v.filter((x: any) => typeof x === "string") : typeof v === "string" ? [v] : [];
          const analysis: string[] = toArr(parsed.analysis).map(clean).filter((s: string) => s.length >= 10);
          const rvws: string[] = toArr(parsed.reviews).map(clean).filter((s: string) => s.length >= 10);
          const actions: string[] = toArr(parsed.actions).map(clean).filter((s: string) => s.length >= 10);
          if (analysis.length || rvws.length) {
            return [
              analysis.slice(0, 3).map((s: string) => `・${s}`).join(""),
              rvws.slice(0, 4).map((s: string) => `・${s}`).join(""),
              actions.slice(0, 3).map((s: string, i: number) => `${String.fromCharCode(97 + i)}) ${s}`).join(" "),
            ];
          }
          return origComments.length > 0 ? origComments.map(clean) : [];
        })(),
        analyzed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "shop_name,target_month" });

      if (upsertErr) { console.error(`[cron/monthly-analysis] upsert error for ${shop.name}:`, upsertErr.message); errors++; continue; }
      analyzed++;
    } catch (e: unknown) {
      console.error(`[monthly-analysis] ${shop.name} unexpected error:`, e instanceof Error ? e.message : e);
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
