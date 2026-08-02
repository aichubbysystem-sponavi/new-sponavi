/**
 * AI総評の生成コア（プロンプト構築・応答パース・評価値置換・保存）。
 *
 * analyze/route.ts（同期・即時）と analyze-batch/route.ts（Batch API・半額）の両方から使う。
 * Next.jsのrouteファイルはHTTPメソッド以外をexportできないため、共有部をここへ分離した。
 * ここのコードは analyze/route.ts から移設したもので、ロジックは変更していない。
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface GBPReview {
  reviewId?: string;
  reviewer: { displayName: string };
  starRating: string;
  comment: string;
  createTime?: string;
}

/**
 * AI総評のプロンプトを構築する。口コミが1件も無ければnull。
 * correction: 数値照合で不一致が出た場合の修正指示（再生成時のみ指定）
 */
export function buildAnalyzePrompt(
  shopName: string,
  filteredReviews: GBPReview[],
  averageRating: number,
  totalReviewCount: number,
  ratingDistribution?: Record<number, number>,
  kpiText?: string,
  langStatsText?: string,
  correction?: string
): string | null {
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
  void pctOf; void positiveCount; void negativeCount; // 統計は将来のプロンプト拡張用に算出のみ（移設前からの挙動）

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
  "monthlyComment": "全指標を俯瞰した当月の総括（2〜3文）",
  "mapComment": "Googleマップ表示数についての傾向（2〜3文）",
  "searchComment": "Google検索数についての傾向（2〜3文）",
  "reactionComment": "ウェブサイト/ルート/通話等のユーザー反応数についての傾向（2〜3文）",
  "keywordComment": "${hasKeywordData ? "キーワード順位変動についての傾向（2〜3文）" : "キーワードデータなしのため空文字\"\""}",
  "rankingHistoryComment": "${hasKeywordData ? "キーワード順位の複数月推移についての傾向（2〜3文。keywordCommentとは別の切り口で）" : "キーワードデータなしのため空文字\"\""}",
  "gridComment": "多地点グリッド計測（周辺エリアでの見え方）についての傾向（2〜3文）。データがなければ空文字",
  "searchQueryComment": "検索語句（指名検索/一般検索の比率など）についての傾向（2〜3文）。データがなければ空文字",
  "reviewCountComment": "口コミ累計件数の推移についての傾向（2〜3文）。データがなければ空文字",
  "reviewDeltaComment": "口コミの月間増加ペースについての傾向（2〜3文）。データがなければ空文字",
  "languageComment": "${langStatsText ? "口コミの言語別構成についての傾向（2〜3文）" : "言語データなしのため空文字\"\""}",
  "competitorComment": "同エリア競合との口コミ数の位置づけ（2〜3文）。データがなければ空文字",
  "reviewComments": ["口コミ傾向1", "口コミ傾向2", "口コミ傾向3", "低評価傾向"],
  "actions": ["施策1", "施策2", "施策3"]
}

■ 正しい出力例（文体・分量の見本。キーワード名・数値はすべて架空であり、実際の出力には必ず上の【】ブロック内のキーワード・数値だけを使うこと）
{
  "positiveWords": ["味噌のコク", "スープが熱々", "駅直結", "バターのまろやかさ"],
  "negativeWords": ["愛想が悪い", "荷物置き場がない", "待ち時間が長い"],
  "summary": "集客回復も接客課題が残る",
  "monthlyComment": "マップ・検索ともに回復基調で、集客の入口は着実に広がっている。一方で<strong>アクション率の低下</strong>が続いており、閲覧から行動への転換が当月の課題として残る。次月は写真や店舗情報など、行動につながる要素の見直しが焦点となる",
  "mapComment": "<strong>マップ表示が前月比+5%</strong>と回復傾向にある。ただし同業種平均を下回る水準が続いており、露出を伸ばす余地は大きい。写真の定期更新や最新情報の投稿など、プロフィールの鮮度を保つ運用が引き続き有効といえる",
  "searchComment": "Google検索は前月比+14%と回復傾向で、<strong>グループ平均を上回る水準</strong>を維持している。検索経由の露出は堅調に推移しており、この流れを保つため外部媒体やSNSでの店名露出も並行して強化したい",
  "reactionComment": "ルート検索が<strong>+60%と大幅に増加</strong>し、来店意欲の高まりがうかがえる。一方で通話は減少しており、電話よりも経路確認から直接来店へ進む利用者が増えている可能性がある。営業時間や駐車場情報など来店前に確認される項目の整備が効果的だ",
  "keywordComment": "「青葉台 ビストロ」「桜丘 ベーカリー」が<strong>1位から圏外に転落</strong>しており、オーガニック流入への影響が懸念される。他のキーワードは順位を維持しているため、転落した2語の原因特定と早期回復が最優先の対応となる",
  "rankingHistoryComment": "「泉町 レストラン」は1月の11位から4月の3位まで改善したが、<strong>直近2計測は下降</strong>に転じている。数ヶ月かけて積み上げた上昇分を手放さないよう、推移を注視しながら上位表示の要因を維持することが重要となる",
  "gridComment": "9地点中<strong>圏外が5地点</strong>あり、駅北側の商圏を取りこぼしている。中心部では上位を確保できているため、露出の課題は北側エリアに集中している。該当エリアでの認知拡大が改善の糸口になり得る",
  "searchQueryComment": "<strong>一般検索が92%</strong>を占め、新規顧客の発見チャネルとして機能している。指名検索の比率はまだ小さく、店名の認知はこれから伸ばせる段階にある。一般検索での上位維持と並行して、指名検索の底上げも図りたい",
  "reviewCountComment": "累計件数は横ばいで、<strong>削除による目減り</strong>が新規投稿を相殺している。獲得自体は続いているため悲観する状況ではないが、削除されにくい具体的な体験を含む口コミの獲得を意識したい",
  "reviewDeltaComment": "月間の新規投稿が<strong>平均1.2件</strong>と少なく、獲得施策の強化余地が大きい。来店客への声かけやQRコード付きPOPの設置など、投稿のきっかけづくりから始めるのが現実的だ",
  "languageComment": "<strong>英語口コミが18%</strong>を占め、インバウンド需要の受け皿になっている。外国語の評価も安定して高く、海外利用者の満足度は良好といえる。多言語対応の充実がさらなる集客につながる可能性がある",
  "competitorComment": "同エリアでは<strong>口コミ数7位</strong>で、上位3店との差は平均360件と大きい。短期で埋まる差ではないため、まずは月間獲得ペースの底上げから着手し、エリア内での存在感を高めていきたい",
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
- ページ総評（monthlyComment/mapComment/searchComment/reactionComment/keywordComment/rankingHistoryComment/gridComment/searchQueryComment/reviewCountComment/reviewDeltaComment/languageComment/competitorComment）は**2〜3文・合計100〜180文字程度**。1文目で傾向を述べ、2文目以降で内訳・根拠やそのページ固有の示唆を書く。文字数を稼ぐための水増しや一般論の繰り返しは禁止
- 対応するデータが【】ブロックとして提供されていない項目は、推測で書かず必ず空文字""を返す
- mapComment/searchComment/reactionComment: ${hasKpi ? "各KPIの前月比傾向について2〜3文で。同業種平均やグループ平均のデータがあれば「同業種平均を上回っている」「平均を下回る」等の比較を含める" : "口コミから推定した概況を2〜3文で"}。絶対値（147,422回等）は書かない
- monthlyComment: 個別指標の羅列ではなく全体を俯瞰した総括。軸となる最も重要な変化または課題は1つに絞る
- 「唯一の前年超え」「唯一のプラス」のような排他的表現は、提供された全指標の前月比・前年比を数えて、条件を満たす指標が本当に1つだけの場合にのみ使う。2つ以上あるなら「唯一」は使わない
- keywordComment: ${hasKeywordData ? "【キーワード順位】の当月変動について。**「圏外へ転落」と明記されたキーワードがあれば、他の変動より最優先で必ず言及する**（3ランク下落より圏外転落の方が重大）。圏外転落が無い場合のみ、下落幅の大きいものに言及する。「未計測」のキーワードは当月の変動を語れないため言及しない。転落・圏外・維持などの状態は必ず【】ブロックでそのキーワード自身の行に書かれたものを使い、別のキーワードの状態と取り違えない" : "キーワードデータが提供されていないため必ず空文字\"\"を返す"}
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
- reviewComments/actionsの各項目は1つの完全な文（主語＋述語）。20〜35文字程度
- 各項目・各ページ総評の中で最も重要なキーワードを1つだけ<strong>タグで囲む
- positiveWords/negativeWordsは口コミ原文に連続した文字列としてそのまま含まれる抜き出しのみ有効（言い換え・活用形の変更・翻訳・要約はシステム側で無効化される）。各2〜10文字（15文字超は不可）。原文どおりを最優先した上で、できるだけ「態度が横柄」のような名詞句・言い切りの自然な区切りで抜き出す
- 初計測（前回データなし）のキーワードを「維持」「継続」と表現しない（今回が最初の計測）
- 「未計測」と記載された月は順位データが存在しないだけ。その月を「圏外」「転落」「沈んだ」と書かない（圏外と書いてよいのは「圏外」と明記された月だけ）
- 口コミの件数・増加数・「○○件」・「ゼロ」・「0件」・「投稿数」に言及してよいのは reviewCountComment・reviewDeltaComment・competitorComment の3つだけ。
  それ以外（summary/monthlyComment/reviewComments/actions等）では従来どおり一切言及せず、口コミは質と傾向のみ分析する
- 捏造禁止（実施していないキャンペーン等）
- 評価は必ず${averageRating}を使用
${langStatsText ? "- 口コミ言語は上記集計に記載された言語のみ言及。外国語口コミに言及する場合は言語別集計の評価内訳と矛盾しないこと（低評価が中心の言語を「海外から支持」等と書かない）" : ""}`;

  // 数値照合で弾かれた場合の修正指示を最後に置く（直前の指示ほど効きやすいため）
  return correction ? `${prompt}\n\n【必ず守ること・最優先】\n${correction}` : prompt;
}

/** Claude系のAI総評で使うモデル・トークン設定（同期/Batchで共通にする） */
export const ANALYZE_MODEL = "claude-sonnet-4-6";
// ページ総評を1文→2〜3文に増量したため出力が長い（12フィールド×最大180字）。4096だと途中で切れるリスクがある
export const ANALYZE_MAX_TOKENS = 8192;

/**
 * Claudeの応答テキストをパースし、ワード厳密検証・整形・pageComments組み立てまで行う。
 * 失敗（JSONなし・パース不能）はnull。
 */
export function parseAnalyzeText(text: string, filteredReviews: GBPReview[]): any | null {
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
}

/**
 * コメント・サマリー内の評価値を公式値で強制置換（DB保存前に確定させる）。
 * analysisを直接書き換える。
 */
export function applyFixRating(analysis: any, officialRating: number): void {
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
    analysis.pageComments = fixed;
  }
}

/** report_analysisへのupsert。エラーメッセージ（成功ならnull）を返す */
export async function saveAnalysisRow(
  supabase: SupabaseClient,
  args: {
    shopName: string;
    shopId: string | null;
    analysis: any;
    officialRating: number;
    officialCount: number;
    targetMonth: string | null;
  }
): Promise<string | null> {
  const { shopName, shopId, analysis, officialRating, officialCount, targetMonth } = args;
  const { error } = await supabase
    .from("report_analysis")
    .upsert(
      {
        shop_name: shopName,
        shop_id: shopId,
        positive_words: analysis.positiveWords,
        negative_words: analysis.negativeWords,
        positive_word_sources: analysis.positiveWordSources || [],
        negative_word_sources: analysis.negativeWordSources || [],
        summary: analysis.summary,
        comments: analysis.comments,
        page_comments: analysis.pageComments || null,
        review_count: officialCount,
        average_rating: officialRating,
        target_month: targetMonth,
        analyzed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "shop_name,target_month" }
    );
  return error ? error.message : null;
}
