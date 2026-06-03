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
  ratingDistribution?: Record<number, number>,
  kpiText?: string
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
    const result = await tryAnalyze(shopName, allFiltered.slice(0, limit), averageRating, totalReviewCount, ratingDistribution, kpiText);
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
  ratingDistribution?: Record<number, number>,
  kpiText?: string
): Promise<any | null> {
  const reviewTexts = filteredReviews
    .map((r) => `[${r.createTime?.slice(0, 10) || ""}] ${r.comment.slice(0, 300)}`)
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
  const positiveCount = (dist[4] || 0) + (dist[5] || 0);
  const negativeCount = (dist[1] || 0) + (dist[2] || 0) + (dist[3] || 0);

  // KPIデータの有無でプロンプト構造を変える
  const hasKpi = !!(kpiText && kpiText.trim());

  const prompt = `あなたはMEO対策の専門家です。以下の店舗のレポート総評を作成してください。
これは「口コミ分析」ではなく「MEOレポート全体の総評」です。KPIデータ（検索数・マップ表示数・アクション数）と口コミの両方を必ず分析してください。

店舗名: ${shopName}
Google公式評価: ${averageRating} / 5.0（※この値を必ず使用。独自に平均を計算しないこと）

【正確な統計データ（以下の数値をcommentsで使用すること。独自に数えないでください）】
${kpiText || ""}

【口コミテキスト（分析用サンプル）】
${reviewTexts}

【重要ルール（positiveWords / negativeWords）】
- 必ず口コミ原文に含まれる表現をそのまま抜き出してください。要約・言い換え・意訳は禁止。
- 例: 口コミに「スープが熱々で美味しかった」→ ○「スープが熱々」 ✕「温かいスープ」
- 各ワードは2〜8文字程度の短いフレーズ。
- positiveWordsは好意的な口コミから、negativeWordsは批判的な口コミから抽出。
- それぞれ最低12個以上の候補を出してください（後で自動フィルタします）。

【出力形式】以下のJSON形式のみ出力してください。WordSourcesは不要です。
{
  "positiveWords": ["ポジ1", "ポジ2", ... "ポジ12"],
  "negativeWords": ["ネガ1", "ネガ2", ... "ネガ12"],
  "summary": "レポート全体の総評を1行で要約（50文字以内。KPI動向+口コミ傾向を両方含める）",
  "comments": [
    "（ここにKPI総合分析を書く）${hasKpi ? "【必須】検索数・マップ表示数・アクション数の前月比・前年比を数値で分析。アクション率（行動転換率）の変化も言及。同業種/同グループ平均との比較を全指標で行い、何が上回り何が下回るか明確に" : "パフォーマンス概況（KPIデータ未取得のため口コミ動向から推定）"}",
    "（ここに口コミ・集客分析を書く）評価${averageRating}点。口コミ増加ペース、検索語句の指名/一般比率、キーワード順位変動を総合分析。口コミの件数には言及しないこと",
    "（ここに強みを書く）${hasKpi ? "コメント1・2で未言及の指標や切り口で強みを分析。" : ""}口コミで評価されている点を具体的に引用",
    "（ここに改善点を書く）${hasKpi ? "コメント1・2で未言及の指標や切り口で改善点を分析。" : ""}口コミで指摘されている課題を具体的に引用",
    "（ここに来月の施策提案を書く）${hasKpi ? "KPI改善（検索数回復・アクション率向上）、順位対策、" : ""}口コミ促進の各面から実行可能なアクション3〜4つ。各施策はa) b) c) d)で番号付けすること。①②③④は使わない"
  ]
}

【commentsのルール（厳守）】
- これはお客様に見せるMEOレポートの総評です。口コミ分析レポートではありません。
${hasKpi ? `- ★最重要★ コメント1は「検索数○○回（前月比○%）」「マップ表示○○回（前月比○%）」「アクション率○%」のように、上記KPIデータの具体的な数値を必ず引用。数値なしの抽象的な記述は禁止。
- コメント2ではキーワード順位変動・検索語句の指名/一般比率・口コミ増加ペースにも触れること。
- コメント3・4でも、同グループ平均・同業種平均との比較を「検索数は同業種平均○○回に対し○○回で○%上回っている」のように定量的に記載。` : "- KPIデータが未取得のため、口コミデータを中心に分析してください（その旨は書かない）。"}
- 数値は必ず上記の統計データ・KPIデータの値をそのまま使用。独自計算は禁止。評価は${averageRating}。
- 口コミの「件数」「○○件」には一切言及しないこと。件数比較は行わない。口コミの質・傾向のみ分析すること。
- コメント内に口コミ参照番号（#1, #6等）を絶対に含めない。
- 具体的な口コミ引用は「○○という声がある」のように表現。
- 重要な数値や結論は<strong>タグで強調。
- コメント5の施策提案では、店舗が実際に行っていない具体的なキャンペーン・特典・割引（例:「トッピング無料」「○○割引」）を捏造しないこと。提案は「写真投稿を週2回以上」「多言語Q&Aの充実」等の一般的なMEO施策にとどめる。
- ★データ重複禁止★ 同じ数値・同じ比較を複数のコメントで繰り返すことは厳禁。具体的に：
  - コメント1で「アクション合計746件は同業種平均328件の2.3倍」と書いたら、コメント3で同じ比較を再掲しない。コメント3では口コミの質やブランド力など別の切り口で強みを論じる。
  - コメント2で「ramen near me 3位→5位」と書いたら、コメント4で同じKWの同じ変動を再掲しない。コメント4ではKPIの前年比や口コミの課題など別の指標で改善点を論じる。
  - 各コメントは独自の分析視点を持つこと。前のコメントで既出の数値を参照する場合は「前述の通り」等で簡潔に触れるのみ。
- 口コミ増加ペースに言及する際は、提供データの月ラベルをそのまま使うこと。「当月」「今月」等の曖昧な表現は使わない。レポート対象月より後の月のデータには言及しないこと。`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000); // 120秒タイムアウト（Sonnet用）
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
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

      // ── キーワード厳密検証: 口コミ原文に完全含有するもののみ残し、登場回数TOP6 ──
      const posRatings = new Set(["FOUR", "FIVE", "4", "5"]);
      const negRatings = new Set(["ONE", "TWO", "THREE", "1", "2", "3"]);

      const strictValidateAndRank = (words: string[], ratingFilter: Set<string>, maxCount: number) => {
        const wordCounts: { word: string; count: number; reviews: any[] }[] = [];
        for (const w of words) {
          if (!w || w.length < 2) continue;
          // 口コミ原文に完全含有 & 星評価フィルタ
          const matched = filteredReviews.filter(r =>
            r.comment && r.comment.includes(w) && ratingFilter.has(r.starRating)
          );
          if (matched.length === 0) continue;
          wordCounts.push({
            word: w,
            count: matched.length,
            reviews: matched.slice(0, 5).map(r => ({
              reviewer: r.reviewer.displayName,
              comment: r.comment,
              date: r.createTime?.slice(0, 10) || "不明",
              starRating: r.starRating,
            })),
          });
        }
        // 登場回数の多い順にソート → TOP maxCount
        wordCounts.sort((a, b) => b.count - a.count);
        const top = wordCounts.slice(0, maxCount);
        return {
          words: top.map(t => t.word),
          sources: top.map(t => ({ word: t.word, reviews: t.reviews })),
        };
      };

      const posResult = strictValidateAndRank(parsed.positiveWords || [], posRatings, 6);
      const negResult = strictValidateAndRank(parsed.negativeWords || [], negRatings, 6);

      parsed.positiveWords = posResult.words;
      parsed.negativeWords = negResult.words;
      parsed.positiveWordSources = posResult.sources;
      parsed.negativeWordSources = negResult.sources;

      // コメントからプレフィックス・口コミ参照番号を除去
      if (Array.isArray(parsed.comments)) {
        parsed.comments = parsed.comments.map((c: string) =>
          c
            .replace(/^（ここに[^）]*を書く）\s*/g, "")  // プロンプトのプレースホルダー除去
            .replace(/^コメント\d+[:：]\s*/g, "")          // 「コメント1:」ラベル除去
            .replace(/[\[（(]?#\d+[\]）)]?/g, "")          // 口コミ参照番号除去
            .replace(/\s{2,}/g, " ")
            .trim()
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

      // Google公式評価を取得（report_data_cache > shops > DB口コミ計算 の優先順）
      let officialRating = reviewData.averageRating;
      let officialCount = reviewData.totalReviewCount;

      // 1. report_data_cacheから取得（スプレッドシート由来、最も正確）
      try {
        const { data: cache } = await supabase.from("report_data_cache").select("report_json").eq("shop_name", shop.name).maybeSingle();
        if (cache?.report_json) {
          const shopInfo = (cache.report_json as any).shop;
          if (shopInfo?.rating && shopInfo.rating > 0) {
            officialRating = shopInfo.rating;
            if (shopInfo.totalReviews) officialCount = shopInfo.totalReviews;
          }
        }
      } catch {}

      // 2. shopsテーブルから取得（フォールバック）
      if (officialRating === reviewData.averageRating) {
        let shopRow = (await supabase.from("shops").select("rating, review_count").eq("id", shop.id).maybeSingle()).data;
        if (!shopRow?.rating) {
          const { data: nameRow } = await supabase.from("shops").select("rating, review_count").eq("name", shop.name).not("rating", "is", null).maybeSingle();
          if (nameRow?.rating) shopRow = nameRow;
        }
        if (shopRow?.rating) {
          officialRating = shopRow.rating;
          if (shopRow.review_count) officialCount = shopRow.review_count;
        }
      }

      console.log(`[analyze] ${shop.name}: officialRating=${officialRating}, officialCount=${officialCount}`);

      // KPIデータとグループ平均を取得
      let kpiText = "";
      let hasKpiData = false;
      try {
        // キャッシュからKPIデータ取得
        const { data: cache } = await supabase.from("report_data_cache").select("report_json").eq("shop_name", shop.name).maybeSingle();
        if (cache?.report_json) {
          const report = cache.report_json as any;
          const kpis = report.kpis || [];
          const labels = report.monthlyLabels || [];
          const curMonth = labels[labels.length - 1] || "";

          if (kpis.length > 0) {
            hasKpiData = true;
            // 前月比の増減率を計算
            const pctChange = (cur: number, prev: number) => {
              if (!prev || prev === 0) return "";
              const pct = Math.round(((cur - prev) / prev) * 100);
              return pct > 0 ? `+${pct}%` : `${pct}%`;
            };
            const kpiLines = kpis
              .filter((k: any) => {
                if (k.label?.includes("口コミ増減")) return false; // 口コミ増減は別で提供済み
                if (k.label?.includes("予約") && k.value === 0 && (k.momValue === 0 || k.momValue == null)) return false; // 予約0件は業種的に不要
                return true;
              })
              .map((k: any) => {
                const val = k.value?.toLocaleString() || "0";
                const unit = k.unit || "";
                let detail = "";
                if (k.momValue != null && k.momValue !== 0) {
                  detail += ` | 前月: ${k.momValue.toLocaleString()}${unit}（${pctChange(k.value, k.momValue)}）`;
                }
                if (k.yoyValue != null && k.yoyValue !== 0) {
                  detail += ` | 前年同月: ${k.yoyValue.toLocaleString()}${unit}（${pctChange(k.value, k.yoyValue)}）`;
                }
                return `${k.label}: ${val}${unit}${detail}`;
              });
            kpiText = `\n【レポートKPIデータ（${curMonth}）※コメント①で必ず全て言及すること】\n${kpiLines.join("\n")}`;
          } else {
            console.warn(`[analyze] ${shop.name}: report_data_cacheにkpis配列が空`);
          }

          // chartsデータから月次推移も追加（増減傾向の分析用）
          const charts = report.charts;
          if (charts && labels.length >= 2) {
            const recentLabels = labels.slice(-3);
            const getRecent = (arr: number[]) => arr ? arr.slice(-3) : [];
            const searchTrend = getRecent(charts.searchTotal || []);
            const mapTrend = getRecent(charts.mapTotal || []);
            if (searchTrend.length >= 2) {
              kpiText += `\n\n【直近3ヶ月の推移】`;
              kpiText += `\nGoogle検索: ${recentLabels.map((l: string, i: number) => `${l}=${searchTrend[i]?.toLocaleString() || 0}`).join(" → ")}`;
              kpiText += `\nGoogleマップ: ${recentLabels.map((l: string, i: number) => `${l}=${mapTrend[i]?.toLocaleString() || 0}`).join(" → ")}`;
            }

            // アクション率（アクション合計 ÷ マップ表示数）
            const lastIdx = labels.length - 1;
            const curMap = (charts.mapMobile?.[lastIdx] || 0) + (charts.mapPC?.[lastIdx] || 0);
            const curActions = (charts.websites?.[lastIdx] || 0) + (charts.routes?.[lastIdx] || 0) + (charts.calls?.[lastIdx] || 0);
            if (curMap > 0) {
              const actionRate = (curActions / curMap * 100).toFixed(2);
              kpiText += `\n\n【アクション率】\nアクション合計(Web+ルート+通話): ${curActions.toLocaleString()}件 ÷ マップ表示: ${curMap.toLocaleString()}回 = ${actionRate}%`;
              if (lastIdx >= 1) {
                const prevMap = (charts.mapMobile?.[lastIdx - 1] || 0) + (charts.mapPC?.[lastIdx - 1] || 0);
                const prevActions = (charts.websites?.[lastIdx - 1] || 0) + (charts.routes?.[lastIdx - 1] || 0) + (charts.calls?.[lastIdx - 1] || 0);
                if (prevMap > 0) {
                  const prevRate = (prevActions / prevMap * 100).toFixed(2);
                  kpiText += `（前月: ${prevRate}%）`;
                }
              }
              kpiText += `\n※アクション率はマップで見た人のうち何%が行動（Web/ルート/通話）に繋がったかを示す重要指標`;
            }
          }

          // 口コミ増加ペース（月間増加数の推移 — レポート対象月まで）
          const reviewDelta = report.reviewDelta;
          const reviewLabels = report.reviewLabels;
          if (reviewDelta && reviewDelta.length > 0 && reviewLabels && reviewLabels.length > 0) {
            // レポート対象月（curMonth="2026/4"）以降のデータを除外
            const curMonthNum = (() => { const p = curMonth.split("/"); return (parseInt(p[0]) || 0) * 100 + (parseInt(p[1]) || 0); })();
            // reviewLabelsは "1月","2月"等の形式。monthlyLabelsの年を参考に変換
            const baseYear = parseInt((labels[0] || "2026").split("/")[0]) || 2026;
            let trimIdx = reviewLabels.length;
            let runningYear = baseYear;
            for (let ri = 0; ri < reviewLabels.length; ri++) {
              const mMatch = (reviewLabels[ri] || "").match(/(\d{1,2})月/);
              if (mMatch) {
                const monthNum = parseInt(mMatch[1]);
                // 年を推定（12月→1月で年が繰り上がり、以降維持）
                if (ri > 0) {
                  const prevMatch = (reviewLabels[ri - 1] || "").match(/(\d{1,2})月/);
                  if (prevMatch && parseInt(prevMatch[1]) > monthNum) runningYear++;
                }
                const rNum = runningYear * 100 + monthNum;
                if (rNum > curMonthNum) { trimIdx = ri; break; }
              }
            }
            const trimmedDeltas = reviewDelta.slice(0, trimIdx);
            const trimmedLabels = reviewLabels.slice(0, trimIdx);
            const recentDeltas = trimmedDeltas.slice(-6).filter((d: number | null) => d !== null) as number[];
            if (recentDeltas.length > 0) {
              const avgDelta = (recentDeltas.reduce((a: number, b: number) => a + b, 0) / recentDeltas.length).toFixed(1);
              const lastDelta = trimmedDeltas[trimmedDeltas.length - 1];
              const recentLabelsRev = trimmedLabels.slice(-6);
              kpiText += `\n\n【口コミ月間増加ペース（新規投稿数/月）】`;
              kpiText += `\n直近6ヶ月: ${recentLabelsRev.map((l: string, i: number) => `${l}=+${trimmedDeltas.slice(-6)[i] ?? 0}`).join(", ")}`;
              const lastLabel = trimmedLabels[trimmedLabels.length - 1] || "当月";
              kpiText += `\n月平均: +${avgDelta} / ${lastLabel}: +${lastDelta ?? 0}`;
            }
          }

          // キーワード順位データ
          const kwData = report.keywords;
          const rankHistory = report.rankingHistory;
          if (kwData && kwData.length > 0) {
            kpiText += `\n\n【キーワード順位（当月）】`;
            for (const kw of kwData) {
              const diff = kw.prevRank > 0 && kw.rank > 0 ? kw.prevRank - kw.rank : 0;
              const arrow = diff > 0 ? `↑${diff}` : diff < 0 ? `↓${Math.abs(diff)}` : "→";
              kpiText += `\n${kw.word}: ${kw.rank > 0 ? `${kw.rank}位` : "圏外"}（前月${kw.prevRank > 0 ? `${kw.prevRank}位` : "圏外"} ${arrow}）`;
            }
          }

          // 検索語句の傾向（指名検索 vs 一般検索）
          const sq = report.searchQueries;
          if (sq?.latest && sq.latest.length > 0) {
            const top10 = sq.latest.slice(0, 10);
            const totalCount = sq.latest.reduce((s: number, q: any) => s + (q.count || 0), 0);
            // 指名検索の判定（店舗名の一部を含む）
            const shopWords = shop.name.toLowerCase().split(/[\s　]+/).filter((w: string) => w.length >= 2);
            const brandQueries = sq.latest.filter((q: any) => shopWords.some((w: string) => q.word?.toLowerCase().includes(w)));
            const brandCount = brandQueries.reduce((s: number, q: any) => s + (q.count || 0), 0);
            const brandPct = totalCount > 0 ? Math.round(brandCount / totalCount * 100) : 0;

            kpiText += `\n\n【検索語句分析（${sq.latestMonth || "当月"}）】`;
            kpiText += `\n総検索数: ${totalCount.toLocaleString()}回`;
            kpiText += `\nTOP5: ${top10.slice(0, 5).map((q: any) => `${q.word}(${q.count})`).join(", ")}`;
            kpiText += `\n指名検索（店舗名含む）: ${brandCount.toLocaleString()}回（${brandPct}%）`;
            kpiText += `\n一般検索: ${(totalCount - brandCount).toLocaleString()}回（${100 - brandPct}%）`;
            kpiText += `\n※一般検索100%は「新規顧客の発見チャネルとして機能している」ことを意味する。駅ナカ・商業施設内の飲食店では指名検索0%は一般的であり、必ずしもネガティブではない`;
          }
        } else {
          console.warn(`[analyze] ${shop.name}: report_data_cacheにデータなし`);
        }

        // 同グループ店舗の平均を取得（キャッシュ有無に関わらず実行）
        const { data: shopInfo } = await supabase.from("shops").select("business_group_id").eq("name", shop.name).maybeSingle();
        if (shopInfo?.business_group_id) {
          const { data: groupShops } = await supabase.from("shops").select("name").eq("business_group_id", shopInfo.business_group_id).neq("name", shop.name).limit(100);
          if (groupShops && groupShops.length > 0) {
            const groupNames = groupShops.map((s: any) => s.name);
            const { data: groupCaches } = await supabase.from("report_data_cache").select("report_json").in("shop_name", groupNames.slice(0, 50));
            if (groupCaches && groupCaches.length > 0) {
              let totalSearch = 0, totalMap = 0, totalAction = 0, gReviews = 0, gRating = 0, count = 0;
              for (const gc of groupCaches) {
                const gk = gc.report_json?.kpis || [];
                const search = gk.find((k: any) => k.label?.includes("検索"))?.value || 0;
                const map = gk.find((k: any) => k.label?.includes("マップ"))?.value || 0;
                const action = gk.find((k: any) => k.label?.includes("ルート") || k.label?.includes("通話") || k.label?.includes("ウェブ"))?.value || 0;
                const shopData = gc.report_json?.shop;
                totalSearch += search; totalMap += map; totalAction += action;
                if (shopData?.totalReviews) gReviews += shopData.totalReviews;
                if (shopData?.rating) gRating += shopData.rating;
                count++;
              }
              if (count > 0) {
                kpiText += `\n\n【同グループ平均（${count}店舗）※店舗名は記載しないこと】\nGoogle検索平均: ${Math.round(totalSearch / count).toLocaleString()}回\nGoogleマップ平均: ${Math.round(totalMap / count).toLocaleString()}回\nアクション合計平均: ${Math.round(totalAction / count).toLocaleString()}回`;
              }
            }
          }
        }

        // 同業種（カテゴリ）店舗の平均を取得
        const { data: catInfo } = await supabase.from("shops").select("gbp_main_category").eq("name", shop.name).not("gbp_main_category", "is", null).maybeSingle();
        if (catInfo?.gbp_main_category) {
          const category = catInfo.gbp_main_category;
          const { data: catShops } = await supabase.from("shops").select("name").eq("gbp_main_category", category).neq("name", shop.name).limit(200);
          if (catShops && catShops.length > 0) {
            const catNames = catShops.map((s: any) => s.name);
            const { data: catCaches } = await supabase.from("report_data_cache").select("report_json").in("shop_name", catNames.slice(0, 50));
            if (catCaches && catCaches.length > 0) {
              let tSearch = 0, tMap = 0, tAction = 0, tReviews = 0, tRating = 0, cnt = 0;
              for (const cc of catCaches) {
                const ck = cc.report_json?.kpis || [];
                const s = ck.find((k: any) => k.label?.includes("検索"))?.value || 0;
                const m = ck.find((k: any) => k.label?.includes("マップ"))?.value || 0;
                const a = ck.find((k: any) => k.label?.includes("ルート") || k.label?.includes("通話") || k.label?.includes("ウェブ"))?.value || 0;
                const shopData = cc.report_json?.shop;
                tSearch += s; tMap += m; tAction += a;
                if (shopData?.totalReviews) tReviews += shopData.totalReviews;
                if (shopData?.rating) tRating += shopData.rating;
                cnt++;
              }
              if (cnt > 0) {
                kpiText += `\n\n【同業種平均（${category} ${cnt}店舗）※店舗名は記載しないこと】\nGoogle検索平均: ${Math.round(tSearch / cnt).toLocaleString()}回\nGoogleマップ平均: ${Math.round(tMap / cnt).toLocaleString()}回\nアクション合計平均: ${Math.round(tAction / cnt).toLocaleString()}回`;
              }
            }
          }
        }
      } catch (kpiErr) {
        console.error(`[analyze] ${shop.name}: KPIデータ取得エラー:`, kpiErr);
      }

      console.log(`[analyze] ${shop.name}: kpiText=${kpiText ? `${kpiText.length}文字` : "空"}, hasKpiData=${hasKpiData}`);

      // Claude APIで分析
      const analysis = await analyzeWithClaude(
        shop.name,
        reviewData.reviews,
        officialRating,
        officialCount,
        reviewData.ratingDistribution,
        kpiText
      );

      if (!analysis) {
        results.push({ shopId: shop.id, shopName: shop.name, status: "analysis_failed" });
        continue;
      }

      // コメント・サマリー内の評価値を公式値で強制置換（DB保存前に確定させる）
      const ratingStr = String(officialRating);
      const fixRating = (text: string) => {
        // 全ての X.X を評価文脈で公式値に置換（最も単純で確実な方法）
        return text.replace(/\d\.\d/g, (match) => {
          const v = parseFloat(match);
          // 3.0〜5.0の範囲で公式値と異なる場合は置換（評価値の範囲）
          if (v >= 3.0 && v <= 5.0 && match !== ratingStr) return ratingStr;
          return match;
        });
      };
      if (analysis.comments) {
        analysis.comments = analysis.comments.map(fixRating);
      }
      if (analysis.summary) {
        analysis.summary = fixRating(analysis.summary);
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
            review_count: officialCount,
            average_rating: officialRating,
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
