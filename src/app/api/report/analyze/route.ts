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

  // KPIデータの有無でプロンプト構造を変える
  const hasKpi = !!(kpiText && kpiText.trim());

  const prompt = `あなたはMEO対策の専門家です。以下の店舗のレポート総評を作成してください。
これは「口コミ分析」ではなく「MEOレポート全体の総評」です。KPIデータ（検索数・マップ表示数・アクション数）と口コミの両方を必ず分析してください。

店舗名: ${shopName}
Google評価: ${averageRating} / 5.0（${totalReviewCount}件）

【正確な統計データ（以下の数値をcommentsで使用すること。独自に数えないでください）】
累計口コミ数: ${totalReviewCount}件（※同業種平均との比較にはこの累計値を使うこと）
直近1年の口コミ: ${totalRated}件（※口コミ傾向分析にはこの値を使うこと）
評価分布（直近1年）: ${statsText}
高評価(★4-5): ${positiveCount}件(${pctOf(positiveCount)}%)
低評価(★1-3): ${negativeCount}件(${pctOf(negativeCount)}%)
${kpiText || ""}

【口コミテキスト（直近1年・${filteredReviews.length}件）】
${reviewTexts}

【重要ルール（positiveWords / negativeWords）】
- 必ず口コミ原文に含まれる表現をそのまま抜き出してください。要約・言い換え・意訳は禁止。
- 例: 口コミに「スープが熱々で美味しかった」→ ○「スープが熱々」 ✕「温かいスープ」
- 各ワードは2〜8文字程度の短いフレーズ。
- positiveWordsは★4-5、negativeWordsは★1-3の口コミから抽出。
- それぞれ最低12個以上の候補を出してください（後で自動フィルタします）。

【出力形式】以下のJSON形式のみ出力してください。WordSourcesは不要です。
{
  "positiveWords": ["ポジ1", "ポジ2", ... "ポジ12"],
  "negativeWords": ["ネガ1", "ネガ2", ... "ネガ12"],
  "summary": "レポート全体の総評を1行で要約（50文字以内。KPI動向+口コミ傾向を両方含める）",
  "comments": [
    "コメント1: ${hasKpi ? "【必須】上記のKPIデータを使って、検索数・マップ表示数・アクション数（ウェブサイト/ルート/通話）の前月比・前年比を具体的な数値で分析。同業種平均・同グループ平均との比較も必ず含める。数値は上記データをそのまま引用すること" : "パフォーマンス概況（KPIデータ未取得のため口コミ動向から推定）"}",
    "コメント2: 口コミ傾向分析（評価分布の数値を引用し、高評価・低評価の傾向、具体的な声の紹介）",
    "コメント3: 強み（${hasKpi ? "KPIで同業種平均を上回る指標と、" : ""}口コミで評価されている点を具体的に）",
    "コメント4: 改善点（${hasKpi ? "KPIで前月比マイナスの指標や同業種平均を下回る指標と、" : ""}口コミで指摘されている課題）",
    "コメント5: 来月の具体的な施策提案（${hasKpi ? "KPI改善と" : ""}口コミ改善の両面から実行可能なアクション3〜4つ）"
  ]
}

【commentsのルール（厳守）】
- これはお客様に見せるMEOレポートの総評です。口コミ分析レポートではありません。
${hasKpi ? `- ★最重要★ コメント1は「検索数○○回（前月比○%）」「マップ表示○○回（前月比○%）」のように、上記KPIデータの具体的な数値を必ず引用してください。数値なしの抽象的な記述は禁止。
- コメント3・4でも、同グループ平均・同業種平均との比較を「検索数は同業種平均○○回に対し○○回で○%上回っている」のように定量的に記載。` : "- KPIデータが未取得のため、口コミデータを中心に分析してください（その旨は書かない）。"}
- 数値は必ず上記の統計データ・KPIデータの値をそのまま使用。独自計算は禁止。
- ★重要★ 口コミ数を同業種平均と比較する際は「累計口コミ数」（${totalReviewCount}件）を使うこと。「直近1年の口コミ」（${totalRated}件）は分析対象の件数であり、累計とは異なる。混同禁止。
- コメント内に口コミ参照番号（#1, #6等）を絶対に含めない。
- 具体的な口コミ引用は「○○という声がある」のように表現。
- 重要な数値や結論は<strong>タグで強調。`;

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
              .filter((k: any) => !k.label?.includes("口コミ増減")) // 口コミ増減は別で提供済み
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
            const searchTrend = getRecent(charts.searchTotal);
            const mapTrend = getRecent(charts.mapTotal);
            if (searchTrend.length >= 2) {
              kpiText += `\n\n【直近3ヶ月の推移】`;
              kpiText += `\nGoogle検索: ${recentLabels.map((l: string, i: number) => `${l}=${searchTrend[i]?.toLocaleString() || 0}`).join(" → ")}`;
              kpiText += `\nGoogleマップ: ${recentLabels.map((l: string, i: number) => `${l}=${mapTrend[i]?.toLocaleString() || 0}`).join(" → ")}`;
            }
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
                kpiText += `\n\n【同グループ平均（${count}店舗）※店舗名は記載しないこと】\nGoogle検索平均: ${Math.round(totalSearch / count).toLocaleString()}回\nGoogleマップ平均: ${Math.round(totalMap / count).toLocaleString()}回\nアクション合計平均: ${Math.round(totalAction / count).toLocaleString()}回\n口コミ数平均: ${Math.round(gReviews / count)}件\n評価平均: ${count > 0 && gRating > 0 ? (gRating / count).toFixed(1) : "-"}`;
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
                kpiText += `\n\n【同業種平均（${category} ${cnt}店舗）※店舗名は記載しないこと】\nGoogle検索平均: ${Math.round(tSearch / cnt).toLocaleString()}回\nGoogleマップ平均: ${Math.round(tMap / cnt).toLocaleString()}回\nアクション合計平均: ${Math.round(tAction / cnt).toLocaleString()}回\n口コミ数平均: ${Math.round(tReviews / cnt)}件\n評価平均: ${cnt > 0 && tRating > 0 ? (tRating / cnt).toFixed(1) : "-"}`;
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
      const fixRating = (text: string) =>
        text.replace(/(\d\.\d)\s*\/\s*5\.0/g, `${ratingStr}/5.0`);
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
