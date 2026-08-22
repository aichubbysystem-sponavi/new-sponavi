/**
 * レポートデータ取得モジュール
 * Supabaseキャッシュ → スプレッドシートフォールバック
 */

import type { ReportData, ShopListItem, GridRankingReport, GridRankingMonthData } from "./report-data";
import { readShopListFromCache, readReportDataFromCache, writeReportDataToCache } from "./report-cache";
import { normalizeKw } from "./keyword-normalize";
import { getShopsFromSpreadsheet, getReportFromSpreadsheet } from "./spreadsheet";
import { getSupabase } from "@/lib/supabase";
import { reportMonthFromMeasuredAt } from "@/lib/month-utils";

/** "2025/10" → 202510 のように数値化して月ソート */
function monthToNum(m: string): number {
  const parts = m.split("/");
  return (parseInt(parts[0]) || 0) * 100 + (parseInt(parts[1]) || 0);
}
function sortByMonth<T extends { month: string }>(arr: T[]): T[] {
  return arr.sort((a, b) => monthToNum(a.month) - monthToNum(b.month));
}

/**
 * 店舗一覧を取得（キャッシュ優先）
 */
export async function getShopList(): Promise<{
  shops: ShopListItem[];
  source: "cache" | "spreadsheet" | "mock";
}> {
  // 1. Supabaseキャッシュから取得（高速）
  try {
    const cached = await readShopListFromCache();
    if (cached && cached.length > 0) {
      // カテゴリをshopsテーブルから付与
      try {
        const sb = getSupabase();
        const { data: catRows } = await sb.from("shops").select("name, gbp_main_category").not("gbp_main_category", "is", null);
        if (catRows) {
          const catMap = new Map(catRows.map((r: any) => [r.name, r.gbp_main_category]));
          for (const shop of cached) {
            const cat = catMap.get(shop.name);
            if (cat) shop.category = cat;
          }
        }
      } catch {}
      return { shops: cached, source: "cache" };
    }
  } catch {}

  // 2. フォールバック: スプレッドシートから取得
  const shops = await getShopsFromSpreadsheet();
  if (shops && shops.length > 0) {
    return { shops, source: "spreadsheet" };
  }

  return { shops: [], source: "mock" };
}

/**
 * 店舗名からshops.idを全て取得（同名重複対策）
 */
async function getShopDbIds(shopName: string): Promise<string[]> {
  try {
    const sb = getSupabase();
    // 完全一致で取得（重複時は1件に絞る）
    const { data } = await sb
      .from("shops")
      .select("id")
      .eq("name", shopName)
      .limit(1);
    if (data && data.length > 0) return [data[0].id];
    // GBP上の店名で一致するか（GBP改名後にシート側が新名になっているケース）
    // 危険な部分一致より先に、完全一致であるこちらを試す
    const { data: byGbp } = await sb
      .from("shops")
      .select("id")
      .eq("gbp_shop_name", shopName)
      .limit(1);
    if (byGbp && byGbp.length > 0) return [byGbp[0].id];
    // 部分一致フォールバック
    const simpleName = shopName.replace(/[【】\[\]（）()]/g, " ").replace(/\s+/g, " ").trim();
    const { data: fuzzy } = await sb
      .from("shops")
      .select("id, name")
      .ilike("name", `%${simpleName.split(" ")[0]}%`)
      .limit(10);
    if (fuzzy && fuzzy.length > 0) {
      const normalize = (s: string) => s.replace(/[【】\[\]（）()_\s]/g, "").toLowerCase();
      const target = normalize(shopName);
      const match = fuzzy.find(s =>
        normalize(s.name) === target ||
        target.includes(normalize(s.name)) ||
        normalize(s.name).includes(target)
      );
      if (match) return [match.id];
    }
  } catch {}
  return [];
}

/**
 * グリッド順位データをリアルタイム取得
 * shopIdsを複数受け取り、いずれかにマッチするログを取得（同名の重複店舗対策）
 */
export async function fetchGridRankingLive(shopIds: string[], shopName?: string): Promise<GridRankingReport | undefined> {
  try {
    const sb = getSupabase();

    const keywordSet = new Set<string>();
    const monthMap = new Map<string, any[]>();
    // 手動/生成データ(overrides)が存在する「KW×月」。同じKW×月の実測だけを抑止する
    // （以前は月単位スキップだったため、1件でも手動データがある月は全KWの実測が隠れていた）
    const overrideKeys = new Set<string>();

    // 1. overrides（手動編集データ）を優先読み込み
    if (shopName) {
      const { data: overrides } = await sb
        .from("grid_ranking_overrides")
        .select("keyword, month, grid_size, results, updated_at")
        .eq("shop_name", shopName)
        .order("month", { ascending: true });
      if (overrides && overrides.length > 0) {
        for (const o of overrides) {
          // キーワードの表記ゆれ（全角/半角スペース）を吸収して同一KWに統合
          const kw = normalizeKw(o.keyword);
          keywordSet.add(kw);
          // 月フォーマット統一: "2026/04"→"2026/4", "2026-04"→"2026/4"
          const month = (o.month || "unknown").replace(/-/g, "/").replace(/\/0(\d)$/, "/$1");
          overrideKeys.add(`${month}::${kw}`);
          if (!monthMap.has(month)) monthMap.set(month, []);
          const ranked = (o.results || []).filter((r: any) => r.rank > 0);
          const avg = ranked.length > 0 ? ranked.reduce((s: number, r: any) => s + r.rank, 0) / ranked.length : 0;
          monthMap.get(month)!.push({
            // overridesは計測間隔を持たない。1000と偽ると「半径1km」という架空の実測条件が表示される
            keyword: kw, gridSize: o.grid_size || 7, intervalM: null,
            results: o.results || [], measuredAt: o.updated_at, avgRank: Math.round(avg * 10) / 10,
          });
        }
      }
    }

    // 2. 実測データ（同じKW×月に手動データがある場合のみスキップ）
    const { data: logs } = await sb
      .from("grid_ranking_logs")
      .select("keyword, grid_size, interval_m, results, measured_at, report_month")
      .in("shop_id", shopIds)
      .order("measured_at", { ascending: true });
    if (logs && logs.length > 0) {
      for (const log of logs) {
        // 帰属月: report_month列を優先（月初計測=前月分。無い行のみ同一ルールで導出）
        const monthKey = log.report_month || reportMonthFromMeasuredAt(log.measured_at);
        const kw = normalizeKw(log.keyword);
        // 同一KW×同一月に手動/生成データがあれば実測はスキップ（手動を優先）
        if (overrideKeys.has(`${monthKey}::${kw}`)) continue;
        keywordSet.add(kw);
        if (!monthMap.has(monthKey)) monthMap.set(monthKey, []);
        const results = log.results || [];
        const ranked = results.filter((r: any) => r.rank > 0);
        const avg = ranked.length > 0 ? ranked.reduce((s: number, r: any) => s + r.rank, 0) / ranked.length : 0;
        monthMap.get(monthKey)!.push({
          keyword: kw, gridSize: log.grid_size, intervalM: log.interval_m,
          results, measuredAt: log.measured_at, avgRank: Math.round(avg * 10) / 10,
        });
      }
    }

    if (keywordSet.size === 0) return undefined;

    const history: any[] = [];
    for (const entry of Array.from(monthMap.entries())) {
      const [month, snapshots] = entry;
      const byKw = new Map<string, any>();
      for (const s of snapshots) {
        const existing = byKw.get(s.keyword);
        if (!existing || new Date(s.measuredAt) > new Date(existing.measuredAt)) {
          byKw.set(s.keyword, s);
        }
      }
      history.push({ month, snapshots: Array.from(byKw.values()) });
    }
    sortByMonth(history);

    const result: GridRankingReport = { keywords: Array.from(keywordSet), history };
    return result.keywords.length > 0 ? result : undefined;
  } catch (e) {
    console.error("[report-api] grid ranking live error:", e);
    return undefined;
  }
}

/**
 * rankingHistoryから不足月のグリッドデータを補完
 * grid_ranking_overrides/logsにない月を、シート（P7キーワード順位）の実値1地点で埋める。
 *
 * 【2026-08-22 変更】以前はシートの中心順位1個から決定論ハッシュで48地点分の順位を
 * 作り出して7×7に見せていた（generateSimpleGrid）。多地点計測を始める前の月まで
 * 「49地点を計測した」体の地図が出てしまい、クライアントに架空の実測値を見せていた。
 * 実在するのはシートの1順位だけなので、gridSize=1・1地点のスナップショットにする。
 */
export function supplementGridFromRanking(
  gridRanking: GridRankingReport | undefined,
  rankingHistory: { labels: string[]; datasets: { word: string; ranks: (number | null)[]; outOfRange?: boolean[] }[] }
): GridRankingReport | undefined {
  if (!rankingHistory || rankingHistory.labels.length === 0) return gridRanking;

  // 実測/手動データをコピーし、不足分（KW×月単位）だけシート順位で補完する
  // （以前は月単位だったため、実測がある月のシートのみKWが欠けていた）
  const newHistory: GridRankingMonthData[] = (gridRanking?.history || []).map(h => ({ ...h, snapshots: [...h.snapshots] }));
  const monthIndex = new Map<string, number>(newHistory.map((h, i) => [h.month, i]));
  const allKeywords = new Set(gridRanking?.keywords || []);

  // シート順位1件＝計測地点1つ。座標は持たない（表示側で店舗位置に置く）
  const singlePointGrid = (rank: number) => [{ lat: 0, lng: 0, rank, row: 0, col: 0 }];

  for (let i = 0; i < rankingHistory.labels.length; i++) {
    const month = rankingHistory.labels[i];
    const mi = monthIndex.get(month);
    // この月に既にデータがあるKW（実測/手動）はシート値で上書きしない
    const existingKws = mi !== undefined
      ? new Set(newHistory[mi].snapshots.map(s => normalizeKw(s.keyword)))
      : new Set<string>();

    // この月のシート順位を1地点スナップショットにする（不足KWのみ）
    const snapshots: any[] = [];
    for (const ds of rankingHistory.datasets) {
      const sheetRank = ds.ranks[i];
      // 空欄（未計測）は補完しない。「圏外」と明記されたセルだけ -1 として計測済み扱いにする
      // （両方をnullのまま落とすと、圏外の月が「未計測」に見えて推移が途切れる）
      const rank = sheetRank !== null && sheetRank > 0 ? sheetRank
        : ds.outOfRange?.[i] ? -1
        : null;
      if (rank === null) continue;
      const word = normalizeKw(ds.word);
      if (existingKws.has(word)) continue;
      allKeywords.add(word);
      const results = singlePointGrid(rank);
      snapshots.push({
        keyword: word,
        gridSize: 1,
        intervalM: null, // 1地点＝範囲を持たない（半径表記を出さない）
        results,
        measuredAt: new Date().toISOString(),
        avgRank: rank > 0 ? rank : 0,
      });
    }
    if (snapshots.length > 0) {
      if (mi !== undefined) {
        newHistory[mi].snapshots.push(...snapshots);
      } else {
        newHistory.push({ month, snapshots });
        monthIndex.set(month, newHistory.length - 1);
      }
    }
  }

  if (newHistory.length === 0) return gridRanking;

  sortByMonth(newHistory);
  return { keywords: Array.from(allKeywords), history: newHistory };
}

/**
 * 特定店舗のレポートデータを取得（キャッシュ優先）
 * gridRankingは常にリアルタイム取得（計測結果は頻繁に更新されるため）
 */
export async function getReportData(
  shopId: string,
  targetMonth?: string,
  opts?: {
    /** true: シートへのリアルタイム順位取得を省略してキャッシュ値をそのまま使う（高速表示用）。 */
    skipSheets?: boolean;
  },
): Promise<{
  data: ReportData | null;
  source: "cache" | "spreadsheet" | "mock";
}> {
  const shopName = decodeURIComponent(shopId);

  // targetMonthのゼロパディング正規化: "2026/04" → "2026/4"（perfDataの月フォーマットに合わせる）
  const normalizedMonth = targetMonth
    ? targetMonth.replace(/\/0+(\d)/, "/$1")
    : undefined;

  // 1. Supabaseキャッシュから取得（高速）
  try {
    const cached = await readReportDataFromCache(shopName);
    if (cached) {
      // ── 外部取得・DB照会を並列実行（従来は直列で待ち時間が積み上がっていた）──

      // A. rankingHistory + keywords をシートからリアルタイム取得（skipSheets時は省略しキャッシュ値のまま）
      const sheetsPromise = opts?.skipSheets
        ? Promise.resolve(null)
        : (async () => {
            try {
              const { fetchRankingAndHistoryFromSheets } = await import("./ranking-fetch");
              return await fetchRankingAndHistoryFromSheets(shopName);
            } catch { return null; }
          })();

      // B. gridRankingはリアルタイムで上書き（overrides + 実測データ）
      const gridPromise = (async (): Promise<GridRankingReport | undefined> => {
        try {
          const dbIds = await getShopDbIds(shopName);
          return await fetchGridRankingLive(dbIds.length > 0 ? dbIds : ["_"], shopName);
        } catch (gErr: any) {
          console.error("[report-api] fetchGridRankingLive error (continuing with cached):", gErr?.message?.slice(0, 100));
          return cached.gridRanking;
        }
      })();

      // C. searchQueries + パフォーマンスメトリクスをDBキャッシュからリアルタイム取得
      const overlayPromise = (async () => {
        try {
          const sb = getSupabase();
          const { data: shopRow } = await sb.from("shops").select("id, gbp_location_name").eq("name", shopName).limit(1).maybeSingle();
          if (!shopRow?.id) return;
          await Promise.all([
            // 検索語句
            (async () => {
              try {
                const { getCachedSearchKeywords } = await import("./gbp-search-keywords");
                const cachedKw = await getCachedSearchKeywords(shopRow.id);
                if (cachedKw.length > 0) {
                  const latest = cachedKw[cachedKw.length - 1];
                  cached.searchQueries = {
                    latest: latest.keywords.slice(0, 30),
                    latestMonth: latest.month,
                    history: cachedKw,
                  };
                }
              } catch (kwErr: any) {
                console.error(`[report-api] searchKw error:`, kwErr?.message);
              }
            })(),
            // パフォーマンスメトリクス（performance_metrics_cache → 月次推移・KPIを上書き）
            (async () => {
              try {
                const { getCachedPerformance } = await import("./gbp-performance");
                const rawPerfData = await getCachedPerformance(shopRow.id, shopName);
            const perfData = rawPerfData.slice(-13);
            if (perfData.length > 0) {
              const labels = perfData.map(p => p.month);
              // targetMonth指定時: 該当月をcurとして使用、なければ最新月
              const curIdx = normalizedMonth ? perfData.findIndex(p => p.month === normalizedMonth) : perfData.length - 1;
              const effectiveIdx = curIdx >= 0 ? curIdx : perfData.length - 1;
              const cur = perfData[effectiveIdx];
              const prev = effectiveIdx >= 1 ? perfData[effectiveIdx - 1] : null;
              // 前年同月を探す
              const curParts = cur.month.split("/").map(Number);
              const yoyMonth = `${curParts[0] - 1}/${curParts[1]}`;
              const yoy = perfData.find(p => p.month === yoyMonth) || null;

              // charts 更新
              cached.monthlyLabels = labels;
              cached.charts = {
                ...cached.charts,
                searchMobile: perfData.map(p => p.searchMobile),
                searchPC: perfData.map(p => p.searchPC),
                mapMobile: perfData.map(p => p.mapMobile),
                mapPC: perfData.map(p => p.mapPC),
                calls: perfData.map(p => p.calls),
                routes: perfData.map(p => p.routes),
                websites: perfData.map(p => p.websites),
                foodMenus: perfData.map(p => p.foodMenus),
                bookings: perfData.map(p => p.bookings),
              };

              // KPIs 更新（KPI[] 配列形式、既存の口コミKPIは保持）
              const reviewKpi = cached.kpis.find(k => k.label.includes("口コミ"));
              cached.kpis = [
                { label: "Googleマップ 合計", value: cur.mapMobile + cur.mapPC, prevValue: prev ? prev.mapMobile + prev.mapPC : 0, unit: "回", momValue: prev ? prev.mapMobile + prev.mapPC : null, yoyValue: yoy ? yoy.mapMobile + yoy.mapPC : null },
                { label: "Google検索 合計", value: cur.searchMobile + cur.searchPC, prevValue: prev ? prev.searchMobile + prev.searchPC : 0, unit: "回", momValue: prev ? prev.searchMobile + prev.searchPC : null, yoyValue: yoy ? yoy.searchMobile + yoy.searchPC : null },
                { label: "ウェブサイトクリック", value: cur.websites, prevValue: prev?.websites ?? 0, unit: "件", momValue: prev?.websites ?? null, yoyValue: yoy?.websites ?? null },
                { label: "ルート検索", value: cur.routes, prevValue: prev?.routes ?? 0, unit: "件", momValue: prev?.routes ?? null, yoyValue: yoy?.routes ?? null },
                { label: "通話", value: cur.calls, prevValue: prev?.calls ?? 0, unit: "件", momValue: prev?.calls ?? null, yoyValue: yoy?.calls ?? null },
                { label: "フードメニュークリック", value: cur.foodMenus, prevValue: prev?.foodMenus ?? 0, unit: "件", momValue: prev?.foodMenus ?? null, yoyValue: yoy?.foodMenus ?? null },
                { label: "予約", value: cur.bookings, prevValue: prev?.bookings ?? 0, unit: "件", momValue: prev?.bookings ?? null, yoyValue: yoy?.bookings ?? null },
                ...(reviewKpi ? [reviewKpi] : []),
              ];

              // shop.period 更新
              const lastDay = new Date(curParts[0], curParts[1], 0).getDate();
              cached.shop = {
                ...cached.shop,
                period: {
                  start: `${curParts[0]}/${String(curParts[1]).padStart(2, "0")}/01`,
                  end: `${curParts[0]}/${String(curParts[1]).padStart(2, "0")}/${lastDay}`,
                },
              };
                }
              } catch (e: any) {
                console.error("[report-api] perf overlay error (cache path):", e?.message || e);
              }
            })(),
          ]);
        } catch {}
      })();

      // D. カテゴリをshopsテーブルから付与
      const categoryPromise = (async () => {
        if (cached.shop.category) return;
        try {
          const sb = getSupabase();
          const { data: catRow } = await sb.from("shops").select("gbp_main_category").eq("name", shopName).not("gbp_main_category", "is", null).limit(1).maybeSingle();
          if (catRow?.gbp_main_category) cached.shop.category = catRow.gbp_main_category;
        } catch {}
      })();

      const [freshSheets, liveGrid] = await Promise.all([sheetsPromise, gridPromise, overlayPromise, categoryPromise]);

      // シート取得結果を反映（キャッシュは古い値のままになるため）
      if (freshSheets) {
        if (freshSheets.history.labels.length > 0) {
          cached.rankingHistory = freshSheets.history;
        }
        if (freshSheets.ranks.length > 0) {
          cached.keywords = freshSheets.ranks.map(r => ({ word: r.word, rank: r.rank, prevRank: r.prevRank }));
        }
      }

      // gridRanking: rankingHistoryから補完（fetchGridRankingLiveが失敗しても実行）
      let gridRanking: GridRankingReport | undefined = liveGrid;
      try {
        if (cached.rankingHistory) {
          gridRanking = supplementGridFromRanking(gridRanking, cached.rankingHistory);
        }
        if (gridRanking) cached.gridRanking = gridRanking;
      } catch (sErr: any) {
        console.error("[report-api] supplementGrid error:", sErr?.message);
      }

      // reviewAnalysisもDBからリアルタイム取得（再分析反映のため）
      // 表示月が指定されていればその月の分析を優先取得、なければ最新
      // （表示月はperfオーバーレイ後のmonthlyLabelsに依存するため、並列フェーズの後に実行）
      try {
        const { getStoredAnalysis } = await import("./review-analyzer");
        const displayMonth = normalizedMonth || (cached.monthlyLabels?.length ? cached.monthlyLabels[cached.monthlyLabels.length - 1] : undefined);
        const stored = await getStoredAnalysis(shopName, displayMonth) || await getStoredAnalysis(shopName);
        if (stored) {
          cached.reviewAnalysis = stored.analysis;
          cached.comments = stored.comments;
          cached.pageComments = stored.pageComments || null;
          cached.analysisTargetMonth = stored.targetMonth || null;
          // 分析時点も必ず差し替える。これが無いと、総評だけ最新に入れ替わったのに
          // 日付はキャッシュ書き込み時の古い値（または未設定で非表示）のままになり、
          // 表示中の総評と日付が食い違う。配信の主経路はこちら側
          cached.analysisDate = stored.analyzedAt || null;
        }
      } catch {}
      // 口コミ競合比較: 当月ならDB→無ければ取得保存(¥4.8・月1回)、過去月はDB読みのみ
      try {
        const { loadCompetitorComparison } = await import("./competitor-fetch");
        cached.competitorComparison = await loadCompetitorComparison(
          shopName,
          normalizedMonth || (cached.monthlyLabels?.length ? cached.monthlyLabels[cached.monthlyLabels.length - 1] : undefined),
        );
      } catch { cached.competitorComparison = null; }
      return { data: cached, source: "cache" };
    }
  } catch {}

  // 2. フォールバック: スプレッドシート+API取得 → 自動キャッシュ
  let reportData: ReportData | null = null;
  let dataSource: "cache" | "spreadsheet" | "mock" = "mock";
  try {
    const data = await getReportFromSpreadsheet(shopName);
    if (data) {
      try { await writeReportDataToCache(shopName, data); } catch {}
      reportData = data;
      dataSource = "spreadsheet";
    }
  } catch (e) {
    console.error("[report-api] getReportFromSpreadsheet error:", e);
  }

  if (!reportData) return { data: null, source: "mock" };

  // スプレッドシートパスでもパフォーマンス・検索語句のDBキャッシュを上書き
  try {
    const sb = getSupabase();
    const { data: shopRow } = await sb.from("shops").select("id").eq("name", shopName).limit(1).maybeSingle();
    if (shopRow?.id) {
      // パフォーマンスメトリクス上書き
      try {
        const { getCachedPerformance } = await import("./gbp-performance");
        const rawPerfData2 = await getCachedPerformance(shopRow.id, shopName);
        const perfData = rawPerfData2.slice(-13);
        if (perfData.length > 0) {
          const labels = perfData.map(p => p.month);
          // targetMonth指定時: 該当月をcurとして使用、なければ最新月
          const curIdx2 = normalizedMonth ? perfData.findIndex(p => p.month === normalizedMonth) : perfData.length - 1;
          const effectiveIdx2 = curIdx2 >= 0 ? curIdx2 : perfData.length - 1;
          const cur = perfData[effectiveIdx2];
          const prev = effectiveIdx2 >= 1 ? perfData[effectiveIdx2 - 1] : null;
          const curParts = cur.month.split("/").map(Number);
          const yoyMonth = `${curParts[0] - 1}/${curParts[1]}`;
          const yoy = perfData.find(p => p.month === yoyMonth) || null;
          const reviewKpi = reportData.kpis.find(k => k.label.includes("口コミ"));

          reportData.monthlyLabels = labels;
          reportData.charts = {
            ...reportData.charts,
            searchMobile: perfData.map(p => p.searchMobile),
            searchPC: perfData.map(p => p.searchPC),
            mapMobile: perfData.map(p => p.mapMobile),
            mapPC: perfData.map(p => p.mapPC),
            calls: perfData.map(p => p.calls),
            routes: perfData.map(p => p.routes),
            websites: perfData.map(p => p.websites),
            foodMenus: perfData.map(p => p.foodMenus),
            bookings: perfData.map(p => p.bookings),
          };
          reportData.kpis = [
            { label: "Googleマップ 合計", value: cur.mapMobile + cur.mapPC, prevValue: prev ? prev.mapMobile + prev.mapPC : 0, unit: "回", momValue: prev ? prev.mapMobile + prev.mapPC : null, yoyValue: yoy ? yoy.mapMobile + yoy.mapPC : null },
            { label: "Google検索 合計", value: cur.searchMobile + cur.searchPC, prevValue: prev ? prev.searchMobile + prev.searchPC : 0, unit: "回", momValue: prev ? prev.searchMobile + prev.searchPC : null, yoyValue: yoy ? yoy.searchMobile + yoy.searchPC : null },
            { label: "ウェブサイトクリック", value: cur.websites, prevValue: prev?.websites ?? 0, unit: "件", momValue: prev?.websites ?? null, yoyValue: yoy?.websites ?? null },
            { label: "ルート検索", value: cur.routes, prevValue: prev?.routes ?? 0, unit: "件", momValue: prev?.routes ?? null, yoyValue: yoy?.routes ?? null },
            { label: "通話", value: cur.calls, prevValue: prev?.calls ?? 0, unit: "件", momValue: prev?.calls ?? null, yoyValue: yoy?.calls ?? null },
            { label: "フードメニュークリック", value: cur.foodMenus, prevValue: prev?.foodMenus ?? 0, unit: "件", momValue: prev?.foodMenus ?? null, yoyValue: yoy?.foodMenus ?? null },
            { label: "予約", value: cur.bookings, prevValue: prev?.bookings ?? 0, unit: "件", momValue: prev?.bookings ?? null, yoyValue: yoy?.bookings ?? null },
            ...(reviewKpi ? [reviewKpi] : []),
          ];
          const lastDay = new Date(curParts[0], curParts[1], 0).getDate();
          reportData.shop = {
            ...reportData.shop,
            period: {
              start: `${curParts[0]}/${String(curParts[1]).padStart(2, "0")}/01`,
              end: `${curParts[0]}/${String(curParts[1]).padStart(2, "0")}/${lastDay}`,
            },
          };
        }
      } catch (e2: any) {
        console.error("[report-api] perf overlay error (spreadsheet path):", e2?.message || e2);
      }

      // 検索語句上書き
      try {
        const { getCachedSearchKeywords } = await import("./gbp-search-keywords");
        const cachedKw = await getCachedSearchKeywords(shopRow.id);
        if (cachedKw.length > 0) {
          const latest = cachedKw[cachedKw.length - 1];
          reportData.searchQueries = {
            latest: latest.keywords.slice(0, 30),
            latestMonth: latest.month,
            history: cachedKw,
          };
        }
      } catch (e3: any) {
        console.error("[report-api] search kw overlay error (spreadsheet path):", e3?.message || e3);
      }
    }
  } catch (e4: any) {
    console.error("[report-api] overlay shopRow lookup error:", e4?.message || e4);
  }

  return { data: reportData, source: dataSource };
}
