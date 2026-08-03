import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { withAudit, requireCtxShopAccess } from "@/lib/audit";
import { normalizeKw } from "@/lib/keyword-normalize";
import { centerCell, isYoyComparable, isAnomalousYoyBase } from "@/lib/report-utils";
import {
  buildAnalyzePrompt,
  parseAnalyzeText,
  applyFixRating,
  saveAnalysisRow,
  ANALYZE_MODEL,
  ANALYZE_MAX_TOKENS,
} from "@/lib/analyze-core";
import { submitAnalysisBatch, findPendingShopNames, type PreparedAnalysisItem } from "@/lib/analyze-batch-lib";
import {
  validatePageComments,
  buildCorrectionPrompt,
  buildKeywordFacts,
  type KeywordRankFacts,
  type MetricFact,
} from "@/lib/comment-validation";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5555";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";

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
// 注意: reviews.shop_id は Supabase UUID（sync-reviewsが設定）で、Go APIのshop.idとは
// 一致しないため、必ず shop_name で検索する（IDで引くと「口コミなし」誤判定になる）
async function fetchReviews(shopName: string): Promise<ReviewListResponse | null> {
  try {
    const supabase = getSupabase();
    // reviews.shop_name はNFCで保存されているため、NFD等で来ても一致するよう正規化
    const normalizedName = shopName.normalize("NFC");
    // 直近1年の口コミを取得
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    oneYearAgo.setDate(1);
    oneYearAgo.setHours(0, 0, 0, 0);

    // count:"exact"は別途カウントクエリが走り負荷が倍になるため使わない
    // （totalReviewCountはreviews.lengthで代替。idx_reviews_shop_name_time で高速）
    const { data: reviews, error: reviewErr } = await supabase
      .from("reviews")
      .select("review_id, reviewer_name, star_rating, comment, create_time")
      .eq("shop_name", normalizedName)
      .gte("create_time", oneYearAgo.toISOString())
      .not("comment", "is", null)
      .order("create_time", { ascending: false });

    if (reviewErr) {
      // 握り潰さず可視化（RLS/タイムアウト等の切り分け用）
      console.error(`[analyze] reviews query error for "${normalizedName}":`, JSON.stringify(reviewErr));
      throw new Error(`reviews-query: ${reviewErr.message || reviewErr.code || "unknown"}`);
    }
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
      totalReviewCount: reviews.length,
    };
  } catch (err) {
    console.error(`[analyze] fetchReviews error for shopName=${shopName}:`, err instanceof Error ? err.message : err);
    // 診断用: エラー内容を呼び出し元に伝える（no_reviewsとエラーを区別するため）
    throw err instanceof Error ? err : new Error(String(err));
  }
}

// Claude APIで分析（リトライ付き: 失敗時は件数を半分に減らして再試行）
async function analyzeWithClaude(
  shopName: string,
  reviews: GBPReview[],
  averageRating: number,
  totalReviewCount: number,
  ratingDistribution?: Record<number, number>,
  kpiText?: string,
  langStatsText?: string,
  /** 生成後の数値照合に使う元データ。未指定なら照合をスキップする */
  verifyCtx?: { keywordFacts: KeywordRankFacts[]; reviewDeltas: number[]; metricFacts?: MetricFact[] }
): Promise<{
  positiveWords: string[];
  negativeWords: string[];
  positiveWordSources: { word: string; reviews: { reviewer: string; comment: string; date: string; starRating: string }[] }[];
  negativeWordSources: { word: string; reviews: { reviewer: string; comment: string; date: string; starRating: string }[] }[];
  summary: string;
  comments: string[];
  pageComments?: import("@/lib/report-data").PageComments;
} | null> {
  if (!ANTHROPIC_API_KEY) return null;

  const allFiltered = reviews.filter((r) => r.comment && r.comment.trim());
  if (allFiltered.length === 0) return null;

  // 段階的リトライ: 全件 → 50件（最大2回、合計60秒以内に収める）
  const limits = allFiltered.length > 50 ? [allFiltered.length, 50] : [allFiltered.length];

  for (const limit of limits) {
    const result = await tryAnalyze(shopName, allFiltered.slice(0, limit), averageRating, totalReviewCount, ratingDistribution, kpiText, langStatsText);
    if (result) {
      return verifyCtx
        ? await enforceNumericAccuracy(shopName, result, verifyCtx, (correction) =>
            tryAnalyze(shopName, allFiltered.slice(0, limit), averageRating, totalReviewCount, ratingDistribution, kpiText, langStatsText, correction),
          )
        : result;
    }
    console.log(`[analyze] ${shopName}: ${limit}件で失敗、リトライ...`);
  }
  return null;
}

type AnalyzeResult = NonNullable<Awaited<ReturnType<typeof tryAnalyze>>>;

/**
 * 生成された総評の数値を元データと突き合わせ、食い違いがあれば再生成する。
 *
 * 「AIに渡すデータを正しくする」だけでは、AIが書く瞬間の取り違えは防げない。
 * 2026-08-01に「名古屋 バル」を実際は10位なのに9位と書いた例が出たため、
 * 出荷前の関門としてここで照合する。
 * 再生成しても直らない場合は、誤った数値を含むページの総評を破棄する。
 * 空欄になるのは痛いが、クライアントに誤った順位を出すよりはるかにましと判断した。
 */
async function enforceNumericAccuracy(
  shopName: string,
  first: AnalyzeResult,
  ctx: { keywordFacts: KeywordRankFacts[]; reviewDeltas: number[]; metricFacts?: MetricFact[] },
  regenerate: (correction: string) => Promise<AnalyzeResult | null>,
): Promise<AnalyzeResult> {
  const MAX_RETRY = 2;
  let current = first;

  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    const violations = validatePageComments(current.pageComments as Record<string, unknown>, ctx);
    if (violations.length === 0) {
      if (attempt > 0) console.log(`[analyze] ${shopName}: 数値照合OK（再生成${attempt}回）`);
      return current;
    }
    for (const v of violations) {
      console.warn(`[analyze] ${shopName}: 数値不一致(${v.field}) ${v.message}`);
    }
    if (attempt === MAX_RETRY) {
      // 直らなかったページの総評を落とす（誤った数値は出荷しない）
      const dropped = Array.from(new Set(violations.map((v) => v.field)));
      const pc = { ...(current.pageComments as Record<string, unknown>) };
      for (const f of dropped) pc[f] = "";
      console.error(
        `[analyze] ${shopName}: 再生成${MAX_RETRY}回でも数値が一致せず、該当ページの総評を空にした: ${dropped.join(", ")}`,
      );
      return { ...current, pageComments: pc as AnalyzeResult["pageComments"] };
    }
    const retried = await regenerate(buildCorrectionPrompt(violations));
    if (!retried) {
      console.error(`[analyze] ${shopName}: 数値修正の再生成に失敗（APIエラー）`);
      return current;
    }
    current = retried;
  }
  return current;
}

async function tryAnalyze(
  shopName: string,
  filteredReviews: GBPReview[],
  averageRating: number,
  totalReviewCount: number,
  ratingDistribution?: Record<number, number>,
  kpiText?: string,
  langStatsText?: string,
  /** 数値照合で不一致が出た場合の修正指示（再生成時のみ指定） */
  correction?: string
): Promise<any | null> {
  // プロンプト構築は src/lib/analyze-core.ts へ移設（Batch経路と共用）
  const finalPrompt = buildAnalyzePrompt(
    shopName, filteredReviews, averageRating, totalReviewCount,
    ratingDistribution, kpiText, langStatsText, correction,
  );
  if (!finalPrompt) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000); // 120秒タイムアウト（Sonnet用）
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      cache: "no-store" as const,
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANALYZE_MODEL,
        max_tokens: ANALYZE_MAX_TOKENS,
        messages: [{ role: "user", content: finalPrompt }],
      }),
    });

    clearTimeout(timeout);

    if (!res.ok) {
      console.error("[analyze] Claude API error:", res.status, res.statusText);
      return null;
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || "";
    // 応答のパース・ワード厳密検証・pageComments組み立ては src/lib/analyze-core.ts へ移設（Batch経路と共用）
    return parseAnalyzeText(text, filteredReviews);
  } catch (err) {
    console.error("[analyze] Claude error:", err);
    return null;
  }
}

// POST /api/report/analyze
export const POST = withAudit("AI口コミ分析", "PAID_OP", async (request, ctx) => {
  // リクエスト解析
  const body = await request.json();
  // 店名をNFCに正規化（フロント/Go API由来の店名がNFD＝濁点分解形だと、NFCで保存された
  // reviews.shop_name / report_data_cache.shop_name / shops.name と .eq 一致せず「口コミなし」になる）
  const shopIds: { id: string; name: string }[] = (body.shops || []).map((s: { id: string; name: string }) => ({
    id: s.id,
    name: typeof s.name === "string" ? s.name.normalize("NFC") : s.name,
  }));
  const forceReanalyze: boolean = body.force || false;
  const overrideTargetMonth: string = body.targetMonth || ""; // フロントから対象月を指定可能
  // Batchモード: Claudeを同期で呼ばず、材料を集めてBatch API（半額）へ一括投入する
  const batchPrepare: boolean = body.batchPrepare === true;
  const preparedItems: PreparedAnalysisItem[] = [];

  if (shopIds.length === 0) {
    return NextResponse.json({ error: "店舗が指定されていません" }, { status: 400 });
  }

  // 認可チェック: 指定店舗へのアクセス権を検証
  for (const shop of shopIds) {
    if (shop.name) {
      const shopErr = await requireCtxShopAccess(ctx, shop.name);
      if (shopErr) return shopErr;
    }
  }

  ctx.detail = `対象${shopIds.length}店舗: ${shopIds.map(s => s.name).filter(Boolean).slice(0, 5).join("、")}${shopIds.length > 5 ? ` 他${shopIds.length - 5}店舗` : ""}`;

  const supabase = getSupabase();

  // 【二重課金の防止】Batchは投入から取り込みまで最大1時間 report_analysis に行が出ないため、
  // 「押したか不安→リロード→もう一度押す」で全店が二重投入されうる。
  // 結果待ちの店舗はここで除外する（2026-08-02 レビュー指摘 H-3）
  const pendingNames = batchPrepare
    ? await findPendingShopNames(supabase, shopIds.map((s) => s.name).filter(Boolean))
    : new Set<string>();
  const results: { shopId: string; shopName: string; status: string; reason?: string }[] = [];

  // 今月分析済み店舗を取得（スキップ用）
  const thisMonthStart = new Date();
  thisMonthStart.setDate(1);
  thisMonthStart.setHours(0, 0, 0, 0);
  const { data: existingAnalysis } = await supabase
    .from("report_analysis")
    .select("shop_name, analyzed_at")
    .gte("analyzed_at", thisMonthStart.toISOString());
  const analyzedNames = new Set((existingAnalysis || []).map((a: any) => a.shop_name));

  // ── バッチ取得（N+1クエリ対策）──
  const allNames = shopIds.map(s => s.name).filter(Boolean);
  const allIds = shopIds.map(s => s.id).filter(Boolean);

  // 1. report_data_cache を一括取得
  const cacheMap = new Map<string, any>();
  if (allNames.length > 0) {
    const { data: allCaches } = await supabase
      .from("report_data_cache")
      .select("shop_name, report_json")
      .in("shop_name", allNames);
    for (const c of (allCaches || [])) cacheMap.set(c.shop_name, c.report_json);
  }

  // 1-b. レポート表示設定を一括取得（キーワードの表示ON/OFF）
  // レポートに描画されないKWをAIに渡すと「表に無いキーワードの総評」が生成され、
  // 顧客向け資料の整合性が崩れるため、フロントと同じ条件でフィルタする
  // （report_display_settings.shop_id は店舗名。display-settings/route.ts 参照）
  const kwVisibilityMap = new Map<string, Record<string, boolean>>();
  if (allNames.length > 0) {
    // shop_idはフロントがdecodeURIComponentしただけの店舗名（正規化なし）。
    // URL経由の名前はNFD（濁点分解形）で保存されている可能性があるため、
    // NFC/NFD両形でIN検索し、Mapのキーは必ずNFCに寄せる（reviews.shop_nameと同じ罠）
    const nameVariants = Array.from(new Set([...allNames, ...allNames.map(n => n.normalize("NFD"))]));
    const { data: dispRows, error: dispErr } = await supabase
      .from("report_display_settings")
      .select("shop_id, kw_visibility")
      .in("shop_id", nameVariants);
    if (dispErr) console.warn("[analyze] 表示設定の取得に失敗（全KWを対象に分析します）:", dispErr.message);
    for (const r of (dispRows || [])) kwVisibilityMap.set(String(r.shop_id).normalize("NFC"), (r.kw_visibility || {}) as Record<string, boolean>);
  }

  // 2. shops テーブルを一括取得（名前で検索 — Go API IDはSupabaseに存在しない可能性があるため名前を優先）
  const shopInfoByName = new Map<string, any>();
  const shopInfoById = new Map<string, any>();
  if (allNames.length > 0) {
    // ※shopsに存在する列のみselectすること。存在しない列（旧: rating, review_count）が混ざると
    //   クエリ全体がエラーになりマップが空のまま＝perf上書き・グリッド補完・グループ平均が
    //   全店舗で静かにスキップされる事故が起きていた（2026-07-16判明）
    const { data: allShopsByName, error: shopsErr } = await supabase
      .from("shops")
      .select("id, name, business_group_id, gbp_main_category")
      .in("name", allNames);
    if (shopsErr) console.error("[analyze] shops一括取得エラー（店舗マップが空になります）:", shopsErr.message);
    for (const s of (allShopsByName || [])) {
      shopInfoByName.set(s.name, s);
      shopInfoById.set(s.id, s);  // Supabase IDでも引けるようにする
    }
  }

  // 3. 比較対象（同業種）のキャッシュを一括取得
  //
  // 【グループ平均は2026-08-03に廃止】business_group_id は実運用では
  // 全店が自社（株式会社Chubby）に属しており、「グループ平均」＝焼肉店も脱毛サロンも
  // ごみ回収業も混ざった607店の平均だった。業種をまたいだマップ表示回数の比較は
  // 意味を持たないうえ、レポート上は「グループ平均」＝系列店の平均と誤読されるため、
  // 同業種（GBPメインカテゴリ）の比較だけを残した。
  const categories = new Set<string>();
  shopInfoByName.forEach(s => {
    if (s.gbp_main_category) categories.add(s.gbp_main_category);
  });

  // カテゴリ内店舗の名前とキャッシュ
  const catShopNamesMap = new Map<string, string[]>();
  if (categories.size > 0) {
    const { data: catShops } = await supabase
      .from("shops")
      .select("name, gbp_main_category")
      .in("gbp_main_category", Array.from(categories))
      .limit(1000);
    for (const cs of (catShops || [])) {
      const list = catShopNamesMap.get(cs.gbp_main_category) || [];
      list.push(cs.name);
      catShopNamesMap.set(cs.gbp_main_category, list);
    }
  }

  // 同業種店舗のキャッシュも一括取得
  const allRelatedNames = new Set<string>();
  Array.from(catShopNamesMap.values()).forEach(names => names.forEach(n => allRelatedNames.add(n)));
  const relatedNamesArr = Array.from(allRelatedNames).filter(n => !cacheMap.has(n));
  let relatedCacheMap = new Map<string, any>();
  if (relatedNamesArr.length > 0) {
    // 50件ずつ取得（Supabase .in() の制限対策）
    for (let i = 0; i < relatedNamesArr.length; i += 50) {
      const { data: chunk } = await supabase
        .from("report_data_cache")
        .select("shop_name, report_json")
        .in("shop_name", relatedNamesArr.slice(i, i + 50));
      for (const c of (chunk || [])) relatedCacheMap.set(c.shop_name, c.report_json);
    }
  }
  // cacheMap にマージ
  relatedCacheMap.forEach((v, k) => {
    if (!cacheMap.has(k)) cacheMap.set(k, v);
  });

  // 各店舗を逐次処理（Claude API呼び出しのみ逐次、DBクエリはバッチ済み）
  for (const shop of shopIds) {
    // Batch結果待ちの店舗は再投入しない（二重課金の防止）
    if (batchPrepare && pendingNames.has(shop.name)) {
      results.push({ shopId: shop.id, shopName: shop.name, status: "batch_pending", reason: "前回のBatch投入分が結果待ちのためスキップしました" });
      continue;
    }

    // 分析済みならスキップ（forceの場合は再分析）
    if (!forceReanalyze && analyzedNames.has(shop.name)) {
      results.push({ shopId: shop.id, shopName: shop.name, status: "already_done" });
      continue;
    }

    try {
      const reviewData = await fetchReviews(shop.name);
      if (!reviewData || !reviewData.reviews || reviewData.reviews.length === 0) {
        results.push({ shopId: shop.id, shopName: shop.name, status: "no_reviews", reason: "口コミデータなし（先に口コミ同期が必要）" });
        continue;
      }

      // Google公式評価を取得（report_data_cache > shops > DB口コミ計算 の優先順）
      let officialRating = reviewData.averageRating;
      let officialCount = reviewData.totalReviewCount;

      // 1. report_data_cacheから取得（スプレッドシート由来、最も正確）— バッチ済み
      const cachedReport = cacheMap.get(shop.name);
      if (cachedReport) {
        const shopInfoCached = (cachedReport as any).shop;
        if (shopInfoCached?.rating && shopInfoCached.rating > 0) {
          officialRating = shopInfoCached.rating;
          if (shopInfoCached.totalReviews) officialCount = shopInfoCached.totalReviews;
        }
      }

      // ※旧「2. shopsテーブルからのフォールバック」は削除（shopsにrating/review_count列は存在せず
      //   一度も機能していなかった。むしろ存在しない列のselectが店舗マップ全体を壊していた）

      console.log(`[analyze] ${shop.name}: officialRating=${officialRating}, officialCount=${officialCount}`);

      // KPIデータとグループ平均を取得
      let kpiText = "";
      // 生成後の数値照合に使う元データ（AIに渡したのと同じ値から組み立てる）
      let verifyKeywordFacts: KeywordRankFacts[] = [];
      let verifyReviewDeltas: number[] = [];
      let verifyMetricFacts: MetricFact[] = [];
      let hasKpiData = false;
      let curMonth = overrideTargetMonth; // フロント指定があればそれを使う
      try {
        // キャッシュからKPIデータ取得（バッチ済み）
        const cacheJson = cacheMap.get(shop.name);
        if (cacheJson) {
          const report = cacheJson as any;
          const kpis = report.kpis || [];
          const labels = report.monthlyLabels || [];
          if (!curMonth) curMonth = labels[labels.length - 1] || "";
          // ゼロ埋め正規化: "2026/06" → "2026/6"（perfLabels/monthlyLabelsの形式に合わせる）
          curMonth = curMonth.replace(/\/0+(\d)/, "/$1");

          // performance_metrics_cacheで上書き（フロントと同じデータソースを使用）
          // ※上書きに失敗するとreport_data_cacheの古い値で分析され、レポート表示と数値がズレる。
          //   失敗は必ずログに残す（silent catchで原因が見えなくなっていた）
          let perfCharts = report.charts;
          let perfLabels = labels;
          let perfOverlayApplied = false;
          try {
            const { getCachedPerformance } = await import("@/lib/gbp-performance");
            let shopRow = shopInfoByName.get(shop.name) || shopInfoById.get(shop.id);
            if (!shopRow?.id) {
              // バッチマップで解決できない場合は直接照会（表示側と同じ名前解決）
              const { data: direct } = await supabase.from("shops").select("id, name").eq("name", shop.name).limit(1).maybeSingle();
              if (direct?.id) shopRow = direct;
            }
            if (shopRow?.id) {
              const perfData = await getCachedPerformance(shopRow.id, shop.name);
              if (perfData.length > 0) {
                perfLabels = perfData.map((p: any) => p.month);
                perfCharts = {
                  searchMobile: perfData.map((p: any) => p.searchMobile),
                  searchPC: perfData.map((p: any) => p.searchPC),
                  mapMobile: perfData.map((p: any) => p.mapMobile),
                  mapPC: perfData.map((p: any) => p.mapPC),
                  calls: perfData.map((p: any) => p.calls),
                  routes: perfData.map((p: any) => p.routes),
                  websites: perfData.map((p: any) => p.websites),
                  foodMenus: perfData.map((p: any) => p.foodMenus),
                  bookings: perfData.map((p: any) => p.bookings),
                };
                perfOverlayApplied = true;
              } else {
                console.warn(`[analyze] ${shop.name}: performance_metrics_cacheが0件（shop_id=${shopRow.id}）`);
              }
            } else {
              console.warn(`[analyze] ${shop.name}: shopsテーブルで店舗名を解決できず（perf上書きスキップ）`);
            }
          } catch (perfErr: any) {
            console.error(`[analyze] ${shop.name}: perf上書きエラー:`, perfErr?.message || perfErr);
          }
          if (!perfOverlayApplied) {
            console.warn(`[analyze] ${shop.name}: KPIはreport_data_cache由来の値で分析（レポート表示と数値がズレる可能性）`);
          }

          // chartsから対象月のKPIを再構成
          const targetIdx0 = curMonth ? perfLabels.indexOf(curMonth) : perfLabels.length - 1;
          // 前年比は表示側（P1カード）と同じ条件でのみAIに渡す。
          // これが無いと、カードは「前年比なし（前年データが不完全）」なのに
          // AI総評だけが「+3989.4%の大幅増」と書く（2026-08-01 CHILLRI堀江店で発覚した型）。
          const shopStartDate = (report.shop as any)?.startDate as string | undefined;
          const gateYoy = (list: any[]) =>
            (list || []).map((k: any) =>
              isYoyComparable(k?.yoyValue, curMonth, shopStartDate) ? k : { ...k, yoyValue: null },
            );
          const effectiveKpis = gateYoy((() => {
            if (targetIdx0 < 0) return kpis;
            const c = perfCharts;
            const ci = targetIdx0;
            const pi = ci >= 1 ? ci - 1 : -1;
            const v = (arr: number[], idx: number) => arr?.[idx] ?? 0;
            return [
              { label: "Google検索 合計", value: v(c.searchMobile, ci) + v(c.searchPC, ci), momValue: pi >= 0 ? v(c.searchMobile, pi) + v(c.searchPC, pi) : null, yoyValue: ci >= 12 ? v(c.searchMobile, ci - 12) + v(c.searchPC, ci - 12) : null, unit: "回" },
              { label: "Googleマップ 合計", value: v(c.mapMobile, ci) + v(c.mapPC, ci), momValue: pi >= 0 ? v(c.mapMobile, pi) + v(c.mapPC, pi) : null, yoyValue: ci >= 12 ? v(c.mapMobile, ci - 12) + v(c.mapPC, ci - 12) : null, unit: "回" },
              { label: "ウェブサイトクリック", value: v(c.websites, ci), momValue: pi >= 0 ? v(c.websites, pi) : null, yoyValue: ci >= 12 ? v(c.websites, ci - 12) : null, unit: "件" },
              { label: "ルート検索", value: v(c.routes, ci), momValue: pi >= 0 ? v(c.routes, pi) : null, yoyValue: ci >= 12 ? v(c.routes, ci - 12) : null, unit: "件" },
              { label: "通話", value: v(c.calls, ci), momValue: pi >= 0 ? v(c.calls, pi) : null, yoyValue: ci >= 12 ? v(c.calls, ci - 12) : null, unit: "件" },
              { label: "フードメニュークリック", value: v(c.foodMenus, ci), momValue: pi >= 0 ? v(c.foodMenus, pi) : null, yoyValue: ci >= 12 ? v(c.foodMenus, ci - 12) : null, unit: "件" },
            ];
          })());

          // 前年同月が異常値（前後の中央値の3倍超）のKPIは前年比をAIに渡さない。
          // カード側は「参考値」の注記付きで表示するが、AIは注記を付けずに
          // 「前年比-67.4%と大幅減」のような断定的な総評を書いてしまうため
          if (targetIdx0 >= 12) {
            const c2 = perfCharts;
            const yi = targetIdx0 - 12;
            const sum2 = (a: number[], b: number[]) => (a || []).map((v: number, i: number) => (v || 0) + (b?.[i] || 0));
            const seriesFor = (label: string): number[] | null =>
              label.includes("ルート") ? c2.routes
              : label.includes("検索") ? sum2(c2.searchMobile, c2.searchPC)
              : label.includes("マップ") ? sum2(c2.mapMobile, c2.mapPC)
              : label.includes("ウェブ") ? c2.websites
              : label.includes("通話") ? c2.calls
              : label.includes("メニュー") ? c2.foodMenus
              : null;
            for (const k of effectiveKpis as any[]) {
              const s = seriesFor(k.label || "");
              if (s && k.yoyValue != null && isAnomalousYoyBase(s, yi)) k.yoyValue = null;
            }
          }

          // 「唯一の前年超え」等の排他的主張の照合用。AIに渡すのと同じ値から計算する
          verifyMetricFacts = effectiveKpis.map((k: any) => ({
            label: k.label,
            momPct: k.momValue != null && k.momValue !== 0 ? ((k.value - k.momValue) / k.momValue) * 100 : null,
            yoyPct: k.yoyValue != null && k.yoyValue !== 0 ? ((k.value - k.yoyValue) / k.yoyValue) * 100 : null,
          }));

          if (effectiveKpis.length > 0) {
            hasKpiData = true;
            // 前月比の増減率を計算
            const pctChange = (cur: number, prev: number) => {
              if (!prev || prev === 0) return "";
              const pct = Math.round(((cur - prev) / prev) * 100);
              return pct > 0 ? `+${pct}%` : `${pct}%`;
            };
            const kpiLines = effectiveKpis
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

          // chartsデータから月次推移も追加（増減傾向の分析用。前年スパイク等の異常値確認のため13ヶ月分渡す）
          if (perfCharts && perfLabels.length >= 2) {
            // curMonthのインデックスを特定（override時は末尾とは限らない）
            const targetIdx = curMonth ? perfLabels.indexOf(curMonth) : -1;
            const effectiveLastIdx = targetIdx >= 0 ? targetIdx : perfLabels.length - 1;
            const startIdx = Math.max(0, effectiveLastIdx - 12);
            const recentLabels = perfLabels.slice(startIdx, effectiveLastIdx + 1);
            const getRecent = (arr: number[]) => arr ? arr.slice(startIdx, effectiveLastIdx + 1) : [];
            const searchTrend = getRecent(perfCharts.searchMobile?.map((v: number, i: number) => v + (perfCharts.searchPC?.[i] || 0)) || []);
            const mapTrend = getRecent(perfCharts.mapMobile?.map((v: number, i: number) => v + (perfCharts.mapPC?.[i] || 0)) || []);
            if (searchTrend.length >= 2) {
              kpiText += `\n\n【直近${recentLabels.length}ヶ月の推移】`;
              kpiText += `\nGoogle検索: ${recentLabels.map((l: string, i: number) => `${l}=${searchTrend[i]?.toLocaleString() || 0}`).join(" → ")}`;
              kpiText += `\nGoogleマップ: ${recentLabels.map((l: string, i: number) => `${l}=${mapTrend[i]?.toLocaleString() || 0}`).join(" → ")}`;
            }

            // アクション率（アクション合計 ÷ マップ表示数）
            const lastIdx = effectiveLastIdx;
            const curMap = (perfCharts.mapMobile?.[lastIdx] || 0) + (perfCharts.mapPC?.[lastIdx] || 0);
            const curActions = (perfCharts.websites?.[lastIdx] || 0) + (perfCharts.routes?.[lastIdx] || 0) + (perfCharts.calls?.[lastIdx] || 0) + (perfCharts.foodMenus?.[lastIdx] || 0) + (perfCharts.bookings?.[lastIdx] || 0);
            if (curMap > 0) {
              const actionRate = (curActions / curMap * 100).toFixed(2);
              kpiText += `\n\n【アクション率】\nアクション合計(Web+ルート+通話+メニュー+予約): ${curActions.toLocaleString()}件 ÷ マップ表示: ${curMap.toLocaleString()}回 = ${actionRate}%`;
              if (lastIdx >= 1) {
                const prevMap = (perfCharts.mapMobile?.[lastIdx - 1] || 0) + (perfCharts.mapPC?.[lastIdx - 1] || 0);
                const prevActions = (perfCharts.websites?.[lastIdx - 1] || 0) + (perfCharts.routes?.[lastIdx - 1] || 0) + (perfCharts.calls?.[lastIdx - 1] || 0) + (perfCharts.foodMenus?.[lastIdx - 1] || 0) + (perfCharts.bookings?.[lastIdx - 1] || 0);
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
            // reviewLabelsは "2026/7" 形式と "7月" 形式の両方がある。
            // 以前は "N月" 形式しか処理せず、"2026/7" 形式が素通しになっていた。
            // その結果、6月レポートに7月(+0)が混入して「月平均+7.8件」
            // 「2026年7月は新規投稿ゼロ」という表示期間外の総評が生成された（2026-08-02）
            const baseYear = parseInt((labels[0] || "2026").split("/")[0]) || 2026;
            let trimIdx = reviewLabels.length;
            let runningYear = baseYear;
            for (let ri = 0; ri < reviewLabels.length; ri++) {
              const label = reviewLabels[ri] || "";
              let rNum = 0;
              if (label.includes("/")) {
                // "2026/7" 形式: そのまま数値化
                const p = label.split("/");
                rNum = (parseInt(p[0]) || 0) * 100 + (parseInt(p[1]) || 0);
              } else {
                const mMatch = label.match(/(\d{1,2})月/);
                if (mMatch) {
                  const monthNum = parseInt(mMatch[1]);
                  // 年を推定（12月→1月で年が繰り上がり、以降維持）
                  if (ri > 0) {
                    const prevMatch = (reviewLabels[ri - 1] || "").match(/(\d{1,2})月/);
                    if (prevMatch && parseInt(prevMatch[1]) > monthNum) runningYear++;
                  }
                  rNum = runningYear * 100 + monthNum;
                }
              }
              if (rNum > curMonthNum) { trimIdx = ri; break; }
            }
            const trimmedDeltas = reviewDelta.slice(0, trimIdx);
            // 数値照合（validateMonthlyAverage）もAIに渡したのと同じ窓で行う
            verifyReviewDeltas = trimmedDeltas.filter((d: number | null) => typeof d === "number") as number[];
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

            // 口コミ累計件数の推移（「口コミ件数推移」ページのコメント生成用）
            const reviewCounts = report.reviewCounts;
            if (Array.isArray(reviewCounts) && reviewCounts.length > 0) {
              const trimmedCounts = reviewCounts.slice(0, trimIdx);
              const recentCounts = trimmedCounts.slice(-6);
              const recentCountLabels = trimmedLabels.slice(-6);
              if (recentCounts.length > 0) {
                kpiText += `\n\n【口コミ累計件数の推移】`;
                kpiText += `\n直近${recentCounts.length}ヶ月: ${recentCountLabels.map((l: string, i: number) => `${l}=${recentCounts[i] ?? 0}件`).join(" → ")}`;
                kpiText += `\n※累計が減る月は既存口コミの削除・非表示を意味する（投稿ゼロとは異なる）`;
              }
            }
          }

          // キーワード順位データ（DBからリアルタイム取得 — フロントと同じデータソース）
          try {
            // フロントと同じ2段階でgridRankingを構築: DB取得 → rankingHistoryで補完
            let gridRanking = report.gridRanking;
            try {
              const shopRowGrid = shopInfoByName.get(shop.name) || shopInfoById.get(shop.id);
              if (shopRowGrid?.id) {
                const shopRow = shopRowGrid;
                const { fetchGridRankingLive, supplementGridFromRanking } = await import("@/lib/report-api");
                const liveGrid = await fetchGridRankingLive([shopRow.id], shop.name);
                if (liveGrid && liveGrid.history.length > 0) gridRanking = liveGrid;
                // rankingHistoryから補完（5月データはここで追加される）
                if (report.rankingHistory) {
                  gridRanking = supplementGridFromRanking(gridRanking, report.rankingHistory);
                }
              }
            } catch {}
            const targetNorm = (curMonth || "").replace(/\/0+(\d)/, "/$1");
            let kwData: { word: string; rank: number; prevRank: number; first?: boolean }[] = [];
            // kwDataが実際にどの月の計測なのか。対象月が未計測なら過去月になる。
            // これを見出しに反映しないと、P6カードが「未計測」なのにAI総評だけが
            // 先月の順位を当月の実績として書く（表示とAIの食い違い）
            let kwDataMonth = "";

            if (gridRanking?.history?.length > 0) {
              // 対象月以前のデータのみ使用
              const monthToNum = (m: string) => { const p = m.split("/"); return (parseInt(p[0]) || 0) * 100 + (parseInt(p[1]) || 0); };
              const targetNum = monthToNum(targetNorm);
              const filtered = gridRanking.history.filter((h: any) => monthToNum(h.month) <= targetNum);
              if (filtered.length > 0) {
                const latest = filtered[filtered.length - 1];
                const prev = filtered.length >= 2 ? filtered[filtered.length - 2] : null;
                // 統一系列(P6/P7)と同じ優先順位: グリッド中心が圏外(0)でもシート順位があればそちらを採用
                // （これが無いとP6/P7は「47位」なのにAIコメントは「圏外へ転落」と書くレポート内矛盾が起きる）
                const rh = report.rankingHistory;
                const sheetRankAt = (kwWord: string, month: string): number => {
                  if (!rh?.labels?.length) return 0;
                  const mi = rh.labels.indexOf(month);
                  if (mi < 0) return 0;
                  const ds = (rh.datasets || []).find((d: any) => normalizeKw(d.word) === normalizeKw(kwWord));
                  const r = ds ? ds.ranks[mi] : null;
                  return r && r > 0 ? r : 0;
                };
                // グリッドに前回計測が無くても、シート側に過去の計測記録
                // （順位 or 明示的な「圏外」）があれば「初計測」ではない。
                // 圏外→1位の復帰を「初計測」と伝えるとAIも中立に書いてしまい、
                // P6カードの「圏外→↑1位」表示と食い違う（2026-08-01 CHILLRI堀江店）
                const sheetPrior = (kwWord: string, beforeMonth: string): { rank: number; measured: boolean } => {
                  if (!rh?.labels?.length) return { rank: 0, measured: false };
                  const bi = rh.labels.indexOf(beforeMonth);
                  const end = bi >= 0 ? bi : rh.labels.length;
                  const ds = (rh.datasets || []).find((d: any) => normalizeKw(d.word) === normalizeKw(kwWord));
                  if (!ds) return { rank: 0, measured: false };
                  for (let i = end - 1; i >= 0; i--) {
                    const r = ds.ranks[i];
                    if (r && r > 0) return { rank: r, measured: true };
                    if (ds.outOfRange?.[i] === true) return { rank: 0, measured: true };
                  }
                  return { rank: 0, measured: false };
                };
                for (const snap of (latest.snapshots || [])) {
                  // centerCell: 偶数グリッド（斜め4地点計測）は中心なし→シート順位フォールバック
                  const center = centerCell(snap.results as any[], snap.gridSize);
                  let rank = center?.rank || 0;
                  if (rank === 0) rank = sheetRankAt(snap.keyword, latest.month);
                  let prevRank = rank;
                  let hasPrevSnap = false;
                  if (prev?.snapshots) {
                    const prevSnap = prev.snapshots.find((s: any) => s.keyword === snap.keyword);
                    if (prevSnap) {
                      hasPrevSnap = true;
                      const prevCenter = centerCell(prevSnap.results as any[], prevSnap.gridSize);
                      prevRank = prevCenter?.rank || 0;
                      if (prevRank === 0) prevRank = sheetRankAt(snap.keyword, prev.month);
                    }
                  }
                  let first = !hasPrevSnap;
                  if (first) {
                    const prior = sheetPrior(snap.keyword, latest.month);
                    if (prior.measured) { first = false; prevRank = prior.rank; } // rank=0なら「前回圏外」として渡る
                  }
                  // 圏外(rank=0)も含める: 圏外転落はAIコメントで言及すべき重要な変動のため
                  // 前回計測なし＝初計測（prevRank=rankのフォールバックを「維持」と誤読させない）
                  kwData.push({ word: snap.keyword, rank, prevRank: first ? (prevRank || rank) : prevRank, first });
                }
                kwDataMonth = latest.month;
                // 全KWが圏外のみの月でもkwDataは有効（後続のシートフォールバックに落とさない）
              }
            }

            // gridRankingにデータがなければシート/キャッシュからフォールバック
            if (kwData.length === 0) {
              const { fetchRankingFromSheets } = await import("@/lib/ranking-fetch");
              const freshRanks = await fetchRankingFromSheets(shop.name);
              kwData = freshRanks.length > 0 ? freshRanks : (report.keywords || []);
            }

            // ── レポート表示設定でフィルタ（フロント client.tsx の visibleKeywords / visibleGridRanking と同条件）──
            // 非表示KWをAIに渡すと「レポートの表に無いキーワードの総評」が生成されてしまう
            const kwVis = kwVisibilityMap.get(shop.name) || {};
            // 明示設定があれば従う。無ければdefaultVisibleに委ねる（ページごとにフロントの既定が異なる）
            const kwVisSetting = (word: string): boolean | undefined => kwVis[normalizeKw(word)] ?? kwVis[word];
            const kwRankLookup = new Map(kwData.map(k => [normalizeKw(k.word), k]));
            // キーワード順位変動ページ: 既定 = rank>0 || prevRank>0（client.tsx visibleKeywords と同条件）
            kwData = kwData.filter(kw => kwVisSetting(kw.word) ?? (kw.rank > 0 || kw.prevRank > 0));

            // 圏外転落/復帰も明示する行フォーマット（前回=直近の計測回。前月とは限らない）
            const fmtKwLine = (kw: { word: string; rank: number; prevRank: number; first?: boolean }) => {
              if (kw.first) {
                return `\n${kw.word}: ${kw.rank > 0 ? `${kw.rank}位` : "圏外"}（初計測・前回データなし）`;
              }
              const d = kw.prevRank - kw.rank;
              const arrow = kw.prevRank > 0 && kw.rank > 0
                ? (d > 0 ? `↑${d}` : d < 0 ? `↓${Math.abs(d)}` : "→")
                : kw.prevRank > 0 && kw.rank <= 0 ? "圏外へ転落"
                : kw.prevRank <= 0 && kw.rank > 0 ? "圏内に復帰" : "→";
              return `\n${kw.word}: ${kw.rank > 0 ? `${kw.rank}位` : "圏外"}（前回${kw.prevRank > 0 ? `${kw.prevRank}位` : "圏外"} ${arrow}）`;
            };
            // 数値照合用: AIに渡すのと同じ順位データから許容値を組み立てる。
            // ここで作らないと「AIには渡したが照合には無い順位」が偽陽性になる
            verifyKeywordFacts = buildKeywordFacts(kwData, report.rankingHistory);
            // verifyReviewDeltas は口コミ増加ペースのブロックで対象月までに
            // トリムした値を設定済み。ここで全期間版に上書きすると、
            // AIが見ていない月（対象月より後）まで照合の許容範囲に入ってしまう。
            // 口コミブロックが実行されなかった場合のみフォールバックで設定する
            if (verifyReviewDeltas.length === 0) {
              verifyReviewDeltas = (report.reviewDelta || [])
                .filter((d: number | null) => typeof d === "number") as number[];
            }

            if (kwData.length > 0) {
              // 対象月が未計測で過去月のデータを使っている場合は、その月を見出しに出し
              // 「当月の実績ではない」と明示する。P6カードは同条件で「未計測」と表示される
              const isStaleMonth = !!kwDataMonth && !!targetNorm && kwDataMonth !== targetNorm;
              kpiText += `\n\n【キーワード順位（${isStaleMonth ? kwDataMonth : curMonth}）】`;
              if (isStaleMonth) {
                kpiText += `\n※${curMonth}は未計測のため、直近計測月（${kwDataMonth}）の順位。`
                  + `${curMonth}の順位として書くことは禁止。レポート上も${curMonth}は「未計測」と表示される`;
              }
              for (const kw of kwData) kpiText += fmtKwLine(kw);
            }

            // キーワード順位の複数月推移（「キーワード順位推移」ページのコメント生成用）
            // これが無いとAIはトレンドを書けず、当月変動＝キーワード順位変動ページと同じ内容になる
            try {
              const rh2 = report.rankingHistory;
              if (rh2?.labels?.length >= 2 && Array.isArray(rh2.datasets)) {
                const tIdx = rh2.labels.indexOf(targetNorm);
                const endIdx = tIdx >= 0 ? tIdx : rh2.labels.length - 1;
                const startIdx = Math.max(0, endIdx - 5);
                const lbls = rh2.labels.slice(startIdx, endIdx + 1);
                // 「圏外」と「未計測」を区別してAIに渡す。
                // 一律「-」で渡すとAIが未計測月を「圏外に沈んだ」と推測で書く
                // （2026-07-31 Queency: 未計測の2026/5を圏外と断定するコメントが生成された）。
                // 判定材料: シートの明示的な「圏外」記録(outOfRange) + グリッド計測があった月
                const gridMeasured = new Map<string, Set<string>>(); // 正規化KW -> 計測があった月
                // 正規化KW|月 -> グリッド中心順位。シートが空の月でもここに順位があれば
                // 「圏外」ではなくその順位を渡す（P6/P7の合成順序と揃える）
                const gridRankAt = new Map<string, number>();
                for (const h of gridRanking?.history || []) {
                  for (const s of h.snapshots || []) {
                    if (Array.isArray(s.results) && s.results.length > 0) {
                      const k = normalizeKw(s.keyword);
                      if (!gridMeasured.has(k)) gridMeasured.set(k, new Set());
                      gridMeasured.get(k)!.add(h.month);
                      const center = centerCell(s.results as any[], s.gridSize);
                      if (center?.rank && center.rank > 0) gridRankAt.set(`${k}|${h.month}`, center.rank);
                    }
                  }
                }
                const lines: string[] = [];
                // 照合用: AIに渡す系列（表示ウィンドウ＋グリッド補完後）をそのまま持つ。
                // report.rankingHistory 全期間で照合すると、AIが見ていない過去月を根拠に
                // 「一度も下げていない」等を誤検知する（タスク#17）
                const mergedDatasets: { word: string; ranks: (number | null)[]; outOfRange: boolean[] }[] = [];
                for (const ds of rh2.datasets) {
                  // 順位推移ページ: 既定 = 系列にデータがあれば表示（client.tsx visibleRankingDatasets と同条件）
                  if (kwVisSetting(ds.word) === false) continue;
                  const ranks = ds.ranks.slice(startIdx, endIdx + 1);
                  const kwKey = normalizeKw(ds.word);
                  const gridRankFor = (l: string) => gridRankAt.get(`${kwKey}|${l}`) || 0;
                  // シート側に順位が無くてもグリッド計測で順位が付いていれば系列として有効
                  const hasAnyRank =
                    ranks.some((r: number | null) => r !== null && r > 0) ||
                    lbls.some((l: string) => gridRankFor(l) > 0);
                  if (!hasAnyRank) continue;
                  const oor: boolean[] | undefined = (ds as any).outOfRange?.slice(startIdx, endIdx + 1);
                  const gm = gridMeasured.get(kwKey);
                  const cell = (l: string, i: number) => {
                    const r = ranks[i];
                    if (r && r > 0) return `${r}位`;
                    // シートが空でもグリッドで順位が取れていればそれを使う。
                    // これが無いと表示は「1位」なのにAIには「圏外」と渡り、総評が真逆になる
                    const g = gridRankFor(l);
                    if (g > 0) return `${g}位`;
                    return (oor?.[i] === true || gm?.has(l)) ? "圏外" : "未計測";
                  };
                  // cell() と同じ判定で照合用系列を作る（number=順位 / 0=圏外 / null=未計測）
                  mergedDatasets.push({
                    word: ds.word,
                    ranks: lbls.map((l: string, i: number) => {
                      const r = ranks[i];
                      if (r && r > 0) return r;
                      const g = gridRankFor(l);
                      return g > 0 ? g : null;
                    }),
                    outOfRange: lbls.map((l: string, i: number) => {
                      const r = ranks[i];
                      if ((r && r > 0) || gridRankFor(l) > 0) return false;
                      return oor?.[i] === true || gm?.has(l) === true;
                    }),
                  });
                  lines.push(`\n${ds.word}: ${lbls.map((l: string, i: number) => `${l}=${cell(l, i)}`).join(" → ")}`);
                }
                if (lines.length > 0) {
                  kpiText += `\n\n【キーワード順位の推移（直近${lbls.length}計測）】${lines.join("")}`;
                  kpiText += `\n※「未計測」はデータが無いだけで圏外という意味ではない。未計測の月を「圏外に沈んだ」「転落した」等と書くことは禁止。当月単体ではなく複数月の傾向（連続下降/底打ち/安定）を読むための系列`;
                  // 照合の許容順位・系列をAIが実際に見たものに揃える
                  verifyKeywordFacts = buildKeywordFacts(kwData, { labels: lbls, datasets: mergedDatasets });
                }
              }
            } catch {}

            // 多地点グリッド計測のサマリー統計（「多地点順位」ページのコメント生成用）
            try {
              const monthToNum2 = (m: string) => { const p = m.split("/"); return (parseInt(p[0]) || 0) * 100 + (parseInt(p[1]) || 0); };
              const targetNum2 = monthToNum2(targetNorm);
              const gHist = (gridRanking?.history || []).filter((h: any) => monthToNum2(h.month) <= targetNum2);
              const gLatest = gHist.length > 0 ? gHist[gHist.length - 1] : null;
              const snaps = (gLatest?.snapshots || [])
                .filter((s: any) => Array.isArray(s.results) && s.results.length > 0)
                // グリッドも表示設定でフィルタ。既定はclient.tsx effVisibleと同条件
                // （kwDataにあればrank>0||prevRank>0、無ければtrue）
                .filter((s: any) => {
                  const v = kwVisSetting(s.keyword);
                  if (v !== undefined) return v;
                  const entry = kwRankLookup.get(normalizeKw(s.keyword));
                  return entry ? (entry.rank > 0 || entry.prevRank > 0) : true;
                });
              if (snaps.length > 0) {
                kpiText += `\n\n【多地点グリッド計測（${gLatest.month}）】`;
                for (const s of snaps) {
                  const pts = s.results as { rank: number }[];
                  const inRange = pts.filter(p => p.rank > 0);
                  const top3 = inRange.filter(p => p.rank <= 3).length;
                  const top10 = inRange.filter(p => p.rank <= 10).length;
                  const out = pts.length - inRange.length;
                  const avg = inRange.length > 0 ? (inRange.reduce((a, p) => a + p.rank, 0) / inRange.length).toFixed(1) : "圏外";
                  kpiText += `\n「${s.keyword}」: ${pts.length}地点中 平均${avg}位 / 1-3位${top3}地点 / 10位以内${top10}地点 / 圏外${out}地点`;
                }
                kpiText += `\n※周辺エリアのどこから検索されても上位に出るかを見る指標。圏外地点が多いほど商圏の取りこぼしが大きい`;
              }
            } catch {}
          } catch {
            // フォールバック: キャッシュのデータを使用
            const kwData = report.keywords;
            if (kwData && kwData.length > 0) {
              kpiText += `\n\n【キーワード順位（${curMonth}）】`;
              for (const kw of kwData) {
                const d = kw.prevRank - kw.rank;
                const arrow = kw.prevRank > 0 && kw.rank > 0
                  ? (d > 0 ? `↑${d}` : d < 0 ? `↓${Math.abs(d)}` : "→")
                  : kw.prevRank > 0 && kw.rank <= 0 ? "圏外へ転落"
                  : kw.prevRank <= 0 && kw.rank > 0 ? "圏内に復帰" : "→";
                kpiText += `\n${kw.word}: ${kw.rank > 0 ? `${kw.rank}位` : "圏外"}（前回${kw.prevRank > 0 ? `${kw.prevRank}位` : "圏外"} ${arrow}）`;
              }
            }
          }

          // 検索語句の傾向（指名検索 vs 一般検索）
          const sq = report.searchQueries;
          if (sq?.latest && sq.latest.length > 0) {
            const top10 = sq.latest.slice(0, 10);
            // 全キーワード合計を使用（sq.latestは上位30件のみ、historyの対象月エントリが全件）
            const targetMonthEntry = sq.history?.find((h: any) => h.month === (curMonth || sq.latestMonth));
            const allKeywords = targetMonthEntry?.keywords || sq.latest;
            const totalCount = allKeywords.reduce((s: number, q: any) => s + (q.count || 0), 0);
            // 指名検索の判定（店舗名の一部を含む）
            const shopWords = shop.name.toLowerCase().split(/[\s　]+/).filter((w: string) => w.length >= 2);
            const brandQueries = allKeywords.filter((q: any) => shopWords.some((w: string) => q.word?.toLowerCase().includes(w)));
            const brandCount = brandQueries.reduce((s: number, q: any) => s + (q.count || 0), 0);
            const brandPct = totalCount > 0 ? Math.round(brandCount / totalCount * 100) : 0;

            kpiText += `\n\n【検索語句分析（${sq.latestMonth || "当月"}）】`;
            kpiText += `\n総検索数: ${totalCount.toLocaleString()}回`;
            kpiText += `\nTOP5: ${top10.slice(0, 5).map((q: any) => `${q.word}(${q.count})`).join(", ")}`;
            kpiText += `\n指名検索（店舗名含む）: ${brandCount.toLocaleString()}回（${brandPct}%）`;
            kpiText += `\n一般検索: ${(totalCount - brandCount).toLocaleString()}回（${100 - brandPct}%）`;
            kpiText += `\n※一般検索100%は「新規顧客の発見チャネルとして機能している」ことを意味する。駅ナカ・商業施設内の飲食店では指名検索0%は一般的であり、必ずしもネガティブではない`;
          }

          // 口コミ競合比較（同エリア）— competitorCommentページ用
          // 当月分析時は未取得なら取得保存（¥4.8・月1回）、過去月は保存済みのみ
          try {
            const { loadCompetitorComparison } = await import("@/lib/competitor-fetch");
            const comp = await loadCompetitorComparison(shop.name, curMonth);
            // others.length===0（検索結果が自店のみ）は比較として成立しない。
            // データを渡すと「リスト1位で優位な立ち位置」という比較相手ゼロの総評が生成される
            // （2026-08-01 CHILLRI堀江店）。フロント側もこの場合ページ自体を出さない
            const compOthers = comp ? comp.competitors.filter((_, i) => i !== ((comp.self?.rank ?? 0) - 1)) : [];
            if (comp && compOthers.length > 0) {
              const others = compOthers;
              const top3 = [...others].sort((a, b) => b.reviewCount - a.reviewCount).slice(0, 3);
              const top3Avg = top3.length ? Math.round(top3.reduce((s, c) => s + c.reviewCount, 0) / top3.length) : 0;
              // 【重要】自店が検索上位圏外(comp.self=null)でも口コミ数は officialCount にある。
              // ?? 0 にすると「全店が自店を上回る」ことになり、実際は自店より少ない店が
              // 13/20あるのに「20店すべてを下回る」と真逆の総評を生成していた（2026-07-31 Queencyで発覚）。
              // 表示側(client.tsx)の baseCount = comp.self?.reviewCount ?? displayTotalReviews と同じ基準に揃える
              const selfCount = comp.self?.reviewCount ?? officialCount;
              const moreCount = others.filter(c => c.reviewCount > selfCount).length;
              const totalShops = others.length + 1; // 自店を含めた比較対象数（自店がリスト内でもリスト外でも成立）
              kpiText += `\n\n【口コミ競合比較（同エリア「${comp.keyword}」上位${comp.competitors.length}店）】`;
              kpiText += comp.self
                ? `\n自店: リスト${comp.self.rank}位・評価${comp.self.rating}・口コミ${comp.self.reviewCount}件`
                : `\n自店: 検索上位${comp.competitors.length}圏外（口コミ${selfCount}件・評価${officialRating}）`;
              if (top3.length > 0) {
                kpiText += `\n口コミ数トップ: ${top3[0].name}（${top3[0].reviewCount}件）／上位3店平均: ${top3Avg}件`;
                kpiText += `\n自店より口コミが多い店: ${moreCount}店／少ない店: ${others.length - moreCount}店`;
                // 「口コミ数で何番目か」をAIに数えさせると
                // 「リスト2位以内の2店に次ぐ位置」のような破綻文になるため確定値を渡す。
                // 自店圏外時も出す（出さないとAIが自前で数えて誤る）
                kpiText += `\n口コミ数の順位: 自店を含む${totalShops}店中${moreCount + 1}位`;
                kpiText += comp.self
                  ? `（検索順位${comp.self.rank}位とは別物なので混同しないこと）`
                  : `（「検索上位圏外」は表示順位の話。口コミ数が最下位という意味ではないので混同しないこと）`;
              }
              kpiText += `\n※店舗名はこのリストに記載のものだけを使うこと`;
              kpiText += `\n※この比較は取得時点の1回分のみで前回値が無い。「差が縮まっている／広がっている」など推移の断定は禁止`;
            }
          } catch (compErr: any) {
            console.warn(`[analyze] ${shop.name}: 競合比較取得スキップ:`, compErr?.message || compErr);
          }
        } else {
          console.warn(`[analyze] ${shop.name}: report_data_cacheにデータなし`);
        }

        // ── 比較平均（同業種）──
        // 【2026-08-03 修正】以前は次の3つの問題があった:
        //  (1) 母数が1店でも「同業種平均」としてAIに渡していた（patty rôtiは実質1店との比較だった）
        //  (2) 母数をAIに伝えていなかったため、レポートに根拠のない「平均」だけが出ていた
        //  (3) 「グループ平均」は business_group_id = 自社(株式会社Chubby) の全店＝
        //      焼肉店も脱毛サロンも混ざった平均で、業種をまたぐ比較に意味がなかった
        // 対応: 母数がMIN_PEERS未満なら渡さない／母数を明記する／業種横断のグループ平均は廃止する
        const MIN_PEERS = 3; // これ未満は「平均」と呼べないため比較に使わない

        const catInfoRow = shopInfoByName.get(shop.name) || shopInfoById.get(shop.id);
        if (catInfoRow?.gbp_main_category) {
          const category = catInfoRow.gbp_main_category;
          const catNames = (catShopNamesMap.get(category) || []).filter((n: string) => n !== shop.name);
          if (catNames.length > 0) {
            const catCaches = catNames.slice(0, 50).map((n: string) => ({ report_json: cacheMap.get(n) })).filter((c: any) => c.report_json);
            if (catCaches.length >= MIN_PEERS) {
              let tSearch = 0, tMap = 0, tAction = 0, cnt = 0;
              for (const cc of catCaches) {
                const ck = cc.report_json?.kpis || [];
                const s = ck.find((k: any) => k.label?.includes("検索"))?.value || 0;
                const m = ck.find((k: any) => k.label?.includes("マップ"))?.value || 0;
                const a = ck.filter((k: any) => k.label?.includes("ルート") || k.label?.includes("通話") || k.label?.includes("ウェブ") || k.label?.includes("メニュー") || k.label?.includes("予約")).reduce((s: number, k: any) => s + (k.value || 0), 0);
                tSearch += s; tMap += m; tAction += a;
                cnt++;
              }
              kpiText += `\n\n【同業種の平均（弊社が運用支援している「${category}」${cnt}店舗の平均。全国統計ではない）】`;
              kpiText += `\nGoogle検索平均: ${Math.round(tSearch / cnt).toLocaleString()}回`;
              kpiText += `\nGoogleマップ平均: ${Math.round(tMap / cnt).toLocaleString()}回`;
              kpiText += `\nアクション合計平均: ${Math.round(tAction / cnt).toLocaleString()}回`;
              kpiText += `\n※言及するときは必ず「同業種${cnt}店舗の平均」のように母数を書くこと。店舗名は出さない`;
              kpiText += `\n※業界全体の統計ではないので「業界平均」「全国平均」とは書かないこと`;
            } else {
              // 母数不足。ここで渡さないだけでなく、AIが勝手に平均へ言及しないよう明示する
              console.log(`[analyze] ${shop.name}: 同業種の比較対象が${catCaches.length}店（${MIN_PEERS}店未満）のため平均を渡しません`);
              kpiText += `\n\n【比較平均について】\n同業種の比較対象が${MIN_PEERS}店舗に満たないため、平均値は提供しない。「同業種平均」「グループ平均」「他店と比べて」等の比較表現は一切書かないこと`;
            }
          }
        }
      } catch (kpiErr) {
        console.error(`[analyze] ${shop.name}: KPIデータ取得エラー:`, kpiErr);
      }

      console.log(`[analyze] ${shop.name}: kpiText=${kpiText ? `${kpiText.length}文字` : "空"}, hasKpiData=${hasKpiData}`);

      // 口コミ言語別集計を生成（レポート表示と同じ方法: DB生コメントをdetectLanguageに渡す）
      let langStatsText = "";
      try {
        const { detectLanguage } = await import("@/lib/detect-language");
        // fetchReviewsの加工済みcommentではなく、DBの生コメントを使う（review-language-stats APIと同じ挙動）
        const { data: rawReviews } = await supabase
          .from("reviews")
          .select("comment, star_rating")
          .eq("shop_id", shop.id)
          .not("comment", "is", null)
          .neq("comment", "")
          .limit(1000);
        if (rawReviews && rawReviews.length > 0) {
          // 星評価を数値化（"FOUR" / "4" 両形式に対応）
          const starNum: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, "1": 1, "2": 2, "3": 3, "4": 4, "5": 5 };
          const langCounts: Record<string, { country: string; count: number; high: number; low: number }> = {};
          for (const r of rawReviews) {
            const det = detectLanguage(r.comment);
            if (det.lang === "不明") continue;
            if (!langCounts[det.lang]) langCounts[det.lang] = { country: det.country, count: 0, high: 0, low: 0 };
            langCounts[det.lang].count++;
            const s = starNum[(r.star_rating || "").toUpperCase().replace(/_STARS?/, "")] || 0;
            if (s >= 4) langCounts[det.lang].high++;
            else if (s >= 1) langCounts[det.lang].low++;
          }
          const langs = Object.entries(langCounts)
            .map(([lang, v]) => ({ lang, ...v }))
            .sort((a, b) => b.count - a.count);
          if (langs.length > 0) {
            const totalLang = langs.reduce((s, l) => s + l.count, 0);
            // Math.round だと 2/218=0.92% が「1%」、1/218=0.46% が「0%」になり、
            // AIが「各1〜2%」と誇張する原因になっていた（2026-07-31）。10%未満は小数1桁で渡す
            const fmtPct = (n: number) => {
              const p = (n / totalLang) * 100;
              return p < 10 ? `${p.toFixed(1)}%` : `${Math.round(p)}%`;
            };
            langStatsText = `【口コミ言語別集計（コメント付き${totalLang}件）】\n検出言語数: ${langs.length}\n${langs.map(l => `${l.lang}（${l.country}）: ${l.count}件（${fmtPct(l.count)}） 内訳: 高評価(★4-5) ${l.high}件 / 低評価(★1-3) ${l.low}件`).join("\n")}`;
          }
        }
      } catch (langErr) {
        console.error(`[analyze] ${shop.name}: 言語集計エラー:`, langErr);
      }

      console.log(`[analyze] ${shop.name}: langStats=${langStatsText ? `${langStatsText.split("\n").length}言語検出` : "なし"}`);

      // ── Batchモード: Claudeをここでは呼ばず、材料だけ集めて後段でBatch API（半額）に一括投入する ──
      if (batchPrepare) {
        const filtered = (reviewData.reviews || []).filter((r) => r.comment && r.comment.trim());
        if (filtered.length === 0) {
          results.push({ shopId: shop.id, shopName: shop.name, status: "no_reviews", reason: "コメント付き口コミなし" });
          continue;
        }
        preparedItems.push({
          shopId: shop.id,
          shopName: shop.name,
          targetMonth: curMonth || null,
          payload: {
            reviews: filtered.map((r) => ({
              reviewer: { displayName: r.reviewer?.displayName || "匿名" },
              starRating: r.starRating,
              comment: r.comment,
              createTime: r.createTime,
            })),
            officialRating,
            officialCount,
            ratingDistribution: reviewData.ratingDistribution,
            kpiText,
            langStatsText,
            verifyCtx: { keywordFacts: verifyKeywordFacts, reviewDeltas: verifyReviewDeltas, metricFacts: verifyMetricFacts },
          },
        });
        results.push({ shopId: shop.id, shopName: shop.name, status: "prepared" });
        continue;
      }

      // Claude APIで分析
      const analysis = await analyzeWithClaude(
        shop.name,
        reviewData.reviews,
        officialRating,
        officialCount,
        reviewData.ratingDistribution,
        kpiText,
        langStatsText,
        { keywordFacts: verifyKeywordFacts, reviewDeltas: verifyReviewDeltas, metricFacts: verifyMetricFacts }
      );

      if (!analysis) {
        results.push({ shopId: shop.id, shopName: shop.name, status: "analysis_failed", reason: "AI分析が応答なし（タイムアウトまたはAPI制限）" });
        continue;
      }

      // 評価値の公式値置換とupsertは src/lib/analyze-core.ts へ移設（Batch経路と共用）
      applyFixRating(analysis, officialRating);
      const saveErr = await saveAnalysisRow(supabase, {
        shopName: shop.name,
        shopId: shop.id,
        analysis,
        officialRating,
        officialCount,
        targetMonth: curMonth || null,
      });

      if (saveErr) {
        console.error("[analyze] Supabase error:", saveErr);
        results.push({ shopId: shop.id, shopName: shop.name, status: "db_error", reason: `DB保存エラー: ${saveErr}` });
      } else {
        results.push({ shopId: shop.id, shopName: shop.name, status: "success" });
      }
    } catch (err: any) {
      console.error("[analyze] Error for shop:", shop.name, err);
      results.push({ shopId: shop.id, shopName: shop.name, status: "error", reason: err?.message?.slice(0, 100) || "不明なエラー" });
    }
  }

  // ── Batchモード: 集めた材料をAnthropic Batch API（半額）へ投入 ──
  if (batchPrepare) {
    if (preparedItems.length === 0) {
      ctx.detail = `${ctx.detail} — Batch投入対象なし`;
      return NextResponse.json({ success: true, total: shopIds.length, submitted: 0, results });
    }
    try {
      const { batchDbId, anthropicBatchId } = await submitAnalysisBatch(supabase, preparedItems);
      ctx.detail = `${ctx.detail} — Batch投入${preparedItems.length}件（半額・batch=${anthropicBatchId}）`;
      return NextResponse.json({
        success: true,
        total: shopIds.length,
        submitted: preparedItems.length,
        batchDbId,
        anthropicBatchId,
        results,
      });
    } catch (e: any) {
      console.error("[analyze] Batch投入エラー:", e);
      return NextResponse.json({ error: `Batch投入に失敗しました: ${e?.message || e}` }, { status: 500 });
    }
  }

  const successCount = results.filter((r) => r.status === "success").length;

  ctx.detail = `${ctx.detail} — 分析成功${successCount}/${shopIds.length}件`;

  return NextResponse.json({
    success: true,
    total: shopIds.length,
    analyzed: successCount,
    results,
  });
});
