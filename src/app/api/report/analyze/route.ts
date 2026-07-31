import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { withAudit, requireCtxShopAccess } from "@/lib/audit";
import { normalizeKw } from "@/lib/keyword-normalize";
import { centerCell } from "@/lib/report-utils";

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
  langStatsText?: string
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
  kpiText?: string,
  langStatsText?: string
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

  // キーワード順位データがkpiTextに含まれているか（「位」「圏外」の行を含むか）で判定
  const hasKeywordData = /\n[^\n]+: (\d+位|圏外)/.test(kpiText || "");

  const prompt = `店舗のMEOレポート総評を作成。JSONのみ出力。

■ データ
店舗: ${shopName}（評価${averageRating}）
${kpiText || ""}
口コミ:
${reviewTexts}
${langStatsText || ""}

■ 出力形式（JSON以外は一切書くな）
各項目は配列・フィールドの独立した要素として出力すること。1つの文字列に複数項目を詰め込まないこと。
このコメントはレポート内の各グラフページの末尾に個別に配置されるため、他のフィールドの内容を重複させないこと。

{
  "positiveWords": ["原文フレーズ", "原文フレーズ", ...12個以上],
  "negativeWords": ["原文フレーズ", "原文フレーズ", ...12個以上],
  "summary": "20文字の総評",
  "monthlyComment": "全指標を俯瞰した当月の総括1文",
  "mapComment": "Googleマップ表示数についての傾向1文",
  "searchComment": "Google検索数についての傾向1文",
  "reactionComment": "ウェブサイト/ルート/通話等のユーザー反応数についての傾向1文",
  "keywordComment": "${hasKeywordData ? "キーワード順位変動についての傾向1文" : "キーワードデータなしのため空文字\"\""}",
  "rankingHistoryComment": "${hasKeywordData ? "キーワード順位の複数月推移についての傾向1文（keywordCommentとは別の切り口で）" : "キーワードデータなしのため空文字\"\""}",
  "gridComment": "多地点グリッド計測（周辺エリアでの見え方）についての傾向1文。データがなければ空文字",
  "searchQueryComment": "検索語句（指名検索/一般検索の比率など）についての傾向1文。データがなければ空文字",
  "reviewCountComment": "口コミ累計件数の推移についての傾向1文。データがなければ空文字",
  "reviewDeltaComment": "口コミの月間増加ペースについての傾向1文。データがなければ空文字",
  "languageComment": "${langStatsText ? "口コミの言語別構成についての傾向1文" : "言語データなしのため空文字\"\""}",
  "competitorComment": "同エリア競合との口コミ数の位置づけ1文。データがなければ空文字",
  "reviewComments": ["口コミ傾向1", "口コミ傾向2", "口コミ傾向3", "低評価傾向"],
  "actions": ["施策1", "施策2", "施策3"]
}

■ 正しい出力例
{
  "positiveWords": ["味噌のコク", "スープが熱々", "駅直結", "バターのまろやかさ"],
  "negativeWords": ["愛想が悪い", "荷物置き場がない", "待ち時間が長い"],
  "summary": "集客回復も接客課題が残る",
  "monthlyComment": "マップ・検索とも回復基調だが、<strong>アクション率の低下</strong>が課題として残る",
  "mapComment": "<strong>マップ表示が前月比+5%</strong>と回復傾向で、同業種平均を下回る水準",
  "searchComment": "Google検索は前月比+14%と回復傾向で、<strong>グループ平均を上回る水準</strong>を維持",
  "reactionComment": "ルート検索は<strong>+60%と大幅増加</strong>し、来店意欲の高まりがうかがえる",
  "keywordComment": "「一社 イタリアン」「名東区 パスタ」が<strong>1位から圏外に転落</strong>しており、オーガニック流入への影響が懸念される",
  "rankingHistoryComment": "「名東区 レストラン」は1月の11位から4月3位まで改善したが、<strong>直近2計測は下降</strong>に転じている",
  "gridComment": "9地点中<strong>圏外が5地点</strong>あり、駅北側の商圏を取りこぼしている",
  "searchQueryComment": "<strong>一般検索が92%</strong>を占め、新規顧客の発見チャネルとして機能している",
  "reviewCountComment": "累計件数は横ばいで、<strong>削除による目減り</strong>が新規投稿を相殺している",
  "reviewDeltaComment": "月間の新規投稿が<strong>平均1.2件</strong>と少なく、獲得施策の強化余地が大きい",
  "languageComment": "<strong>英語口コミが18%</strong>を占め、インバウンド需要の受け皿になっている",
  "competitorComment": "同エリアでは<strong>口コミ数7位</strong>で、上位3店との差は平均360件と大きい",
  "reviewComments": [
    "「味噌のコクがたまらない」と<strong>味への満足度が高い</strong>",
    "「駅直結で便利」と立地を評価する声が多い",
    "「また来たい」と<strong>再訪意向</strong>を示す口コミが複数ある",
    "接客態度への不満が<strong>低評価の主因</strong>となっている"
  ],
  "actions": [
    "接客声かけマニュアルを作成し対応を統一する",
    "荷物フック設置で設備面の不満を解消する",
    "<strong>口コミ促進POP</strong>を卓上に設置する"
  ]
}

■ ルール
- 各コメントはレポートの別々のページに載る。**同じ内容を複数のコメントで繰り返さない**（例: mapCommentで書いた内容をmonthlyCommentで再度書かない）
- 対応するデータが【】ブロックとして提供されていない項目は、推測で書かず必ず空文字""を返す
- mapComment/searchComment/reactionComment: ${hasKpi ? "各KPIの前月比傾向を1文ずつ。同業種平均やグループ平均のデータがあれば「同業種平均を上回っている」「平均を下回る」等の比較を含める" : "口コミから推定した概況を1文ずつ"}。絶対値（147,422回等）は書かない
- monthlyComment: 個別指標ではなく全体を俯瞰した1文。最も重要な変化または課題を1つだけ挙げる
- keywordComment: ${hasKeywordData ? "【キーワード順位】の当月変動について。**「圏外へ転落」したキーワードがあれば、他の変動より最優先で必ず言及する**（3ランク下落より圏外転落の方が重大）。圏外転落が無い場合のみ、下落幅の大きいものに言及する" : "キーワードデータが提供されていないため必ず空文字\"\"を返す"}
- rankingHistoryComment: ${hasKeywordData ? "【キーワード順位の推移】の系列**のみ**を根拠に、複数月にわたるトレンド（連続下降/底打ち/安定/回復）を述べる。月名を1つ以上含めること。**当月だけの変動には触れない**（それはkeywordCommentの担当）。「下落が確認された」「監視が必要」のような、keywordCommentと区別がつかない表現は禁止" : "キーワードデータが提供されていないため必ず空文字\"\"を返す"}
- gridComment: 【多地点グリッド計測】がある場合のみ。平均順位・圏外地点数から商圏の取りこぼし具合に言及
- **キーワード名は【】ブロック内に記載されたものを一字一句そのまま使う。2つのキーワードを混ぜた造語（例:「一社 ランチ」と「名東区 カフェ」から「一社 カフェ」）や、記載の無いキーワードへの言及は絶対に禁止**
- searchQueryComment: 【検索語句分析】がある場合のみ。指名検索/一般検索の比率とその意味に言及
- reviewCountComment: 【口コミ累計件数の推移】がある場合のみ。累計が減っている月は削除・非表示が起きている旨を書く
- reviewDeltaComment: 【口コミ月間増加ペース】がある場合のみ。獲得ペースが十分か不足かに言及
- languageComment: ${langStatsText ? "言語構成比と、それが示す客層（インバウンド需要など）に言及" : "言語データが提供されていないため必ず空文字\"\"を返す"}
- competitorComment: 【口コミ競合比較】がある場合のみ。同エリア内での口コミ数の位置づけに言及。この欄では口コミ件数への言及を許可する。
  「口コミ数の順位」が与えられている場合は必ずその値をそのまま使い、自分で数え直さない。
  検索順位と口コミ数順位は別物なので混同しない（「リスト2位以内の2店に次ぐ位置」のような曖昧・非文は禁止。「口コミ数では20店中3位」のように断定的に書く）
- 前月比・前年比などの%はKPIデータに記載された値をそのまま使う（自分で再計算・丸め直ししない）
- 比率を「各1〜2%」のように幅で丸めて実際より大きく見せない。1%未満は「1%未満」と書く
- データが1時点しか無い項目に「縮まっている」「広がっている」など推移の断定を書かない
- 「◯ヶ月ぶり」「◯ヶ月連続」等の期間表現は、提供された推移データで実際に確認できる場合のみ使う
- 前年同月比を評価する際は推移全体を確認する。前年値が前後の月から大きく乖離した一時的スパイクの場合、単純比較で「悪化」「最優先課題」と断定しない（例外的な月との比較である旨を踏まえる）
- reviewComments: 高評価の傾向3項目＋低評価の傾向1項目。口コミ引用は「」で囲む
- actions: 今日から実行可能な具体施策を3つ
- 各項目は1つの完全な文（主語＋述語）。20〜35文字程度
- 各項目の中で最も重要なキーワードを1つだけ<strong>タグで囲む
- positiveWords/negativeWordsは口コミ原文に連続した文字列としてそのまま含まれる抜き出しのみ有効（言い換え・活用形の変更・翻訳・要約はシステム側で無効化される）。各2〜10文字（15文字超は不可）。原文どおりを最優先した上で、できるだけ「態度が横柄」のような名詞句・言い切りの自然な区切りで抜き出す
- 初計測（前回データなし）のキーワードを「維持」「継続」と表現しない（今回が最初の計測）
- 口コミの件数・増加数・「○○件」・「ゼロ」・「0件」・「投稿数」に言及してよいのは reviewCountComment・reviewDeltaComment・competitorComment の3つだけ。
  それ以外（summary/monthlyComment/reviewComments/actions等）では従来どおり一切言及せず、口コミは質と傾向のみ分析する
- 捏造禁止（実施していないキャンペーン等）
- 評価は必ず${averageRating}を使用
${langStatsText ? "- 口コミ言語は上記集計に記載された言語のみ言及。外国語口コミに言及する場合は言語別集計の評価内訳と矛盾しないこと（低評価が中心の言語を「海外から支持」等と書かない）" : ""}`;

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
        const collect = (useRatingFilter: boolean) => {
          const wordCounts: { word: string; count: number; reviews: any[] }[] = [];
          const seen = new Set<string>();
          for (const raw of words) {
            // 末尾の助詞を除去（「アヒージョが」→「アヒージョ」）。先頭からの切り詰めなので原文含有は保たれる
            const w = (raw || "").trim().replace(/[がのをにはへとでも]$/, "");
            // 15文字超はワードではなく文章（チップ表示が崩れる）。プロンプトの文字数ルールが破られた場合の保険
            if (!w || w.length < 2 || w.length > 15 || seen.has(w)) continue;
            seen.add(w);
            // 口コミ原文に完全含有 & 星評価フィルタ
            const matched = filteredReviews.filter(r =>
              r.comment && r.comment.includes(w) && (!useRatingFilter || ratingFilter.has(r.starRating))
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
          return wordCounts.slice(0, maxCount);
        };
        // 星評価フィルタで全滅した場合は全口コミから照合（原文含有の検証は維持）。
        // 例: 不満が★4口コミ内に書かれている、低評価が外国語でAIが訳語を返した等で
        // 0件になると「データ準備中」表示になってしまうため
        let top = collect(true);
        if (top.length === 0) top = collect(false);
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

      // mapComment/searchComment/... → ページ別pageComments、後方互換のcomments配列に組み立て
      const cleanItem = (s: string) => s
        .replace(/^[・•]\s*/, "")                              // 先頭の「・」を除去（サーバーで付け直す）
        .replace(/^[a-c]\)\s*/, "")                            // 先頭の「a) 」を除去
        .replace(/[\[（(]?#\d+[\]）)]?/g, "")
        .replace(/[\u200B-\u200D\uFEFF\u00AD\uFFFD]/g, "")
        .replace(/・/g, "、")                                   // 内部の「・」を「、」に（formatAICommentの分割防止）
        .replace(/。$/, "").replace(/\s{2,}/g, " ").trim();

      // 旧形式commentsを退避してから上書き
      const origComments = Array.isArray(parsed.comments) ? [...parsed.comments] : [];

      const toArr = (v: any): string[] => Array.isArray(v) ? v.filter((x: any) => typeof x === "string") : typeof v === "string" ? [v] : [];
      const cleanStr = (v: any): string => typeof v === "string" ? cleanItem(v) : "";

      const monthlyComment = cleanStr(parsed.monthlyComment);
      const mapComment = cleanStr(parsed.mapComment);
      const searchComment = cleanStr(parsed.searchComment);
      const reactionComment = cleanStr(parsed.reactionComment);
      const keywordComment = cleanStr(parsed.keywordComment);
      const rankingHistoryComment = cleanStr(parsed.rankingHistoryComment);
      const gridComment = cleanStr(parsed.gridComment);
      const searchQueryComment = cleanStr(parsed.searchQueryComment);
      const reviewCountComment = cleanStr(parsed.reviewCountComment);
      const reviewDeltaComment = cleanStr(parsed.reviewDeltaComment);
      const languageComment = cleanStr(parsed.languageComment);
      const competitorComment = cleanStr(parsed.competitorComment);
      const reviewComments: string[] = toArr(parsed.reviewComments).map(cleanItem).filter((s: string) => s.length >= 5);
      const actions: string[] = toArr(parsed.actions).map(cleanItem).filter((s: string) => s.length >= 10);

      const hasNewFields = !!(mapComment || searchComment || reactionComment || reviewComments.length > 0);

      if (hasNewFields) {
        parsed.pageComments = {
          monthly: monthlyComment,
          map: mapComment,
          search: searchComment,
          reactions: reactionComment,
          keyword: keywordComment,
          rankingHistory: rankingHistoryComment,
          grid: gridComment,
          searchQuery: searchQueryComment,
          reviewCount: reviewCountComment,
          reviewDelta: reviewDeltaComment,
          language: languageComment,
          competitor: competitorComment,
          reviews: reviewComments.slice(0, 4),
          actions: actions.slice(0, 3),
        };
        // 旧形式comments（後方互換・他箇所からの参照保険。新UIの表示には使わない）
        parsed.comments = [
          [monthlyComment, mapComment, searchComment, reactionComment, keywordComment].filter(Boolean).map((s: string) => `・${s}`).join(""),
          reviewComments.slice(0, 4).map((s: string) => `・${s}`).join(""),
          actions.slice(0, 3).map((s: string, i: number) => `${String.fromCharCode(97 + i)}) ${s}`).join(" "),
        ];
      } else if (origComments.length > 0) {
        // Claudeが旧形式で返した場合のフォールバック
        parsed.comments = origComments.map((c: string) => cleanItem(c));
      }

      if (parsed.summary) {
        parsed.summary = cleanItem(parsed.summary);
      }

      // 不要なフィールドを削除（pageCommentsに集約済み）
      delete parsed.monthlyComment;
      delete parsed.mapComment;
      delete parsed.searchComment;
      delete parsed.reactionComment;
      delete parsed.keywordComment;
      delete parsed.rankingHistoryComment;
      delete parsed.gridComment;
      delete parsed.searchQueryComment;
      delete parsed.reviewCountComment;
      delete parsed.reviewDeltaComment;
      delete parsed.languageComment;
      delete parsed.competitorComment;
      delete parsed.reviewComments;
      delete parsed.actions;

      return parsed;
    } catch { return null; }
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

  // 3. 全グループのキャッシュを一括取得
  const groupIds = new Set<string>();
  const categories = new Set<string>();
  shopInfoByName.forEach(s => {
    if (s.business_group_id) groupIds.add(s.business_group_id);
    if (s.gbp_main_category) categories.add(s.gbp_main_category);
  });

  // グループ内店舗の名前とキャッシュ
  const groupShopNamesMap = new Map<string, string[]>();
  if (groupIds.size > 0) {
    const { data: groupShops } = await supabase
      .from("shops")
      .select("name, business_group_id")
      .in("business_group_id", Array.from(groupIds))
      .limit(500);
    for (const gs of (groupShops || [])) {
      const list = groupShopNamesMap.get(gs.business_group_id) || [];
      list.push(gs.name);
      groupShopNamesMap.set(gs.business_group_id, list);
    }
  }

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

  // グループ・カテゴリ全店舗のキャッシュも一括取得
  const allRelatedNames = new Set<string>();
  Array.from(groupShopNamesMap.values()).forEach(names => names.forEach(n => allRelatedNames.add(n)));
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
          const effectiveKpis = (() => {
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
          })();

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
                  // 圏外(rank=0)も含める: 圏外転落はAIコメントで言及すべき重要な変動のため
                  // 前回計測なし＝初計測（prevRank=rankのフォールバックを「維持」と誤読させない）
                  kwData.push({ word: snap.keyword, rank, prevRank: prevRank || rank, first: !hasPrevSnap });
                }
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
            if (kwData.length > 0) {
              kpiText += `\n\n【キーワード順位（${curMonth}）】`;
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
                const lines: string[] = [];
                for (const ds of rh2.datasets) {
                  // 順位推移ページ: 既定 = 系列にデータがあれば表示（client.tsx visibleRankingDatasets と同条件）
                  if (kwVisSetting(ds.word) === false) continue;
                  const ranks = ds.ranks.slice(startIdx, endIdx + 1);
                  if (!ranks.some((r: number | null) => r !== null && r > 0)) continue;
                  lines.push(`\n${ds.word}: ${lbls.map((l: string, i: number) => `${l}=${ranks[i] && ranks[i] > 0 ? `${ranks[i]}位` : "-"}`).join(" → ")}`);
                }
                if (lines.length > 0) {
                  kpiText += `\n\n【キーワード順位の推移（直近${lbls.length}計測）】${lines.join("")}`;
                  kpiText += `\n※「-」は計測なしまたは圏外。当月単体ではなく複数月の傾向（連続下降/底打ち/安定）を読むための系列`;
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
            if (comp && comp.competitors.length > 0) {
              const others = comp.competitors.filter((_, i) => i !== ((comp.self?.rank ?? 0) - 1));
              const top3 = [...others].sort((a, b) => b.reviewCount - a.reviewCount).slice(0, 3);
              const top3Avg = top3.length ? Math.round(top3.reduce((s, c) => s + c.reviewCount, 0) / top3.length) : 0;
              const selfCount = comp.self?.reviewCount ?? 0;
              const moreCount = others.filter(c => c.reviewCount > selfCount).length;
              kpiText += `\n\n【口コミ競合比較（同エリア「${comp.keyword}」上位${comp.competitors.length}店）】`;
              kpiText += comp.self
                ? `\n自店: リスト${comp.self.rank}位・評価${comp.self.rating}・口コミ${comp.self.reviewCount}件`
                : `\n自店: 上位${comp.competitors.length}圏外`;
              if (top3.length > 0) {
                kpiText += `\n口コミ数トップ: ${top3[0].name}（${top3[0].reviewCount}件）／上位3店平均: ${top3Avg}件`;
                kpiText += `\n自店より口コミが多い店: ${moreCount}店`;
                // 「口コミ数で何番目か」をAIに数えさせると
                // 「リスト2位以内の2店に次ぐ位置」のような破綻文になるため確定値を渡す
                if (comp.self) {
                  kpiText += `\n口コミ数の順位: ${comp.competitors.length}店中${moreCount + 1}位（検索順位${comp.self.rank}位とは別物なので混同しないこと）`;
                }
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

        // 同グループ店舗の平均を取得（バッチ済み）
        const shopInfoForGroup = shopInfoByName.get(shop.name) || shopInfoById.get(shop.id);
        if (shopInfoForGroup?.business_group_id) {
          const groupNames = (groupShopNamesMap.get(shopInfoForGroup.business_group_id) || []).filter((n: string) => n !== shop.name);
          if (groupNames.length > 0) {
            const groupCaches = groupNames.slice(0, 50).map((n: string) => ({ report_json: cacheMap.get(n) })).filter((c: any) => c.report_json);
            if (groupCaches.length > 0) {
              let totalSearch = 0, totalMap = 0, totalAction = 0, gReviews = 0, gRating = 0, count = 0;
              for (const gc of groupCaches) {
                const gk = gc.report_json?.kpis || [];
                const search = gk.find((k: any) => k.label?.includes("検索"))?.value || 0;
                const map = gk.find((k: any) => k.label?.includes("マップ"))?.value || 0;
                const action = gk.filter((k: any) => k.label?.includes("ルート") || k.label?.includes("通話") || k.label?.includes("ウェブ") || k.label?.includes("メニュー") || k.label?.includes("予約")).reduce((s: number, k: any) => s + (k.value || 0), 0);
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

        // 同業種（カテゴリ）店舗の平均を取得（バッチ済み）
        const catInfoRow = shopInfoByName.get(shop.name) || shopInfoById.get(shop.id);
        if (catInfoRow?.gbp_main_category) {
          const category = catInfoRow.gbp_main_category;
          const catNames = (catShopNamesMap.get(category) || []).filter((n: string) => n !== shop.name);
          if (catNames.length > 0) {
            const catCaches = catNames.slice(0, 50).map((n: string) => ({ report_json: cacheMap.get(n) })).filter((c: any) => c.report_json);
            if (catCaches.length > 0) {
              let tSearch = 0, tMap = 0, tAction = 0, tReviews = 0, tRating = 0, cnt = 0;
              for (const cc of catCaches) {
                const ck = cc.report_json?.kpis || [];
                const s = ck.find((k: any) => k.label?.includes("検索"))?.value || 0;
                const m = ck.find((k: any) => k.label?.includes("マップ"))?.value || 0;
                const a = ck.filter((k: any) => k.label?.includes("ルート") || k.label?.includes("通話") || k.label?.includes("ウェブ") || k.label?.includes("メニュー") || k.label?.includes("予約")).reduce((s: number, k: any) => s + (k.value || 0), 0);
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

      // Claude APIで分析
      const analysis = await analyzeWithClaude(
        shop.name,
        reviewData.reviews,
        officialRating,
        officialCount,
        reviewData.ratingDistribution,
        kpiText,
        langStatsText
      );

      if (!analysis) {
        results.push({ shopId: shop.id, shopName: shop.name, status: "analysis_failed", reason: "AI分析が応答なし（タイムアウトまたはAPI制限）" });
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
      if (analysis.pageComments) {
        const pc = analysis.pageComments as Record<string, any>;
        const fixed: Record<string, any> = {};
        for (const [k, v] of Object.entries(pc)) {
          fixed[k] = Array.isArray(v) ? v.map((s: string) => fixRating(s || "")) : fixRating(v || "");
        }
        analysis.pageComments = fixed as typeof analysis.pageComments;
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
            page_comments: analysis.pageComments || null,
            review_count: officialCount,
            average_rating: officialRating,
            target_month: curMonth || null,
            analyzed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "shop_name,target_month" }
        );

      if (error) {
        console.error("[analyze] Supabase error:", error);
        results.push({ shopId: shop.id, shopName: shop.name, status: "db_error", reason: `DB保存エラー: ${error.message}` });
      } else {
        results.push({ shopId: shop.id, shopName: shop.name, status: "success" });
      }
    } catch (err: any) {
      console.error("[analyze] Error for shop:", shop.name, err);
      results.push({ shopId: shop.id, shopName: shop.name, status: "error", reason: err?.message?.slice(0, 100) || "不明なエラー" });
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
