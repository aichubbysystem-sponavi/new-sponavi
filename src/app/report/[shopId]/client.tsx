"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import DOMPurify from "isomorphic-dompurify";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useRole } from "@/components/role-provider";
import { can, PERMISSION_DENIED_HINT } from "@/lib/permissions";
import { normalizeKw } from "@/lib/keyword-normalize";

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { Bar, Line } from "react-chartjs-2";
import type { ReportData, NegativeWordSource } from "@/lib/report-data";
import {
  SLIDE_W, SLIDE_H, COLORS,
  SEARCH_QUERIES_PER_PAGE,
  pctChange, monthToNum, rankColor, rankColorModal, rankTextColor,
  fmtAvgRank, rankTrend, rankCoverage, isYoyComparable, parseStartMonth,
  reorderKpis, centerCell, gridLayoutLabel,
} from "@/lib/report-utils";
import {
  slideStyle, slideBarStyle, slideBodyStyle, stitleStyle,
  kpiTopColors,
} from "./report-styles";

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend, Filler);

import { buildStackedOptions, lineOptions } from "./chart-options";


// ── Component ──

export default function ReportClient({
  data, shopId, dataSource = "mock", googleReviewUrl = null, targetMonth: targetMonthProp,
}: {
  data: ReportData; shopId: string; dataSource?: "cache" | "spreadsheet" | "mock"; googleReviewUrl?: string | null; targetMonth?: string;
}) {
  const { role } = useRole();
  const canData = can(role, "DATA_OP");   // コメント更新・表示設定保存・グリッド生成/保存
  const canPaid = can(role, "PAID_OP");   // このファイル内では未使用（AI課金系ボタンなし）
  const canMemo = can(role, "MEMO");      // メモ保存（社員も可）

  const [accessDenied, setAccessDenied] = useState(false);

  // アクセス権チェック
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch("/api/report/my-shops", { headers });
        if (cancelled) return;
        if (!res.ok) { setAccessDenied(true); return; }
        const { shops } = await res.json();
        if (cancelled) return;
        if (shops === "all") return; // president
        const shopName = decodeURIComponent(shopId);
        const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
        const hasAccess = (shops as string[]).some((n: string) => norm(n) === norm(shopName));
        if (!hasAccess) setAccessDenied(true);
      } catch {
        if (!cancelled) setAccessDenied(true);
      }
    })();
    return () => { cancelled = true; };
  }, [shopId]);

  // サーバーから渡されたtargetMonthを優先、フォールバックでURLから取得
  const [targetMonth, setTargetMonth] = useState(targetMonthProp || "");
  useEffect(() => {
    if (targetMonthProp) return;
    const params = new URLSearchParams(window.location.search);
    setTargetMonth(params.get("month") || "");
  }, [targetMonthProp]);

  // 指定月がデータに存在するか
  const monthNotFound = targetMonth && !data.monthlyLabels.includes(targetMonth);
  const latestMonth = data.monthlyLabels[data.monthlyLabels.length - 1] || "";

  // 対象月でデータを切り詰め
  const trimmedData = useMemo(() => {
    if (!targetMonth) return data;
    // フォーマット正規化: "2026/04" → "2026/4"（ゼロパディング除去）
    const normalized = targetMonth.replace(/\/0+(\d)/, "/$1");
    let idx = data.monthlyLabels.indexOf(targetMonth);
    if (idx < 0) idx = data.monthlyLabels.indexOf(normalized);
    if (idx < 0) return data; // 指定月が見つからなければ最新月を表示

    const endIdx = idx + 1;
    const trimArray = <T,>(arr: T[]) => arr.slice(0, endIdx);

    // KPIを対象月の値で再計算
    const charts = data.charts;
    const newCharts = {
      searchMobile: trimArray(charts.searchMobile),
      searchPC: trimArray(charts.searchPC),
      mapMobile: trimArray(charts.mapMobile),
      mapPC: trimArray(charts.mapPC),
      calls: trimArray(charts.calls),
      routes: trimArray(charts.routes),
      websites: trimArray(charts.websites),
      bookings: trimArray(charts.bookings),
      foodMenus: trimArray(charts.foodMenus),
    };

    // searchTotal/mapTotalの合計を再計算
    const searchTotal = (newCharts.searchMobile[idx] || 0) + (newCharts.searchPC[idx] || 0);
    const mapTotal = (newCharts.mapMobile[idx] || 0) + (newCharts.mapPC[idx] || 0);

    // KPIを対象月の値に差し替え
    const prevIdx = idx > 0 ? idx - 1 : -1;
    // 前年同月のインデックス
    const yoyIdx = idx >= 12 ? idx - 12 : -1;
    const getVal = (arr: number[], i: number) => i >= 0 && i < arr.length ? arr[i] : 0;

    // 期間パース（KPI再計算・ラベル変更で使用）
    const m = targetMonth.match(/(\d{4})\/(\d{1,2})/);

    const newKpis = data.kpis.map(kpi => {
      // KPIのlabelでチャートデータを特定（「ルート検索」が「検索」に先行マッチしないよう順序に注意）
      if (kpi.label.includes("ルート")) return { ...kpi, value: getVal(charts.routes, idx), prevValue: getVal(charts.routes, prevIdx), momValue: prevIdx >= 0 ? getVal(charts.routes, prevIdx) : null, yoyValue: yoyIdx >= 0 ? getVal(charts.routes, yoyIdx) : null };
      if (kpi.label.includes("検索")) {
        const cur = searchTotal;
        const prev = prevIdx >= 0 ? getVal(charts.searchMobile, prevIdx) + getVal(charts.searchPC, prevIdx) : 0;
        const yoy = yoyIdx >= 0 ? getVal(charts.searchMobile, yoyIdx) + getVal(charts.searchPC, yoyIdx) : null;
        return { ...kpi, value: cur, prevValue: prev, momValue: prev || null, yoyValue: yoy };
      }
      if (kpi.label.includes("マップ")) {
        const cur = mapTotal;
        const prev = prevIdx >= 0 ? getVal(charts.mapMobile, prevIdx) + getVal(charts.mapPC, prevIdx) : 0;
        const yoy = yoyIdx >= 0 ? getVal(charts.mapMobile, yoyIdx) + getVal(charts.mapPC, yoyIdx) : null;
        return { ...kpi, value: cur, prevValue: prev, momValue: prev || null, yoyValue: yoy };
      }
      if (kpi.label.includes("ウェブ")) return { ...kpi, value: getVal(charts.websites, idx), prevValue: getVal(charts.websites, prevIdx), momValue: prevIdx >= 0 ? getVal(charts.websites, prevIdx) : null, yoyValue: yoyIdx >= 0 ? getVal(charts.websites, yoyIdx) : null };
      if (kpi.label.includes("通話")) return { ...kpi, value: getVal(charts.calls, idx), prevValue: getVal(charts.calls, prevIdx), momValue: prevIdx >= 0 ? getVal(charts.calls, prevIdx) : null, yoyValue: yoyIdx >= 0 ? getVal(charts.calls, yoyIdx) : null };
      if (kpi.label.includes("メニュー")) return { ...kpi, value: getVal(charts.foodMenus, idx), prevValue: getVal(charts.foodMenus, prevIdx), momValue: prevIdx >= 0 ? getVal(charts.foodMenus, prevIdx) : null, yoyValue: yoyIdx >= 0 ? getVal(charts.foodMenus, yoyIdx) : null };
      if (kpi.label.includes("予約")) return { ...kpi, value: getVal(charts.bookings, idx), prevValue: getVal(charts.bookings, prevIdx), momValue: prevIdx >= 0 ? getVal(charts.bookings, prevIdx) : null, yoyValue: yoyIdx >= 0 ? getVal(charts.bookings, yoyIdx) : null };
      // 口コミ増減を表示月のreviewDeltaから再計算
      if (kpi.label.includes("口コミ") && m) {
        // reviewDeltaのトリム後末尾 = 対象月の増減数
        const trimmedDelta = data.reviewDelta.slice(0, (() => {
          const targetYM2 = parseInt(m[1]) * 100 + parseInt(m[2]);
          const isSlash = data.reviewLabels[0]?.includes("/");
          if (isSlash) {
            for (let ri = 0; ri < data.reviewLabels.length; ri++) {
              const p = data.reviewLabels[ri].split("/");
              if ((parseInt(p[0]) || 0) * 100 + (parseInt(p[1]) || 0) > targetYM2) return ri;
            }
          } else {
            const baseYear = parseInt((data.monthlyLabels[0] || "2026").split("/")[0]) || 2026;
            let ry = baseYear;
            for (let ri = 0; ri < data.reviewLabels.length; ri++) {
              const rm = (data.reviewLabels[ri] || "").match(/(\d{1,2})/);
              if (rm) {
                const mn = parseInt(rm[1]);
                if (ri > 0) { const prev = (data.reviewLabels[ri-1]||"").match(/(\d{1,2})/); if (prev && parseInt(prev[1]) > mn) ry++; }
                if (ry * 100 + mn > targetYM2) return ri;
              }
            }
          }
          return data.reviewLabels.length;
        })());
        const deltaValue = trimmedDelta.length > 0 ? trimmedDelta[trimmedDelta.length - 1] ?? 0 : kpi.value;
        // 前年同月の口コミ累計
        const trimmedCounts = data.reviewCounts.slice(0, trimmedDelta.length);
        const curCount = trimmedCounts.length > 0 ? trimmedCounts[trimmedCounts.length - 1] : null;
        const yoyCount = trimmedCounts.length >= 13 ? trimmedCounts[trimmedCounts.length - 13] : (trimmedCounts.length > 0 ? trimmedCounts[0] : null);
        return { ...kpi, label: `口コミ増減【${m[1]}/${m[2]}】`, value: deltaValue, yoyValue: yoyCount };
      }
      return kpi;
    });
    const lastDay = m ? new Date(parseInt(m[1]), parseInt(m[2]), 0).getDate() : 0;
    const newPeriod = m ? {
      start: `${m[1]}/${String(m[2]).padStart(2, "0")}/01`,
      end: `${m[1]}/${String(m[2]).padStart(2, "0")}/${lastDay}`,
    } : data.shop.period;

    // rankingHistoryもフィルタ
    const newRankingHistory = data.rankingHistory ? {
      ...data.rankingHistory,
      labels: data.rankingHistory.labels.filter(l => l <= targetMonth),
      datasets: data.rankingHistory.datasets.map(ds => ({
        ...ds,
        ranks: ds.ranks.slice(0, data.rankingHistory.labels.filter(l => l <= targetMonth).length),
        // ranksと同じ長さに揃えないと月とのインデックス対応がずれる
        outOfRange: ds.outOfRange?.slice(0, data.rankingHistory.labels.filter(l => l <= targetMonth).length),
      })),
    } : data.rankingHistory;

    // reviewLabels/reviewCounts/reviewDeltaをレポート対象月でトリム
    // reviewLabelsは "4月","5月"等の形式（年情報なし）。monthlyLabelsの先頭年を基準に年を推定
    const tmMatch = targetMonth.match(/(\d{4})\/(\d{1,2})/);
    const targetYM = tmMatch ? parseInt(tmMatch[1]) * 100 + parseInt(tmMatch[2]) : 0;
    let reviewTrimIdx = data.reviewLabels.length;
    if (targetYM > 0 && data.reviewLabels.length > 0) {
      // reviewLabelsが "2025/4" 形式か "4月" 形式かを判定
      const isSlashFormat = data.reviewLabels[0].includes("/");
      if (isSlashFormat) {
        // "2025/4" 形式: 数値変換して比較
        const toYM = (s: string) => { const p = s.split("/"); return (parseInt(p[0]) || 0) * 100 + (parseInt(p[1]) || 0); };
        for (let ri = 0; ri < data.reviewLabels.length; ri++) {
          if (toYM(data.reviewLabels[ri]) > targetYM) { reviewTrimIdx = ri; break; }
        }
      } else {
        // "4月" 形式: 年推定が必要
        const baseYear = parseInt((data.monthlyLabels[0] || "2026").split("/")[0]) || 2026;
        let runningYear = baseYear;
        for (let ri = 0; ri < data.reviewLabels.length; ri++) {
          const rm = (data.reviewLabels[ri] || "").match(/(\d{1,2})/);
          if (rm) {
            const monthNum = parseInt(rm[1]);
            if (ri > 0) {
              const prev = (data.reviewLabels[ri - 1] || "").match(/(\d{1,2})/);
              if (prev && parseInt(prev[1]) > monthNum) runningYear++;
            }
            if (runningYear * 100 + monthNum > targetYM) { reviewTrimIdx = ri; break; }
          }
        }
      }
    }

    // searchQueriesもフィルタ
    const newSearchQueries = data.searchQueries ? {
      ...data.searchQueries,
      history: data.searchQueries.history.filter(h => h.month <= targetMonth),
      latest: (() => {
        const filtered = data.searchQueries.history.filter(h => h.month <= targetMonth);
        return filtered.length > 0 ? filtered[filtered.length - 1].keywords.slice(0, 30) : data.searchQueries.latest;
      })(),
      latestMonth: targetMonth,
    } : data.searchQueries;

    return {
      ...data,
      monthlyLabels: data.monthlyLabels.slice(0, endIdx),
      charts: newCharts,
      kpis: newKpis,
      shop: { ...data.shop, period: newPeriod },
      rankingHistory: newRankingHistory,
      searchQueries: newSearchQueries,
      reviewLabels: data.reviewLabels.slice(0, reviewTrimIdx),
      reviewCounts: data.reviewCounts.slice(0, reviewTrimIdx),
      reviewDelta: data.reviewDelta.slice(0, reviewTrimIdx),
    };
  }, [data, targetMonth]);

  const { shop, kpis: rawKpis, monthlyLabels, charts, keywords, rankingHistory, reviewLabels, reviewCounts, reviewDelta, reviewAnalysis, searchQueries, gridRanking, competitorComparison } = trimmedData;

  // 全期間で値が0の指標を自動判定（業種によって「予約」「フードメニュー」等がない場合）
  const hasBookingsData = charts.bookings?.some(v => v > 0) ?? false;
  const hasFoodMenusData = charts.foodMenus?.some(v => v > 0) ?? false;

  // 表示月の口コミ累計（reviewCountsのトリム済み末尾 = 対象月の値）
  const displayTotalReviews = reviewCounts.length > 0 ? reviewCounts[reviewCounts.length - 1] : shop.totalReviews;

  const hasKeywords = keywords.length > 0 || !!(gridRanking && gridRanking.history.length > 0);
  const hasReviews = reviewCounts.length > 0;
  const hasSearchQueries = searchQueries && searchQueries.latest.length > 0;
  const hasGridRanking = !!(gridRanking && gridRanking.keywords.length > 0 && gridRanking.history.length > 0);
  const [sqMonthIdx, setSqMonthIdx] = useState(-1); // -1 = 最新月
  const [gridKwIdx, setGridKwIdx] = useState(0);
  const [gridMonthIdx, setGridMonthIdx] = useState(-1); // -1 = 最新月
  const gridMapRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const gridGoogleMapRefs = useRef<Record<string, any>>({});
  const gridMarkersRefs = useRef<Record<string, any[]>>({});
  const curLabel = monthlyLabels[monthlyLabels.length - 1] || "";
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [memo, setMemo] = useState("");
  const [memoSaved, setMemoSaved] = useState(false);
  const [memoEditing, setMemoEditing] = useState(false);
  const [memoLoading, setMemoLoading] = useState(false);

  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // ページ別AI総評（各データページ末尾に表示・編集）
  const emptyPageComments = {
    monthly: "", map: "", search: "", reactions: "", keyword: "", rankingHistory: "",
    grid: "", searchQuery: "", reviewCount: "", reviewDelta: "", language: "", competitor: "",
    reviews: [] as string[], actions: [] as string[],
  };
  // 過去に生成された分析は一部フィールドを持たないため、既定値とマージして欠損キーを埋める
  const mergePageComments = (pc: Partial<typeof emptyPageComments> | null | undefined) => ({
    ...emptyPageComments,
    ...(pc || {}),
  });
  const [pageComments, setPageComments] = useState(() => mergePageComments(trimmedData.pageComments));
  const [pcEditingKey, setPcEditingKey] = useState<keyof typeof emptyPageComments | null>(null);
  const [pcEditingValue, setPcEditingValue] = useState<string>("");
  const [pcSaving, setPcSaving] = useState(false);
  const [pcSavedKey, setPcSavedKey] = useState<string | null>(null);
  const [pcError, setPcError] = useState("");
  // 月切替・2段階フェッチでpropsが差し替わってもReportClientはアンマウントされないため、
  // useStateの初期値だけでは前月のAI総評が residual として残る。props変化時に同期する。
  const propPageComments = trimmedData.pageComments;
  useEffect(() => {
    setPageComments(mergePageComments(propPageComments));
    setPcEditingKey(null);
    setPcError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propPageComments]);

  const startEditPageComment = (key: keyof typeof emptyPageComments) => {
    const v = pageComments[key];
    setPcEditingKey(key);
    setPcEditingValue(Array.isArray(v) ? v.join("\n") : v);
    setPcError("");
  };
  const savePageComment = async () => {
    if (!pcEditingKey) return;
    setPcSaving(true);
    setPcError("");
    const nextValue = Array.isArray(pageComments[pcEditingKey])
      ? pcEditingValue.split("\n").map(s => s.trim()).filter(Boolean)
      : pcEditingValue;
    const next = { ...pageComments, [pcEditingKey]: nextValue };
    try {
      const authH = await getAuthHeaders();
      if (!authH.Authorization) {
        setPcError("ログインが必要です");
        setPcSaving(false);
        return;
      }
      const res = await fetch("/api/report/update-page-comments", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authH },
        body: JSON.stringify({ shopName: shop.name, targetMonth: trimmedData.analysisTargetMonth || curLabel, pageComments: next }),
      });
      if (res.ok) {
        setPageComments(next);
        setPcSavedKey(pcEditingKey);
        setPcEditingKey(null);
        setTimeout(() => setPcSavedKey(null), 2000);
      } else {
        const err = await res.json().catch(() => ({}));
        setPcError(err.error || `保存に失敗しました (${res.status})`);
      }
    } catch (e: any) {
      setPcError(e?.message || "保存に失敗しました");
    }
    setPcSaving(false);
  };
  const [showSettings, setShowSettings] = useState(false);
  const [negativeModal, setNegativeModal] = useState<{ word: string; reviews: { reviewer: string; comment: string; reply?: string | null; date: string; starRating: string }[]; type?: "positive" | "negative"; matched?: boolean } | null>(null);
  const [editingGridCell, setEditingGridCell] = useState<{ row: number; col: number } | null>(null);
  const [editingGridValue, setEditingGridValue] = useState("");
  const [gridGenerating, setGridGenerating] = useState(false);
  const [gridEditMonth, setGridEditMonth] = useState("");
  const [gridEditKw, setGridEditKw] = useState("");
  const [gridManualRank, setGridManualRank] = useState(""); // シートに順位がない月用の中心順位手入力

  // セクション表示ON/OFF（店舗ごとにDB保存、localStorageはフォールバック）
  const visKey = `report-visibility-${shopId}`;
  const [sectionVisibility, setSectionVisibility] = useState<Record<string, boolean>>({
    keywords: true,
    rankingHistory: true,
    searchQueries: true,
    gridRanking: true,
    competitors: true,
    metricBookings: true,
    metricFoodMenus: true,
  });

  // 個別キーワード表示ON/OFF
  const kwVisKey = `report-kw-visibility-${shopId}`;
  const [kwVisibility, setKwVisibility] = useState<Record<string, boolean>>({});

  // 口コミ分析ワード個別ON/OFF
  const rwVisKey = `report-rw-visibility-${shopId}`;
  const [rwVisibility, setRwVisibility] = useState<Record<string, boolean>>({});

  // ハイドレーション完了フラグ
  const [mounted, setMounted] = useState(false);

  // DB保存（種類ごとに独立したデバウンスタイマー）
  const saveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const saveToDb = useCallback((field: "sectionVisibility" | "kwVisibility" | "rwVisibility", value: Record<string, boolean>) => {
    if (!canData) return; // 表示設定の保存は社長・幹部のみ（サーバー側でも403）
    if (saveTimersRef.current[field]) clearTimeout(saveTimersRef.current[field]);
    saveTimersRef.current[field] = setTimeout(async () => {
      const authH = await getAuthHeaders();
      fetch(`/api/report/display-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authH },
        body: JSON.stringify({ shopId, [field]: value }),
      }).catch(() => {});
    }, 500);
  }, [shopId, canData]);

  useEffect(() => {
    setMounted(true);
    // DBから読み込み → localStorageフォールバック
    getAuthHeaders().then(authH =>
    fetch(`/api/report/display-settings?shopId=${encodeURIComponent(shopId)}`, { headers: authH })
      .then(r => r.json())
      .then(data => {
        if (data.section_visibility && Object.keys(data.section_visibility).length > 0) {
          setSectionVisibility(prev => ({ ...prev, ...data.section_visibility }));
        } else {
          try { const s = localStorage.getItem(visKey); if (s) setSectionVisibility(prev => ({ ...prev, ...JSON.parse(s) })); } catch {}
        }
        if (data.kw_visibility && Object.keys(data.kw_visibility).length > 0) {
          setKwVisibility(data.kw_visibility);
        } else {
          try { const s = localStorage.getItem(kwVisKey); if (s) setKwVisibility(JSON.parse(s)); } catch {}
        }
        if (data.rw_visibility && Object.keys(data.rw_visibility).length > 0) {
          setRwVisibility(data.rw_visibility);
        } else {
          try { const s = localStorage.getItem(rwVisKey); if (s) setRwVisibility(JSON.parse(s)); } catch {}
        }
      })
      .catch(() => {
        // DB読み込み失敗 → localStorageから復元
        try {
          const saved = localStorage.getItem(visKey);
          if (saved) setSectionVisibility(prev => ({ ...prev, ...JSON.parse(saved) }));
          const kwSaved = localStorage.getItem(kwVisKey);
          if (kwSaved) setKwVisibility(JSON.parse(kwSaved));
          const rwSaved = localStorage.getItem(rwVisKey);
          if (rwSaved) setRwVisibility(JSON.parse(rwSaved));
        } catch {}
      })
    );
  }, [shopId, visKey, kwVisKey, rwVisKey]);

  const toggleSection = (key: string) => {
    setSectionVisibility(prev => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem(visKey, JSON.stringify(next));
      saveToDb("sectionVisibility", next);
      return next;
    });
  };

  const toggleKeyword = (word: string, current: boolean) => {
    setKwVisibility(prev => {
      const next = { ...prev, [word]: !current };
      localStorage.setItem(kwVisKey, JSON.stringify(next));
      saveToDb("kwVisibility", next);
      return next;
    });
  };

  const toggleReviewWord = (word: string) => {
    setRwVisibility(prev => {
      const next = { ...prev, [word]: prev[word] === false ? true : false };
      localStorage.setItem(rwVisKey, JSON.stringify(next));
      saveToDb("rwVisibility", next);
      return next;
    });
  };

  // ログイン状態チェック
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setIsLoggedIn(!!data.session?.access_token);
    });
  }, []);

  // 口コミ言語別データ
  const [langStats, setLangStats] = useState<{ lang: string; country: string; total: number; star1: number; star2: number; star3: number; star4: number; star5: number; lowRatingCount: number }[]>([]);
  const [langLoading, setLangLoading] = useState(false);
  useEffect(() => {
    if (!shopId) return;
    let cancelled = false;
    (async () => {
      setLangLoading(true);
      try {
        const authH = await getAuthHeaders();
        const shopName = decodeURIComponent(shopId);
        const res = await fetch("/api/report/review-language-stats", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authH },
          body: JSON.stringify({ shopNames: [shopName] }),
        });
        if (cancelled) return;
        if (res.ok) {
          const d = await res.json();
          if (!cancelled) setLangStats(d.stats || []);
        } else {
          console.error("[lang-stats] API error:", res.status, await res.text().catch(() => ""));
        }
      } catch (e) {
        console.error("[lang-stats] fetch error:", e);
      }
      if (!cancelled) setLangLoading(false);
    })();
    return () => { cancelled = true; };
  }, [shopId]);

  // 指標の表示判定: 自動（データ0で非表示）+ 手動ON/OFF
  const hasBookings = hasBookingsData && sectionVisibility.metricBookings !== false;
  const hasFoodMenus = hasFoodMenusData && sectionVisibility.metricFoodMenus !== false;
  const kpis = reorderKpis(rawKpis.filter(kpi => {
    if (kpi.label === "予約" && !hasBookings) return false;
    if (kpi.label === "フードメニュークリック" && !hasFoodMenus) return false;
    return true;
  }));

  // ── 統一順位系列（P6順位変動・P7順位推移の共通ソース）──
  // 多地点計測の「中心地点（店舗所在地）の順位」を正とし、
  // 計測がない月・KWはシート順位で補完する。
  // グリッド側は 手動生成(overrides) > 実測(logs) > シート推定 の合成済みなので、
  // 実質の優先順位は 手動 > 実測 > シート。KWは正規化して表記ゆれを統合。
  const unifiedRankingHistory = useMemo(() => {
    // グリッドの中心順位を「月::KW」で索引化
    const centerByMonthKw = new Map<string, number>();
    const gridMonths = new Set<string>();
    // 「その月にそのKWを計測したか」。順位が付かなかった時に
    // 「圏外」と「未計測」を区別するために必要（区別しないと未計測を圏外転落と誤報告する）
    const measuredMonthKw = new Set<string>();
    for (const h of gridRanking?.history || []) {
      if (curLabel && monthToNum(h.month) > monthToNum(curLabel)) continue;
      for (const s of h.snapshots) {
        // centerCell: 偶数グリッド（斜め4地点計測）は中心なし→undefined→シート順位フォールバックへ
        const cell = centerCell(s.results, s.gridSize);
        if (s.results.length > 0) measuredMonthKw.add(`${h.month}::${normalizeKw(s.keyword)}`);
        if (cell && cell.rank > 0) {
          centerByMonthKw.set(`${h.month}::${normalizeKw(s.keyword)}`, cell.rank);
          gridMonths.add(h.month);
        } else if (s.results.length > 0) {
          // 4地点計測などで中心順位が無くても「グリッド計測が存在する月」としては数える
          gridMonths.add(h.month);
        }
      }
    }
    const sheetLabels = rankingHistory?.labels || [];
    // 月ラベル: シート ∪ グリッド を時系列ソート（空月の除去は datasets 構築後に行う）
    const allLabels = Array.from(new Set([...sheetLabels, ...Array.from(gridMonths)]))
      .sort((a, b) => monthToNum(a) - monthToNum(b));
    // KW: シート ∪ グリッド（正規化で統合、シート順を優先）
    const words: string[] = [];
    const seen = new Set<string>();
    for (const ds of rankingHistory?.datasets || []) {
      const w = normalizeKw(ds.word);
      if (!seen.has(w)) { seen.add(w); words.push(w); }
    }
    for (const kw of gridRanking?.keywords || []) {
      const w = normalizeKw(kw);
      if (!seen.has(w)) { seen.add(w); words.push(w); }
    }
    const sheetByWord = new Map((rankingHistory?.datasets || []).map(ds => [normalizeKw(ds.word), ds]));
    const fullDatasets = words.map(w => ({
      word: w,
      ranks: allLabels.map(m => {
        // 1. グリッド中心点（手動 > 実測 > シート推定 の合成結果）
        const g = centerByMonthKw.get(`${m}::${w}`);
        if (g && g > 0) return g;
        // 2. シート順位
        const ds = sheetByWord.get(w);
        if (ds) {
          const i = sheetLabels.indexOf(m);
          const r = i >= 0 ? ds.ranks[i] : null;
          return r && r > 0 ? r : null;
        }
        return null;
      }),
      // 順位が付かなかった月が「圏外」か「未計測」かの判定材料。
      // グリッド計測があった月に加え、シートに明示的に「圏外」と記録された月も計測済みとする
      measured: allLabels.map(m => {
        if (measuredMonthKw.has(`${m}::${w}`)) return true;
        const ds = sheetByWord.get(w);
        if (!ds) return false;
        const i = sheetLabels.indexOf(m);
        if (i < 0) return false;
        return ds.ranks[i] != null && ds.ranks[i]! > 0 ? true : ds.outOfRange?.[i] === true;
      }),
    }));
    // 全KWが「順位なし・計測なし」の月はシートに空行があるだけのノイズ列
    // （Queencyでは13列中10列が全KW「-」だった）。注記「計測が無い月は列に含まれません」を
    // 事実にするためここで除去する。ただし当月(curLabel)列だけは空でも必ず残す —
    // 消すと直近の順位あり月が最終列となり、過去の順位が「当月の順位」として表示されてしまう
    const keepIdx = allLabels
      .map((m, i) => ({ m, i }))
      .filter(({ m, i }) => m === curLabel || fullDatasets.some(ds => ds.ranks[i] != null || ds.measured[i]))
      .map(({ i }) => i)
      .slice(-13);
    const labels = keepIdx.map(i => allLabels[i]);
    const datasets = fullDatasets.map(ds => ({
      word: ds.word,
      ranks: keepIdx.map(i => ds.ranks[i]),
      measured: keepIdx.map(i => ds.measured[i]),
    }));
    return { labels, datasets };
  }, [gridRanking, rankingHistory, curLabel]);

  // P6順位変動カード用: 統一系列の選択月の値（P7順位推移テーブルの最新列と一致）
  const effectiveKeywords = useMemo(() => {
    const lastIdx = unifiedRankingHistory.labels.length - 1;
    if (lastIdx < 0) {
      // シート履歴もグリッドも無い店舗向けフォールバック（シート最新行の順位）
      // シート最新行の順位そのもの＝シート上で計測済みの値なので curMeasured は true
      // （falseにすると順位0のKWが「圏外」ではなく「未計測」と表示されてしまう）
      return keywords.map(kw => ({ ...kw, word: normalizeKw(kw.word), prevMonth: "", firstMeasure: false, curMeasured: true }));
    }
    return unifiedRankingHistory.datasets.map(ds => {
      const rank = ds.ranks[lastIdx] ?? 0;
      // 前回表示用: 直近でデータがある月の順位とその月ラベル（前月とは限らない）
      let prevRank = 0;
      let prevMonth = "";
      for (let i = lastIdx - 1; i >= 0; i--) {
        const r = ds.ranks[i];
        if (r !== null && r > 0) { prevRank = r; prevMonth = unifiedRankingHistory.labels[i]; break; }
      }
      // 過去に一度も順位が無い＝今回が初計測（prevRank=rankのフォールバック表示と区別する）
      const firstMeasure = prevRank === 0 && (rank || 0) > 0;
      // 当月に順位が無い場合、計測済みなら「圏外」・未計測なら「未計測」と表示を分ける
      const curMeasured = ds.measured?.[lastIdx] === true;
      return { word: ds.word, rank: rank || 0, prevRank: prevRank || rank || 0, prevMonth, firstMeasure, curMeasured };
    });
  }, [unifiedRankingHistory, keywords]);

  // 表示するキーワードのみフィルタ
  // 順位が一度も付いていないKWは初期OFF（チェックを入れると圏外として表示）、順位ありKWは初期ON
  const visibleKeywords = effectiveKeywords.filter(kw => kwVisibility[kw.word] ?? (kw.rank > 0 || kw.prevRank > 0));
  const visibleRankingDatasets = unifiedRankingHistory.datasets.filter(ds => {
    // 全期間データなし（全て null）のキーワードは初期OFF、チェックONで表示
    const hasAnyData = ds.ranks.some((r: number | null) => r !== null);
    return kwVisibility[ds.word] ?? hasAnyData; // wordは正規化済み
  });

  // 個別キーワードの表示設定を多地点順位計測スライドにも連動させる
  // （チェックOFFのKWはチップ・比較テーブル・KW別スライド・PDFから除外）
  const visibleGridRanking = useMemo(() => {
    if (!gridRanking) return gridRanking;
    const effVisible = (word: string) => {
      const w = normalizeKw(word);
      const entry = effectiveKeywords.find(k => k.word === w);
      return kwVisibility[w] ?? kwVisibility[word] ?? (entry ? entry.rank > 0 || entry.prevRank > 0 : true);
    };
    return {
      keywords: gridRanking.keywords.filter(effVisible),
      history: gridRanking.history.map(h => ({ ...h, snapshots: h.snapshots.filter(s => effVisible(s.keyword)) })),
    };
  }, [gridRanking, effectiveKeywords, kwVisibility]);

  const showKeywords = mounted && sectionVisibility.keywords !== false && hasKeywords;
  const showRankingHistory = mounted && sectionVisibility.rankingHistory !== false && unifiedRankingHistory.labels.length > 0;
  const showSearchQueries = mounted && sectionVisibility.searchQueries !== false && hasSearchQueries;
  const showGridRanking = mounted && sectionVisibility.gridRanking !== false && hasGridRanking && (visibleGridRanking?.keywords.length ?? 0) > 0;
  const showCompetitors = mounted && sectionVisibility.competitors !== false && (competitorComparison?.competitors?.length ?? 0) > 0;

  // グリッドマップ用: 現在表示中のスナップショットを取得
  const activeGridKw = visibleGridRanking?.keywords[gridKwIdx] || visibleGridRanking?.keywords[0] || "";
  // マップ描画用: レポート対象月以前の直近6ヶ月（グリッドセクション描画と同じ基準）
  const gridRecentHistory = useMemo(() => {
    if (!visibleGridRanking) return [];
    return visibleGridRanking.history.filter(h => monthToNum(h.month) <= monthToNum(curLabel)).slice(-6);
  }, [visibleGridRanking, curLabel]);
  const activeGridMonthI = gridMonthIdx >= 0 && gridMonthIdx < gridRecentHistory.length ? gridMonthIdx : gridRecentHistory.length - 1;
  const activeGridSnapshot = gridRecentHistory[activeGridMonthI]?.snapshots.find(s => s.keyword === activeGridKw);

  // Google Maps JS API読み込み + マーカー描画（キーワード別）
  // labelYOffset: PDFキャプチャ時にラベルを上方補正（html2canvasのSVGテキストズレ対策）
  const renderGridMapForKw = useCallback((kw: string, labelYOffset: number = 0, hideControls: boolean = false) => {
    const mapEl = gridMapRefs.current[kw];
    if (!mapEl || !window.google?.maps) return;
    const monthI = gridMonthIdx >= 0 && gridMonthIdx < gridRecentHistory.length ? gridMonthIdx : gridRecentHistory.length - 1;
    const snap = gridRecentHistory[monthI]?.snapshots.find(s => s.keyword === kw);
    if (!snap) return;
    let pts = snap.results;
    if (pts.length === 0) return;
    const gs = snap.gridSize;

    // 座標なしデータ（overrides）の場合、shop.lat/lngから仮座標を生成
    const hasCoords = pts.some(p => p.lat && p.lng);
    if (!hasCoords && shop.lat && shop.lng) {
      const interval = 1000;
      const center = Math.floor(gs / 2);
      pts = pts.map(p => ({
        ...p,
        lat: shop.lat + ((p.row - center) * interval * -0.000009),
        lng: shop.lng + ((p.col - center) * interval * 0.000011),
      }));
    }

    // centerCell: 偶数グリッド（4地点計測）は中心なし→重心（4点対称なら店舗位置と一致）にフォールバック
    const centerPt = centerCell(pts, gs);
    const cLat = centerPt?.lat ?? pts.reduce((s, p) => s + p.lat, 0) / pts.length;
    const cLng = centerPt?.lng ?? pts.reduce((s, p) => s + p.lng, 0) / pts.length;

    // 既存マップを破棄して毎回新規作成（キーワード切替時の描画ズレ防止）
    if (gridGoogleMapRefs.current[kw]) {
      // 既存マーカー削除
      (gridMarkersRefs.current[kw] || []).forEach(m => m.setMap(null));
      gridMarkersRefs.current[kw] = [];
    }

    const gmap = new window.google.maps.Map(mapEl, {
      center: { lat: cLat, lng: cLng }, zoom: 13,
      mapTypeControl: !hideControls, streetViewControl: false, fullscreenControl: false, zoomControl: !hideControls,
      styles: [
        { featureType: "poi", stylers: [{ visibility: "off" }] },
        { featureType: "transit", stylers: [{ visibility: "off" }] },
      ],
    });
    gridGoogleMapRefs.current[kw] = gmap;
    gridMarkersRefs.current[kw] = [];

    const bounds = new window.google.maps.LatLngBounds();

    pts.forEach(pt => {
      const iconObj: any = {
        path: window.google.maps.SymbolPath.CIRCLE,
        fillColor: rankColor(pt.rank), fillOpacity: 0.9,
        strokeColor: "#fff", strokeWeight: 2, scale: 18,
      };
      iconObj.labelOrigin = new window.google.maps.Point(0, labelYOffset);
      const marker = new window.google.maps.Marker({
        position: { lat: pt.lat, lng: pt.lng },
        map: gmap,
        icon: iconObj,
        label: { text: pt.rank > 0 ? String(pt.rank) : "-", color: "#fff", fontWeight: "bold", fontSize: "14px" },
      });
      gridMarkersRefs.current[kw].push(marker);
      bounds.extend({ lat: pt.lat, lng: pt.lng });
    });

    // 店舗中心マーカー
    const cm = new window.google.maps.Marker({
      position: { lat: cLat, lng: cLng }, map: gmap,
      icon: { path: window.google.maps.SymbolPath.BACKWARD_CLOSED_ARROW, fillColor: "#000", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2, scale: 6 },
      zIndex: 999,
    });
    gridMarkersRefs.current[kw].push(cm);
    gmap.fitBounds(bounds, 40);
  }, [gridRecentHistory, gridMonthIdx, shop.lat, shop.lng]);

  useEffect(() => {
    if (!showGridRanking || !gridRanking) return;
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";
    if (!apiKey) return;

    const renderAllMaps = () => {
      if (!window.google?.maps) return;
      gridRanking.keywords.forEach(kw => {
        if (gridMapRefs.current[kw]) renderGridMapForKw(kw);
      });
    };

    const tryRender = () => {
      if (window.google?.maps) { renderAllMaps(); return; }
      const existing = document.getElementById("google-maps-script");
      if (existing) { existing.addEventListener("load", renderAllMaps); return; }
      const script = document.createElement("script");
      script.id = "google-maps-script";
      script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=marker`;
      script.async = true; script.defer = true;
      script.onload = renderAllMaps;
      document.head.appendChild(script);
    };

    // DOMにマウントされるまで少し待つ
    const timer = setTimeout(tryRender, 300);
    return () => clearTimeout(timer);
  }, [showGridRanking, gridRanking, renderGridMapForKw]);

  // ワードクリック: 直近1年の口コミからAPI検索。0件なら分析時に保存した根拠口コミ（word_sources）を表示
  // （分析の「直近1年」は対象月基準・検索APIは今日基準のため、境界の口コミは日が経つと検索で見つからなくなる）
  const handleWordClick = async (word: string, source: { word: string; reviews: { reviewer: string; comment: string; date: string; starRating: string }[] } | undefined, type: "positive" | "negative") => {
    const sourceReviews = source?.reviews?.filter(r => r.comment) || [];
    try {
      const authH = await getAuthHeaders();
      const res = await fetch(`/api/report/search-reviews?shop=${encodeURIComponent(shop.name)}&keyword=${encodeURIComponent(word)}&type=${type}`, { headers: authH });
      const data = await res.json();
      if (data.reviews?.length > 0) {
        setNegativeModal({ word, reviews: data.reviews, type, matched: data.matched });
      } else {
        setNegativeModal({ word, reviews: sourceReviews, type, matched: sourceReviews.length > 0 });
      }
    } catch {
      setNegativeModal({ word, reviews: sourceReviews, type, matched: sourceReviews.length > 0 });
    }
  };

  // メモをSupabaseから読み込み
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const authH = await getAuthHeaders();
        const res = await fetch(`/api/report/memo?shopName=${encodeURIComponent(shop.name)}&month=${encodeURIComponent(curLabel)}`, { headers: authH });
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && data.memo) setMemo(data.memo);
        }
      } catch (e) {
        console.error("[memo] fetch error:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [shop.name, curLabel]);

  const saveMemo = async () => {
    setMemoLoading(true);
    try {
      const authH = await getAuthHeaders();
      const res = await fetch("/api/report/memo", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authH },
        body: JSON.stringify({ shopName: shop.name, month: curLabel, memo }),
      });
      if (res.ok) {
        setMemoSaved(true);
        setMemoEditing(false);
        setTimeout(() => setMemoSaved(false), 2000);
      }
    } catch {}
    setMemoLoading(false);
  };

  const handlePdfDownload = async () => {
    setPdfGenerating(true);
    const insertedEls: HTMLElement[] = [];
    // メモが空の最終ページはno-printで除外されるため、印刷時の分母から差し引く
    const hiddenTrailingPages = memo ? 0 : 1;
    try {
      if (!visibleGridRanking || visibleGridRanking.keywords.length === 0) {
        // グリッドランキングなし → 分母だけ補正してprint
        if (hiddenTrailingPages > 0) {
          const printTotal = totalPages - hiddenTrailingPages;
          document.querySelectorAll<HTMLElement>(".pn-label").forEach(el => {
            const text = el.textContent || "";
            const match = text.match(/^(\d+)\s*\/\s*(\d+)$/);
            if (!match) return;
            el.dataset.origPn = text;
            el.textContent = `${match[1]} / ${printTotal}`;
          });
          const restore = () => {
            document.querySelectorAll<HTMLElement>(".pn-label").forEach(el => {
              if (el.dataset.origPn) { el.textContent = el.dataset.origPn; delete el.dataset.origPn; }
            });
          };
          window.addEventListener("afterprint", restore, { once: true });
          setTimeout(restore, 5000);
        }
        window.print();
        setPdfGenerating(false);
        return;
      }

      const gr = visibleGridRanking;
      // 対象月に計測が無いKWをPDFに出すと、地図タイルもマーカーも無い
      // 真っ白な枠＋「平均順位: -位」のスライドになるため除外する（2026-07-31）
      const pdfTargetHistory = gr.history.filter(h => monthToNum(h.month) <= monthToNum(curLabel)).slice(-6);
      // 月セレクタで選択中の月＝実際にキャプチャされる月。ここを最新月固定にすると
      // 「地図は選択月・平均順位は最新月」という食い違いが起きる
      const pdfMonthI = gridMonthIdx >= 0 && gridMonthIdx < pdfTargetHistory.length ? gridMonthIdx : pdfTargetHistory.length - 1;
      const pdfTargetMonth = pdfTargetHistory[pdfMonthI];
      const pdfKwEntries = gr.keywords
        .map((kw, idx) => ({ kw, idx, snap: pdfTargetMonth?.snapshots.find(s => s.keyword === kw) }))
        .filter(e => (e.snap?.results?.length ?? 0) > 0);
      const pdfKws = pdfKwEntries.map(e => e.kw);
      const pdfMapPairCount = Math.ceil(pdfKws.length / 2);
      // PDF基準: サマリー1 + マップceil(KW/2) vs web基準: サマリー1 + KW切替1
      const pageShift = pdfMapPairCount - 1; // PDF追加ページ数
      const pdfTotalPages = totalPages + pageShift - hiddenTrailingPages;
      // サマリーページ番号（summaryPageNumと同じ値を計算）
      const pdfSummaryPageNum = 5 + (showKeywords ? 1 : 0) + (showRankingHistory ? 1 : 0) + 1;

      // ── 1. マップペアスライドをDOMに生成（ヘッダーバー付き） ──
      const mapPairSlides: HTMLElement[] = [];
      for (let m = 0; m < pdfKws.length; m += 2) {
        const pairIdx = m / 2;
        const pairPageNum = pdfSummaryPageNum + 1 + pairIdx;
        const kwNames = pdfKws.slice(m, m + 2);

        const pairSlide = document.createElement("div");
        pairSlide.className = "slide grid-print-slide";
        pairSlide.style.cssText = `width:${SLIDE_W}px;height:${SLIDE_H}px;background:#f0f2f5;display:none;flex-direction:column;overflow:hidden;font-family:'Noto Sans JP',sans-serif;page-break-after:always;page-break-inside:avoid;`;

        // ヘッダーバー（他スライドと統一）
        const header = document.createElement("div");
        header.style.cssText = `background:linear-gradient(135deg,#1a1a2e,#0f3460);color:#fff;padding:12px 9px;font-size:16px;font-weight:700;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;letter-spacing:0.5px;`;
        const headerLeft = document.createElement("span");
        headerLeft.textContent = `${shop.name} — 多地点順位計測`;
        const headerRight = document.createElement("span");
        headerRight.style.cssText = "font-size:16px;opacity:0.45;font-weight:400;";
        headerRight.textContent = `${pairPageNum} / ${pdfTotalPages}`;
        header.appendChild(headerLeft);
        header.appendChild(headerRight);
        pairSlide.appendChild(header);

        // マップコンテンツ（横並び）
        const body = document.createElement("div");
        body.style.cssText = `flex:1;display:flex;flex-direction:row;align-items:stretch;overflow:hidden;`;

        for (const kwName of kwNames) {
          const mapSlot = document.createElement("div");
          mapSlot.className = "grid-print-map-slot";
          mapSlot.dataset.kw = kwName;
          mapSlot.style.cssText = `flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;padding:8px 12px;overflow:hidden;`;
          // タイトル
          const title = document.createElement("div");
          title.style.cssText = `font-size:18px;font-weight:700;color:#0f3460;border-left:5px solid #e94560;padding-left:12px;margin-bottom:8px;align-self:flex-start;`;
          title.textContent = `多地点順位 —「${kwName}」`;
          mapSlot.appendChild(title);
          // マップ（html2canvasでここだけキャプチャ）
          const mapDiv = document.createElement("div");
          mapDiv.className = "grid-print-map";
          mapDiv.style.cssText = `width:500px;height:455px;border-radius:12px;overflow:hidden;background:#e8edf5;`;
          mapSlot.appendChild(mapDiv);
          // 凡例（HTMLで直接配置、html2canvasを通さない）
          const legend = document.createElement("div");
          const legendColors = [["#2563EB","1-3位"],["#16A34A","4-10位"],["#F59E0B","11-20位"],["#EF4444","21位~"],["#6B7280","圏外"]];
          legend.style.cssText = `display:flex;font-size:18px;color:#555;margin-top:4px;width:500px;justify-content:space-between;`;
          legend.innerHTML = legendColors.map(([c,t]) => `<span><span style="display:inline-block;vertical-align:middle;width:20px;height:20px;border-radius:50%;background:${c};margin-right:6px;"></span><span style="vertical-align:middle;">${t}</span></span>`).join("");
          mapSlot.appendChild(legend);
          // 平均順位（HTMLで直接配置）
          const avgDiv = document.createElement("div");
          avgDiv.className = "grid-print-avg";
          avgDiv.dataset.kw = kwName;
          avgDiv.style.cssText = `font-size:20px;color:#555;text-align:center;width:500px;margin-top:2px;`;
          avgDiv.innerHTML = `平均順位: <span style="font-size:28px;font-weight:900;color:#94a3b8;">-</span>位`;
          mapSlot.appendChild(avgDiv);
          // 圏内率（キャプチャ後に実データで埋める）
          const covDiv = document.createElement("div");
          covDiv.className = "grid-print-cov";
          covDiv.dataset.kw = kwName;
          covDiv.style.cssText = `font-size:16px;color:#666;text-align:center;width:500px;margin-top:2px;`;
          mapSlot.appendChild(covDiv);
          body.appendChild(mapSlot);
        }
        pairSlide.appendChild(body);
        mapPairSlides.push(pairSlide);
      }

      // ── 2. DOMに挿入（最初のgrid-kw-pairの前に配置） ──
      const firstGridPair = document.querySelector(".grid-kw-pair");
      if (firstGridPair) {
        mapPairSlides.forEach(ps => {
          firstGridPair.parentElement?.insertBefore(ps, firstGridPair);
          insertedEls.push(ps);
        });
      }

      // ── 3. マップキャプチャ ──
      const html2canvas = (await import("html2canvas")).default;
      const mapSlots = document.querySelectorAll<HTMLElement>(".grid-print-map-slot");
      const origGridKwIdx = gridKwIdx;

      for (let slotIdx = 0; slotIdx < pdfKwEntries.length; slotIdx++) {
        // slotIdx=生成したスライド枠の順、kwIdx=webスライド側の元インデックス（表示切替に必要）
        const { kw, idx: kwIdx } = pdfKwEntries[slotIdx];
        setGridKwIdx(kwIdx);
        await new Promise(r => setTimeout(r, 300));
        const activeSlide = document.querySelector<HTMLElement>(".grid-kw-slide:not(.grid-kw-hidden)");
        if (activeSlide) activeSlide.scrollIntoView({ block: "center" });
        await new Promise(r => setTimeout(r, 100));
        renderGridMapForKw(kw, 0); // オフセット不要（Canvas直描画のため）
        await new Promise(r => setTimeout(r, 2000));

        const gmap = gridGoogleMapRefs.current[kw];
        const monthI = gridMonthIdx >= 0 && gridMonthIdx < gridRecentHistory.length ? gridMonthIdx : gridRecentHistory.length - 1;
        const snapForCapture = gridRecentHistory[monthI]?.snapshots.find(s => s.keyword === kw);
        const mapContainer = document.querySelector<HTMLElement>(".grid-kw-slide:not(.grid-kw-hidden) .grid-map-container");

        if (mapContainer && gmap && snapForCapture) {
          // ── 座標データ準備 ──
          let pts = snapForCapture.results;
          const gs = snapForCapture.gridSize;
          const hasCoords = pts.some((p: any) => p.lat && p.lng);
          if (!hasCoords && shop.lat && shop.lng) {
            const centerIdx = Math.floor(gs / 2);
            pts = pts.map((p: any) => ({
              ...p,
              lat: shop.lat + ((p.row - centerIdx) * 1000 * -0.000009),
              lng: shop.lng + ((p.col - centerIdx) * 1000 * 0.000011),
            }));
          }

          // ── Mercator投影で lat/lng → ピクセル座標を計算（Google Maps API不要） ──
          const mapCenter = gmap.getCenter();
          const zoom = gmap.getZoom();
          const containerW = mapContainer.offsetWidth;
          const containerH = mapContainer.offsetHeight;

          const TILE = 256;
          const s = Math.pow(2, zoom);
          const toWX = (lng: number) => TILE * (0.5 + lng / 360);
          const toWY = (lat: number) => {
            const sin = Math.sin(lat * Math.PI / 180);
            return TILE * (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI));
          };
          const cWX = toWX(mapCenter.lng()) * s;
          const cWY = toWY(mapCenter.lat()) * s;

          const markerPixels = pts.map((pt: any) => ({
            x: toWX(pt.lng) * s - cWX + containerW / 2,
            y: toWY(pt.lat) * s - cWY + containerH / 2,
            rank: pt.rank as number,
          }));

          // ── マーカーを非表示にして地図タイルだけキャプチャ ──
          const markers = gridMarkersRefs.current[kw] || [];
          markers.forEach(m => m.setMap(null));
          // 帰属表示（ロゴ・「地図の誤りを報告する」）はhtml2canvasだと半分に切れて描画されるため、
          // ここでは一旦隠し、キャプチャ後にCanvas 2Dで確実に描き直す（マーカーと同じ方式）
          const ctrlEls = mapContainer.querySelectorAll<HTMLElement>(
            ".gmnoprint, .gm-style-mtc, .gm-bundled-control, .gm-svpc, .gm-style-cc, a[href*='maps.google.com'], img[alt='Google']"
          );
          ctrlEls.forEach(el => { el.dataset.origDisplay = el.style.display; el.style.display = "none"; });
          await new Promise(r => setTimeout(r, 100));

          const h2cCanvas = await html2canvas(mapContainer, { scale: 2, useCORS: true, logging: false, backgroundColor: "#e8edf5" });

          // ── コントロール復元・マーカー復元 ──
          ctrlEls.forEach(el => { el.style.display = el.dataset.origDisplay || ""; delete el.dataset.origDisplay; });
          markers.forEach(m => m.setMap(gmap));

          // ── 新しいCanvasに地図＋マーカーを合成（html2canvasの内部状態を回避） ──
          const finalCanvas = document.createElement("canvas");
          finalCanvas.width = h2cCanvas.width;
          finalCanvas.height = h2cCanvas.height;
          const ctx = finalCanvas.getContext("2d")!;

          // 地図タイルを転写
          ctx.drawImage(h2cCanvas, 0, 0);

          // マーカーを描画
          const sf = 2; // html2canvas scale factor
          const radius = 18 * sf;
          const fontSize = 14 * sf;
          const borderW = 2 * sf;

          markerPixels.forEach(({ x, y, rank }) => {
            const cx = x * sf;
            const cy = y * sf;
            // 円（塗り）
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.fillStyle = rankColor(rank);
            ctx.globalAlpha = 0.9;
            ctx.fill();
            ctx.globalAlpha = 1;
            // 円（白枠）
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = borderW;
            ctx.stroke();
            // テキスト
            ctx.fillStyle = "#fff";
            ctx.font = `bold ${fontSize}px sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(rank > 0 ? String(rank) : "-", cx, cy);
          });

          // ── 地図の帰属表示（Googleマップの利用規約上、出力物にも必須） ──
          // html2canvas任せだと文字が切れるため、キャプチャ後に自前で描画して全文を保証する
          {
            const attrText = `地図データ ©${new Date().getFullYear()} Google`;
            const attrFS = 11 * sf;
            ctx.font = `${attrFS}px sans-serif`;
            const tw = ctx.measureText(attrText).width;
            const padX = 6 * sf, padY = 3 * sf;
            const boxH = attrFS + padY * 2;
            const boxW = tw + padX * 2;
            const bx = finalCanvas.width - boxW;
            const by = finalCanvas.height - boxH;
            ctx.fillStyle = "rgba(255,255,255,0.75)";
            ctx.fillRect(bx, by, boxW, boxH);
            ctx.fillStyle = "#3c4043";
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillText(attrText, bx + padX, by + boxH / 2);
          }

          const canvas = finalCanvas; // 以降の処理で使用

          const imgDataUrl = canvas.toDataURL("image/png");
          const slot = mapSlots[slotIdx];
          if (slot) {
            const mapDiv = slot.querySelector<HTMLElement>(".grid-print-map");
            if (mapDiv) {
              mapDiv.style.background = "none";
              mapDiv.innerHTML = `<img src="${imgDataUrl}" style="width:100%;height:100%;object-fit:contain;border-radius:12px;" />`;
            }
            // 平均順位を実データで更新
            const avgEl = slot.querySelector<HTMLElement>(".grid-print-avg");
            // キャプチャした地図と同じ月の値を出す（最新月固定だと地図と数値がずれる）
            const snapHist = pdfTargetHistory.slice(0, pdfMonthI + 1);
            const latestSnap = snapHist[snapHist.length - 1]?.snapshots.find(s => s.keyword === kw);
            if (avgEl && latestSnap) {
              // 変動は最新列基準（null除外の末尾2件比較だと未計測が「改善」になる）
              const series = snapHist.map(h => { const sn = h.snapshots.find(x => x.keyword === kw); return sn ? sn.avgRank : null; });
              const measuredArr = snapHist.map(h => h.snapshots.some(x => x.keyword === kw));
              const d = rankTrend(series, measuredArr, 1);
              const diffHtml = d.text !== "→" && d.text !== "-"
                ? `<span style="margin-left:8px;font-size:20px;font-weight:700;color:${d.color};">${d.text}</span>`
                : "";
              avgEl.innerHTML = latestSnap.avgRank > 0
                ? `平均順位: <span style="font-size:28px;font-weight:900;color:${rankTextColor(latestSnap.avgRank)};">${latestSnap.avgRank}</span>位${diffHtml}`
                : `平均順位: <span style="font-size:28px;font-weight:900;color:#94a3b8;">圏外</span>${diffHtml}`;
            }
            // 圏内率（avgRankは圏内地点のみの平均なので単体では実態を誤認させる）
            const covEl = slot.querySelector<HTMLElement>(".grid-print-cov");
            const cov = rankCoverage(latestSnap?.results);
            if (covEl && cov) {
              const c = cov.pct >= 80 ? "#15803d" : cov.pct >= 50 ? "#b45309" : "#c0392b";
              covEl.innerHTML = `圏内 <span style="font-weight:800;color:${c};">${cov.ranked}</span><span style="color:#999;"> / ${cov.total}地点（${cov.pct}%）</span>`;
            }
          }
        }
      }
      setGridKwIdx(origGridKwIdx);
      await new Promise(r => setTimeout(r, 200));
      renderGridMapForKw(gr.keywords[origGridKwIdx], 0);

      // ── 4. ページ番号をPDF基準に書き換え ──
      document.querySelectorAll<HTMLElement>(".pn-label").forEach(el => {
        const text = el.textContent || "";
        const match = text.match(/^(\d+)\s*\/\s*(\d+)$/);
        if (!match) return;
        const webNum = parseInt(match[1]);
        el.dataset.origPn = text; // 復元用に保存
        let pdfNum = webNum;
        // サマリーより後のページはシフト（サマリー自体はそのまま）
        // web: summary=N, kwPage=N+1, nextSection=N+2
        // pdf: summary=N, mapPair1=N+1...N+pairCount, nextSection=N+pairCount+1
        if (webNum > pdfSummaryPageNum) {
          pdfNum = webNum + pageShift;
        }
        el.textContent = `${pdfNum} / ${pdfTotalPages}`;
      });

      // ── 5. print用スライドを表示、元のKWスライドを非表示 ──
      insertedEls.forEach(el => { el.style.display = "flex"; });
      document.querySelectorAll<HTMLElement>(".grid-kw-pair").forEach(el => { el.dataset.prevDisplay = el.style.display; el.style.display = "none"; });

      window.scrollTo(0, 0);
      await new Promise(r => setTimeout(r, 500));
      window.print();

      // ── 6. afterprint: DOM復元 + ページ番号復元 ──
      const cleanup = () => {
        insertedEls.forEach(el => el.remove());
        insertedEls.length = 0;
        document.querySelectorAll<HTMLElement>(".grid-kw-pair").forEach(el => { el.style.display = el.dataset.prevDisplay || ""; delete el.dataset.prevDisplay; });
        // ページ番号をweb基準に復元
        document.querySelectorAll<HTMLElement>(".pn-label").forEach(el => {
          if (el.dataset.origPn) { el.textContent = el.dataset.origPn; delete el.dataset.origPn; }
        });
        setPdfGenerating(false);
      };
      window.addEventListener("afterprint", cleanup, { once: true });
      setTimeout(() => { if (insertedEls.length > 0) cleanup(); }, 5000);

    } catch (err) {
      console.error("PDF generation error:", err);
      insertedEls.forEach(el => el.remove());
      document.querySelectorAll<HTMLElement>(".grid-kw-pair").forEach(el => { el.style.display = el.dataset.prevDisplay || ""; delete el.dataset.prevDisplay; });
      document.querySelectorAll<HTMLElement>(".pn-label").forEach(el => {
        if (el.dataset.origPn) { el.textContent = el.dataset.origPn; delete el.dataset.origPn; }
      });
      window.print();
      setPdfGenerating(false);
    }
  };

  // ── Page count ──
  // 無条件ページ: P1, P2(月次), P3-P5(グラフ)=5 + 口コミ分析 + 総括 + メモ = 8
  let totalPages = 8;
  if (hasReviews) totalPages += 2; // 口コミ件数推移, 月間増加数
  if (showKeywords) totalPages++;
  if (showRankingHistory) totalPages++;
  if (showGridRanking) totalPages += 2; // サマリー1ページ + KW切替1ページ（web表示基準）
  if (langStats.length > 1) totalPages++; // 口コミ言語別分析
  if (showSearchQueries) totalPages++;
  if (showCompetitors) totalPages++; // 口コミ競合比較（同エリア）

  function pn(slideNum: number) {
    return `${slideNum} / ${totalPages}`;
  }

  // ── ページ別AI総評スニペット（各データページ末尾に表示・編集） ──
  function renderPageComment(key: keyof typeof emptyPageComments, label: string) {
    const value = pageComments[key];
    const isArr = Array.isArray(value);
    const isEmpty = isArr ? (value as string[]).length === 0 : !value;
    const isEditingThis = pcEditingKey === key;
    // 未生成でもログイン中の担当者は「追加」できる。閲覧者(クライアント)には出さない。
    if (isEmpty && !isEditingThis && !isLoggedIn) return null;
    return (
      // 中身が無い/編集中のブロックはPDFに出さない（メモ欄と同じ方針）
      // alignSelf:stretch — 親が alignItems:center の縦フレックス（口コミ件数推移・月間増加数）だと
      // 幅指定の無い子は内容幅まで縮んで中央寄せされるため、明示的に全幅へ伸ばす
      <div className={!isEmpty && !isEditingThis ? undefined : "no-print"}
        style={{ marginTop: 10, borderTop: "1px solid #e5e7eb", paddingTop: 8, flexShrink: 0, alignSelf: "stretch", width: "100%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#0f3460" }}>{label}</span>
          {isLoggedIn && (
            <div className="no-print" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {!isEditingThis ? (
                <button onClick={() => startEditPageComment(key)} style={{ fontSize: 12, padding: "2px 8px", borderRadius: 5, border: "1px solid #ccd", background: "#fff", cursor: "pointer", color: "#555" }}>{isEmpty ? "追加" : "編集"}</button>
              ) : (
                <>
                  <button onClick={savePageComment} disabled={pcSaving || !canData}
                    title={!canData ? PERMISSION_DENIED_HINT.DATA_OP : undefined}
                    style={{ fontSize: 12, padding: "2px 8px", borderRadius: 5, border: "none", background: pcSaving || !canData ? "#999" : "#0a8f3c", color: "#fff", cursor: pcSaving ? "wait" : !canData ? "not-allowed" : "pointer" }}>{pcSaving ? "保存中..." : "保存"}</button>
                  <button onClick={() => { setPcEditingKey(null); setPcError(""); }} style={{ fontSize: 12, padding: "2px 8px", borderRadius: 5, border: "1px solid #ccd", background: "#fff", cursor: "pointer", color: "#555" }}>キャンセル</button>
                </>
              )}
              {pcSavedKey === key && <span style={{ fontSize: 12, color: "#0a8f3c" }}>保存しました</span>}
              {isEditingThis && pcError && <span style={{ fontSize: 12, color: "#c0392b" }}>{pcError}</span>}
            </div>
          )}
        </div>
        {isEditingThis ? (
          <textarea value={pcEditingValue} onChange={(e) => setPcEditingValue(e.target.value)}
            placeholder={isArr ? "1行につき1項目を入力..." : "この指標についての総評を入力..."}
            style={{ width: "100%", minHeight: isArr ? 70 : 40, padding: "6px 8px", fontSize: 13, lineHeight: 1.6, border: "1px solid #ccd", borderRadius: 6, resize: "vertical", fontFamily: "inherit", color: "#333", background: "#fff" }} />
        ) : isEmpty ? (
          <p style={{ fontSize: 13, color: "#aaa", margin: 0, fontStyle: "italic" }}>未設定</p>
        ) : isArr ? (
          /* Tailwind preflightで list-style が消えるため明示指定（指定なしだと記号が出ない） */
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.7, color: "#444", listStyleType: "disc", listStylePosition: "outside" }}>
            {(value as string[]).map((v, i) => (
              <li key={i} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(v, { ALLOWED_TAGS: ["strong", "em", "br"] }) }} />
            ))}
          </ul>
        ) : (
          <p style={{ fontSize: 13, lineHeight: 1.7, color: "#444", margin: 0 }} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(value as string, { ALLOWED_TAGS: ["strong", "em", "br"] }) }} />
        )}
      </div>
    );
  }

  // ── 表示対象の月 ──
  // 対策開始前で「マップ表示もアクションも0」の先頭月は計測開始前の空データ。
  // グラフでは値0の空カラム・表では全0行のノイズになるだけなので先頭から取り除く。
  // ※これはノイズ除去であって行溢れ対策ではない。13行が固定高に収まらない問題は
  //   P2テーブルの行padding縮小(10px→4px)で別途解消済み（対策開始が古い店舗では
  //   この除外が効かず13行フルで表示されるため。2026-07-31 Queencyで発覚）
  const monthTrimStart = (() => {
    const start = parseStartMonth(shop.startDate);
    if (!start) return 0;
    let i = 0;
    while (i < monthlyLabels.length) {
      if (monthToNum(monthlyLabels[i]) >= monthToNum(start)) break;
      const mapTotal = (charts.mapMobile[i] || 0) + (charts.mapPC[i] || 0);
      const actions = (charts.calls[i] || 0) + (charts.routes[i] || 0) + (charts.websites[i] || 0)
        + (charts.bookings[i] || 0) + (charts.foodMenus[i] || 0);
      if (mapTotal > 0 || actions > 0) break; // 実データがある月は残す
      i++;
    }
    return i;
  })();
  const dispLabels = monthTrimStart > 0 ? monthlyLabels.slice(monthTrimStart) : monthlyLabels;
  const sliceM = (a: number[] | undefined) => (a || []).slice(monthTrimStart);
  const dispCharts: typeof charts = monthTrimStart > 0 ? {
    searchMobile: sliceM(charts.searchMobile), searchPC: sliceM(charts.searchPC),
    mapMobile: sliceM(charts.mapMobile), mapPC: sliceM(charts.mapPC),
    calls: sliceM(charts.calls), routes: sliceM(charts.routes),
    websites: sliceM(charts.websites), bookings: sliceM(charts.bookings),
    foodMenus: sliceM(charts.foodMenus),
  } : charts;

  // ── Monthly table data ──
  const monthlyTableData = dispLabels.map((label, i) => ({
    label,
    searchMobile: dispCharts.searchMobile[i], searchPC: dispCharts.searchPC[i],
    searchTotal: dispCharts.searchMobile[i] + dispCharts.searchPC[i],
    mapMobile: dispCharts.mapMobile[i], mapPC: dispCharts.mapPC[i],
    mapTotal: dispCharts.mapMobile[i] + dispCharts.mapPC[i],
    calls: dispCharts.calls[i], routes: dispCharts.routes[i], websites: dispCharts.websites[i],
    bookings: dispCharts.bookings[i], foodMenus: dispCharts.foodMenus[i],
    totalActions: dispCharts.calls[i] + dispCharts.routes[i] + dispCharts.websites[i] + dispCharts.bookings[i] + dispCharts.foodMenus[i],
  }));

  // ── Page numbering tracker ──
  let pageNum = 1;

  if (accessDenied) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#0a1628] to-[#1a2a44] flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-xl p-12 max-w-md text-center">
          <div className="text-5xl mb-4">🔒</div>
          <h1 className="text-xl font-bold text-[#003D6B] mb-3">アクセス権がありません</h1>
          <p className="text-slate-500 text-sm mb-6">この店舗のレポートを閲覧する権限がありません。<br />管理者にお問い合わせください。</p>
          <a href="/report" className="inline-block px-6 py-2 bg-[#003D6B] text-white rounded-lg text-sm font-semibold hover:bg-[#002a4a] transition">← レポート一覧に戻る</a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'Noto Sans JP', sans-serif", background: "#1a1a2e" }}>
      {/* Top bar (no-print) */}
      <div className="no-print" style={{ background: "rgba(0,0,0,0.3)", padding: "12px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100, backdropFilter: "blur(10px)" }}>
        <Link href="/report" style={{ color: "rgba(255,255,255,0.8)", textDecoration: "none", fontSize: 16 }}>← レポート一覧に戻る</Link>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {dataSource === "mock" && <span style={{ fontSize: 16, color: "#ffd54f", background: "rgba(255,213,79,0.15)", padding: "4px 12px", borderRadius: 20, border: "1px solid rgba(255,213,79,0.3)" }}>デモデータ</span>}
          <button onClick={() => setShowSettings(!showSettings)} style={{ background: "rgba(255,255,255,0.15)", color: "#fff", border: "1px solid rgba(255,255,255,0.3)", padding: "10px 16px", borderRadius: 8, fontSize: 16, fontWeight: 600, cursor: "pointer" }}>
            表示設定
          </button>
          <button onClick={handlePdfDownload} disabled={pdfGenerating} style={{ background: pdfGenerating ? "#999" : "linear-gradient(135deg,#e94560,#c73050)", color: "#fff", border: "none", padding: "10px 24px", borderRadius: 8, fontSize: 16, fontWeight: 600, cursor: pdfGenerating ? "wait" : "pointer" }}>
            {pdfGenerating ? "PDF生成中..." : "PDFダウンロード"}
          </button>
        </div>
      </div>

      {/* 表示設定モーダル */}
      {showSettings && (
        <div className="no-print" style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setShowSettings(false)}>
          <div style={{ background: "#1a1a2e", borderRadius: 16, padding: "28px 32px", maxWidth: 500, width: "90%", maxHeight: "80vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#fff" }}>表示設定</h3>
              <button onClick={() => setShowSettings(false)} style={{ background: "none", border: "none", fontSize: 24, cursor: "pointer", color: "rgba(255,255,255,0.5)", padding: "0 4px" }}>×</button>
            </div>
            <div style={{ marginBottom: 20 }}>
              <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 16, fontWeight: 600, display: "block", marginBottom: 10 }}>スライド表示ON/OFF</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  { key: "keywords", label: "キーワード順位", hasData: hasKeywords },
                  { key: "rankingHistory", label: "順位推移テーブル", hasData: unifiedRankingHistory.labels.length > 0 },
                  { key: "gridRanking", label: "多地点順位", hasData: hasGridRanking },
                  { key: "searchQueries", label: "検索語句", hasData: hasSearchQueries },
                  { key: "competitors", label: "口コミ競合比較", hasData: (competitorComparison?.competitors?.length ?? 0) > 0 },
                ].map(item => (
                  <label key={item.key} style={{ display: "flex", alignItems: "center", gap: 8, cursor: item.hasData ? "pointer" : "not-allowed", opacity: item.hasData ? 1 : 0.4 }}>
                    <input type="checkbox" checked={sectionVisibility[item.key] !== false && item.hasData} disabled={!item.hasData}
                      onChange={() => toggleSection(item.key)}
                      style={{ width: 16, height: 16, cursor: item.hasData ? "pointer" : "not-allowed" }} />
                    <span style={{ color: "#fff", fontSize: 16 }}>{item.label}</span>
                    {!item.hasData && <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 16 }}>（データなし）</span>}
                  </label>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 20 }}>
              <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 16, fontWeight: 600, display: "block", marginBottom: 10 }}>指標の表示/非表示</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  { key: "metricFoodMenus", label: "フードメニュークリック", hasData: hasFoodMenusData },
                  { key: "metricBookings", label: "予約", hasData: hasBookingsData },
                ].map(item => (
                  <label key={item.key} style={{ display: "flex", alignItems: "center", gap: 8, cursor: item.hasData ? "pointer" : "not-allowed", opacity: item.hasData ? 1 : 0.4 }}>
                    <input type="checkbox" checked={sectionVisibility[item.key] !== false && item.hasData} disabled={!item.hasData}
                      onChange={() => toggleSection(item.key)}
                      style={{ width: 16, height: 16, cursor: item.hasData ? "pointer" : "not-allowed" }} />
                    <span style={{ color: "#fff", fontSize: 16 }}>{item.label}</span>
                    {!item.hasData && <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 16 }}>（データなし）</span>}
                  </label>
                ))}
              </div>
            </div>
            {hasKeywords && (
              <div style={{ marginBottom: 20 }}>
                <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 16, fontWeight: 600, display: "block", marginBottom: 10 }}>個別キーワード</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {effectiveKeywords.map(kw => {
                    const checked = kwVisibility[kw.word] ?? (kw.rank > 0 || kw.prevRank > 0);
                    const noRank = kw.rank <= 0 && kw.prevRank <= 0;
                    return (
                    <label key={kw.word} style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                      <input type="checkbox" checked={checked}
                        onChange={() => toggleKeyword(kw.word, checked)}
                        style={{ width: 14, height: 14, cursor: "pointer" }} />
                      <span style={{ color: noRank ? "rgba(255,255,255,0.5)" : "#fff", fontSize: 16 }}>{kw.word}{noRank ? "（圏外）" : ""}</span>
                    </label>
                    );
                  })}
                </div>
              </div>
            )}
            {(reviewAnalysis.positiveWords.length > 0 || reviewAnalysis.negativeWords.length > 0) && (
              <div>
                <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 16, fontWeight: 600, display: "block", marginBottom: 10 }}>口コミ分析ワード</span>
                {reviewAnalysis.positiveWords.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <span style={{ color: "#27ae60", fontSize: 16, fontWeight: 600, display: "block", marginBottom: 6 }}>ポジティブ</span>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {reviewAnalysis.positiveWords.map(w => (
                        <label key={`pos-${w}`} style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                          <input type="checkbox" checked={rwVisibility[`pos:${w}`] !== false}
                            onChange={() => toggleReviewWord(`pos:${w}`)}
                            style={{ width: 14, height: 14, cursor: "pointer" }} />
                          <span style={{ color: "#a7f3d0", fontSize: 16 }}>{w}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                {reviewAnalysis.negativeWords.length > 0 && (
                  <div>
                    <span style={{ color: "#e74c3c", fontSize: 16, fontWeight: 600, display: "block", marginBottom: 6 }}>ネガティブ</span>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {reviewAnalysis.negativeWords.map(w => (
                        <label key={`neg-${w}`} style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                          <input type="checkbox" checked={rwVisibility[`neg:${w}`] !== false}
                            onChange={() => toggleReviewWord(`neg:${w}`)}
                            style={{ width: 14, height: 14, cursor: "pointer" }} />
                          <span style={{ color: "#fca5a5", fontSize: 16 }}>{w}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {/* 多地点順位グリッド編集 */}
            {hasKeywords && (() => {
              const allMonths = unifiedRankingHistory.labels;
              // 統一系列のKW（グリッドのみのKWも編集対象に含める。正規化済み）
              const allKws = unifiedRankingHistory.datasets.map(d => d.word);
              const [editMonth, setEditMonth] = [gridEditMonth, setGridEditMonth];
              const [editKw, setEditKw] = [gridEditKw, setGridEditKw];
              const selectedMonth = editMonth || allMonths[allMonths.length - 1] || "";
              const selectedKw = editKw || allKws[0] || "";
              // 現在選択中の月+KWのoverridesグリッドを取得（表記ゆれ込みで照合）
              const overrideData = gridRanking?.history.find(h => h.month === selectedMonth)?.snapshots.find(s => normalizeKw(s.keyword) === normalizeKw(selectedKw));
              const gridCells = overrideData?.results || [];
              const gridRankColorModal = rankColorModal;
              // 選択中月+KWのcenterRank（シート実測から。月indexはシート側ラベルで引く）
              const dsData = rankingHistory?.datasets?.find(d => normalizeKw(d.word) === normalizeKw(selectedKw));
              const sheetMonthIdx = rankingHistory?.labels?.indexOf(selectedMonth) ?? -1;
              const sheetRank = dsData && sheetMonthIdx >= 0 ? (dsData.ranks[sheetMonthIdx] ?? 0) : 0;
              // シートに順位がない月は手入力欄の値を採用（1〜100位）
              const manualRank = parseInt(gridManualRank) || 0;
              const centerRank = sheetRank > 0 ? sheetRank : (manualRank >= 1 && manualRank <= 100 ? manualRank : 0);

              return (
              <div style={{ marginTop: 16, borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 16 }}>
                <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 16, fontWeight: 600, display: "block", marginBottom: 10 }}>多地点順位グリッド編集</span>
                {/* 月・KW選択 */}
                <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                  <select value={selectedMonth} onChange={e => setGridEditMonth(e.target.value)}
                    style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.2)", background: "#2a2a4e", color: "#fff", fontSize: 16 }}>
                    {allMonths.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <select value={selectedKw} onChange={e => setGridEditKw(e.target.value)}
                    style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.2)", background: "#2a2a4e", color: "#fff", fontSize: 16 }}>
                    {allKws.map(k => <option key={k} value={k}>{k}</option>)}
                  </select>
                  <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 16, alignSelf: "center" }}>
                    中心順位: {sheetRank > 0 ? `${sheetRank}位` : "データなし"}
                  </span>
                  {sheetRank <= 0 && (
                    <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <input type="number" min={1} max={100} value={gridManualRank}
                        onChange={e => setGridManualRank(e.target.value)}
                        placeholder="手入力"
                        style={{ width: 74, padding: "4px 8px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.2)", background: "#2a2a4e", color: "#fff", fontSize: 16 }} />
                      <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 16 }}>位で生成</span>
                    </span>
                  )}
                </div>
                {/* 生成ボタン */}
                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                  <button onClick={async () => {
                    if (centerRank <= 0) { alert("この月のキーワード順位データがありません。中心順位を手入力してから生成してください"); return; }
                    setGridGenerating(true);
                    try {
                      const authH = await getAuthHeaders();
                      const res = await fetch("/api/report/grid-ranking-generate", {
                        method: "POST", headers: { "Content-Type": "application/json", ...authH },
                        body: JSON.stringify({ shopId, shopName: shop.name, keyword: selectedKw, month: selectedMonth, centerRank }),
                      });
                      if (!res.ok) {
                        const err = await res.json().catch(() => null);
                        alert(`生成に失敗しました: ${err?.error || `HTTP ${res.status}`}`);
                        return;
                      }
                      window.location.reload();
                    } catch (e: any) { alert(`生成に失敗しました: ${e?.message || "通信エラー"}`); } finally { setGridGenerating(false); }
                  }} disabled={gridGenerating || !canData}
                  title={!canData ? PERMISSION_DENIED_HINT.DATA_OP : undefined}
                  style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: gridGenerating || !canData ? "#666" : "#0f3460", color: "#fff", fontSize: 16, fontWeight: 600, cursor: gridGenerating ? "wait" : !canData ? "not-allowed" : "pointer" }}>
                    {gridGenerating ? "生成中..." : "この月を自動生成"}
                  </button>
                  <button onClick={async () => {
                    setGridGenerating(true);
                    try {
                      const batch: { keyword: string; month: string; centerRank: number }[] = [];
                      if (rankingHistory?.datasets && rankingHistory?.labels) {
                        for (const ds of rankingHistory.datasets) {
                          for (let i = 0; i < rankingHistory.labels.length; i++) {
                            const rank = ds.ranks[i];
                            if (rank !== null && rank > 0) batch.push({ keyword: ds.word, month: rankingHistory.labels[i], centerRank: rank });
                          }
                        }
                      }
                      if (batch.length > 0) {
                        const authH = await getAuthHeaders();
                        const res = await fetch("/api/report/grid-ranking-generate", {
                          method: "POST", headers: { "Content-Type": "application/json", ...authH },
                          body: JSON.stringify({ shopName: shop.name, shopId, batch }),
                        });
                        if (!res.ok) {
                          const err = await res.json().catch(() => null);
                          alert(`一括生成に失敗しました: ${err?.error || `HTTP ${res.status}`}`);
                          return;
                        }
                        const result = await res.json();
                        alert(`${result.count || 0}件生成（${result.skipped || 0}件は既存データ保持）`);
                        window.location.reload();
                      }
                    } catch (e: any) { alert(`一括生成に失敗しました: ${e?.message || "通信エラー"}`); } finally { setGridGenerating(false); }
                  }} disabled={gridGenerating || !canData}
                  title={!canData ? PERMISSION_DENIED_HINT.DATA_OP : undefined}
                  style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: gridGenerating || !canData ? "#666" : "#e94560", color: "#fff", fontSize: 16, fontWeight: 600, cursor: gridGenerating ? "wait" : !canData ? "not-allowed" : "pointer" }}>
                    全月一括生成
                  </button>
                </div>
                {/* 7×7 グリッド */}
                {gridCells.length > 0 ? (
                  <table style={{ borderCollapse: "collapse", margin: "0 auto" }}>
                    <tbody>
                      {Array.from({ length: 7 }, (_, row) => (
                        <tr key={row}>
                          {Array.from({ length: 7 }, (_, col) => {
                            const pt = gridCells.find((r: any) => r.row === row && r.col === col);
                            const rank = pt?.rank || 0;
                            const isCenter = row === 3 && col === 3;
                            const c = gridRankColorModal(rank);
                            const isEd = editingGridCell?.row === row && editingGridCell?.col === col;
                            return (
                              <td key={col} onClick={() => { setEditingGridCell({ row, col }); setEditingGridValue(String(rank)); }}
                                style={{ width: 42, height: 42, textAlign: "center", cursor: "pointer",
                                  background: c.bg, border: isCenter ? "2px solid #e94560" : "1px solid rgba(255,255,255,0.1)",
                                  fontWeight: 700, fontSize: rank > 0 ? 14 : 10, color: c.color, borderRadius: 4 }}>
                                {isEd ? (
                                  <input type="number" autoFocus value={editingGridValue}
                                    onChange={e => setEditingGridValue(e.target.value)}
                                    onBlur={async () => {
                                      const newRank = parseInt(editingGridValue) || 0;
                                      setEditingGridCell(null);
                                      if (newRank === rank) return;
                                      const authH = await getAuthHeaders();
                                      const res = await fetch("/api/report/grid-ranking-generate", {
                                        method: "PUT", headers: { "Content-Type": "application/json", ...authH },
                                        body: JSON.stringify({ shopName: shop.name, keyword: selectedKw, month: selectedMonth, row, col, newRank }),
                                      }).catch(() => null);
                                      if (!res || !res.ok) alert("セルの保存に失敗しました");
                                    }}
                                    onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                                    style={{ width: 32, fontSize: 16, textAlign: "center", border: "1px solid #e94560", borderRadius: 3, padding: 1, outline: "none", background: "#1a1a2e", color: "#fff" }} />
                                ) : rank > 0 ? rank : "-"}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 16, textAlign: "center", padding: 16 }}>
                    {centerRank > 0 ? "「この月を自動生成」でグリッドを作成してください" : "この月/KWの順位データがありません。中心順位を手入力して「この月を自動生成」を押してください"}
                  </div>
                )}
              </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* 指定月データなしバナー */}
      {monthNotFound && (() => {
        // 選択月が当月以降（未確定月）なら「集計中」案内、過去月なら反映案内を表示
        const nowJST = new Date(Date.now() + 9 * 60 * 60 * 1000);
        const curMonthNum = nowJST.getUTCFullYear() * 100 + (nowJST.getUTCMonth() + 1);
        const isPendingMonth = monthToNum(targetMonth) >= curMonthNum;
        const [ty, tm] = targetMonth.split("/").map(Number);
        const nextMonthLabel = tm === 12 ? `${ty + 1}年1月` : `${tm + 1}月`;
        const targetLabel = targetMonth.replace(/(\d{4})\/(\d{1,2})/, "$1年$2月");
        const latestLabel = latestMonth.replace(/(\d{4})\/(\d{1,2})/, "$1年$2月");
        return (
        <div style={{ background: "#FEF3C7", border: "1px solid #F59E0B", borderRadius: 8, padding: "12px 20px", margin: "0 0 12px", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18 }}>⚠</span>
          <span style={{ fontSize: 16, color: "#92400E" }}>
            {isPendingMonth ? (
              <><strong>{targetLabel}</strong>は集計期間中のため、最新の確定月（{latestLabel}）を表示しています。{targetLabel.replace(/^\d{4}年/, "")}分は{nextMonthLabel}上旬に反映予定です。</>
            ) : (
              <><strong>{targetLabel}</strong>のデータがありません。最新月（{latestLabel}）のデータを表示しています。レポート管理画面で「全店舗反映」を実行してください。</>
            )}
          </span>
        </div>
        );
      })()}

      {/* ════ P1: ヘッダー + KPI ════ */}
      <div style={slideStyle} className="slide">
        <div style={{ background: "linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%)", color: "#fff", padding: "28px 9px 20px", flexShrink: 0, position: "relative" }}>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900, letterSpacing: 1 }}>{shop.name}</h1>
          <div style={{ fontSize: 16, opacity: 0.7, marginTop: 2 }}>MEO対策 レポート報告</div>
          <div style={{ fontSize: 16, opacity: 0.5, marginTop: 6 }}>{shop.address}</div>
          <div style={{ position: "absolute", top: 28, right: 36, background: "rgba(255,255,255,.12)", padding: "7px 18px", borderRadius: 8, fontSize: 16, fontWeight: 600 }}>{shop.period.start} - {shop.period.end}</div>
          {/* 表紙だけページ番号が無く、2ページ目以降と体裁が揃っていなかった */}
          <span className="pn-label" style={{ position: "absolute", bottom: 8, right: 36, fontSize: 16, opacity: 0.45, fontWeight: 400 }}>{pn(1)}</span>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: "5px 9px", background: "#e8eaf0", flexShrink: 0 }}>
          {[{ lb: "対策開始日", vl: shop.startDate }, { lb: "レポート対象", vl: curLabel }, ...(shop.category ? [{ lb: "業種", vl: shop.category }] : []), { lb: "口コミ合計", vl: `${displayTotalReviews.toLocaleString()}件` }, { lb: "評価", vl: String(shop.rating) }].map((b, i) => (
            <div key={i} style={{ background: "#fff", borderRadius: 10, padding: "0px 14px", fontSize: 16, display: "flex", alignItems: "center", gap: 5, boxShadow: "0 1px 3px rgba(0,0,0,.05)" }}>
              <span style={{ color: "#888" }}>{b.lb}</span><span style={{ fontWeight: 700 }}>{b.vl}</span>
            </div>
          ))}
        </div>
        <div style={{ flex: 1, padding: "16px 9px 20px", display: "flex", flexDirection: "column", justifyContent: "stretch", overflow: "hidden" }}>
          <div style={{ ...stitleStyle, marginBottom: 14 }}>主要指標サマリー（{curLabel}）</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6, flex: 1 }}>
            {kpis.map((kpi, i) => {
              const isLastKpi = i === kpis.length - 1;
              const mom = kpi.momValue != null ? pctChange(kpi.value, kpi.momValue) : null;
              // 対策開始前・0件の前年同月とは比較しない（"+116325.0%（4→4,657）"のような無意味な表示を防ぐ）
              const yoyOk = isYoyComparable(kpi.yoyValue, curLabel, shop.startDate);
              const yoyC = yoyOk ? pctChange(kpi.value, kpi.yoyValue!) : null;
              // 「データが無い」のか「計測開始前で比較にならない」のかを書き分ける
              const yoyNote = kpi.yoyValue == null ? "前年比 なし" : "前年比 なし（前年は計測前）";
              const badgeStyle = (isUp: boolean, isFlat?: boolean): React.CSSProperties => ({ display: "inline-block", padding: "2px 7px", borderRadius: 16, fontSize: 16, fontWeight: 600, background: isFlat ? "#f0f0f0" : isUp ? "#e6f9ee" : "#fde8e8", color: isFlat ? "#888" : isUp ? "#0a8f3c" : "#c0392b" });
              const arrow = (c: { isUp: boolean; isFlat: boolean }) => c.isFlat ? "→" : c.isUp ? "▲" : "▼";
              return (
                <div key={i} style={{ background: "#fff", borderRadius: 12, padding: "14px 16px", position: "relative", overflow: "hidden", boxShadow: "0 1px 6px rgba(0,0,0,.04)", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                  <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: 3, background: kpiTopColors[i] }} />
                  <div style={{ fontSize: 16, color: "#888", fontWeight: 500 }}>{kpi.label}</div>
                  <div style={{ fontSize: 26, fontWeight: 900, lineHeight: 1.1, margin: "4px 0" }}>
                    {isLastKpi ? `${kpi.value >= 0 ? "+" : ""}${kpi.value.toLocaleString()}件` : kpi.value.toLocaleString()}
                  </div>
                  <div style={{ fontSize: 16, color: "#aaa", marginBottom: 4 }}>
                    {isLastKpi ? (
                      <span>累計: {displayTotalReviews.toLocaleString()}件（評価 {shop.rating}）</span>
                    ) : kpi.label === "Google検索 合計" || kpi.label === "Googleマップ 合計" ? (
                      <><span style={{ marginRight: 6 }}>モバイル: {kpi.label === "Googleマップ 合計" ? charts.mapMobile[charts.mapMobile.length-1]?.toLocaleString() : charts.searchMobile[charts.searchMobile.length-1]?.toLocaleString()}</span><span>PC: {kpi.label === "Googleマップ 合計" ? charts.mapPC[charts.mapPC.length-1]?.toLocaleString() : charts.searchPC[charts.searchPC.length-1]?.toLocaleString()}</span></>
                    ) : (
                      <span>&nbsp;</span>
                    )}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-start" }}>
                    {isLastKpi ? (<>
                      <span style={badgeStyle(kpi.value > 0, kpi.value === 0)}>
                        {kpi.value > 0 ? "▲" : kpi.value === 0 ? "→" : "▼"} {(displayTotalReviews - kpi.value).toLocaleString()}→{displayTotalReviews.toLocaleString()}件 前月比
                      </span>
                      {yoyOk ? (() => {
                        const yoyDelta = displayTotalReviews - kpi.yoyValue!;
                        return <span style={badgeStyle(yoyDelta >= 0)}>
                          {yoyDelta >= 0 ? "▲" : "▼"} {kpi.yoyValue!.toLocaleString()}→{displayTotalReviews.toLocaleString()}件 前年比
                        </span>;
                      })() : <span style={{ fontSize: 16, color: "#bbb" }}>{yoyNote}</span>}
                    </>) : (<>
                      {mom && <span style={badgeStyle(mom.isUp, mom.isFlat)}>{arrow(mom)} {mom.text}（{kpi.momValue!.toLocaleString()}→{kpi.value.toLocaleString()}）前月比</span>}
                      {yoyC ? <span style={badgeStyle(yoyC.isUp, yoyC.isFlat)}>{arrow(yoyC)} {yoyC.text}（{kpi.yoyValue!.toLocaleString()}→{kpi.value.toLocaleString()}）前年比</span>
                        : <span style={{ fontSize: 16, color: "#bbb" }}>{yoyNote}</span>}
                    </>)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ════ P2: 月次テーブル ════ */}
      {(() => { pageNum = 2; return null; })()}
      <div style={slideStyle} className="slide">
        <div style={slideBarStyle}><span>{shop.name} — 月次推移データ</span><span className="pn-label" style={{ fontSize: 16, opacity: 0.45, fontWeight: 400 }}>{pn(pageNum)}</span></div>
        <div style={slideBodyStyle}>
          <div style={stitleStyle}>月次推移データ（直近{dispLabels.length}ヶ月）</div>
          <div style={{ overflow: "hidden", borderRadius: 12, boxShadow: "0 1px 6px rgba(0,0,0,.04)", flex: 1, display: "flex", flexDirection: "column" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", fontSize: 16, flex: 1 }}>
              <thead><tr>
                {["月","マップモバイル","マップPC","マップ合計","検索モバイル","検索PC","検索合計","Web","ルート","通話",
                  ...(hasFoodMenus ? ["メニュー"] : []),
                  ...(hasBookings ? ["予約"] : []),
                  "合計"].map((h,i) => (
                  <th key={i} style={{ background: "#0f3460", color: "#fff", padding: "8px 10px", textAlign: "center", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {[...monthlyTableData].reverse().map((r, i) => {
                  const isLast = i === 0; // 新しい月が先頭
                  return (
                    <tr key={i} style={{ background: isLast ? "#cfffE3" : i % 2 === 1 ? "#eef1f6" : "#fff", fontWeight: isLast ? 600 : undefined }}>
                      <td style={{ padding: "4px 10px", textAlign: "center", borderBottom: "1px solid #ddd", color: "#222" }}>{r.label}</td>
                      <td style={{ padding: "4px 10px", textAlign: "center", borderBottom: "1px solid #ddd", color: "#222" }}>{r.mapMobile.toLocaleString()}</td>
                      <td style={{ padding: "4px 10px", textAlign: "center", borderBottom: "1px solid #ddd", color: "#222" }}>{r.mapPC.toLocaleString()}</td>
                      <td style={{ padding: "4px 10px", textAlign: "center", borderBottom: "1px solid #ddd", color: "#222" }}>{r.mapTotal.toLocaleString()}</td>
                      <td style={{ padding: "4px 10px", textAlign: "center", borderBottom: "1px solid #ddd", color: "#222" }}>{r.searchMobile.toLocaleString()}</td>
                      <td style={{ padding: "4px 10px", textAlign: "center", borderBottom: "1px solid #ddd", color: "#222" }}>{r.searchPC.toLocaleString()}</td>
                      <td style={{ padding: "4px 10px", textAlign: "center", borderBottom: "1px solid #ddd", color: "#222" }}>{r.searchTotal.toLocaleString()}</td>
                      <td style={{ padding: "4px 10px", textAlign: "center", borderBottom: "1px solid #ddd", color: "#222" }}>{r.websites.toLocaleString()}</td>
                      <td style={{ padding: "4px 10px", textAlign: "center", borderBottom: "1px solid #ddd", color: "#222" }}>{r.routes.toLocaleString()}</td>
                      <td style={{ padding: "4px 10px", textAlign: "center", borderBottom: "1px solid #ddd", color: "#222" }}>{r.calls.toLocaleString()}</td>
                      {hasFoodMenus && <td style={{ padding: "4px 10px", textAlign: "center", borderBottom: "1px solid #ddd", color: "#222" }}>{r.foodMenus.toLocaleString()}</td>}
                      {hasBookings && <td style={{ padding: "4px 10px", textAlign: "center", borderBottom: "1px solid #ddd", color: "#222" }}>{r.bookings.toLocaleString()}</td>}
                      <td style={{ padding: "4px 10px", textAlign: "center", borderBottom: "1px solid #ddd", fontWeight: 700, color: "#222" }}>{r.totalActions.toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {renderPageComment("monthly", "AI総評")}
        </div>
      </div>

      {/* ════ P3: Googleマップ表示数推移 ════ */}
      {(() => { pageNum = 3; return null; })()}
      <div style={slideStyle} className="slide">
        <div style={slideBarStyle}><span>{shop.name} — Googleマップ表示数推移</span><span className="pn-label" style={{ fontSize: 16, opacity: 0.45, fontWeight: 400 }}>{pn(pageNum)}</span></div>
        <div style={slideBodyStyle}>
          <div style={{ width: "95%", margin: "0 auto" }}>
            <Bar data={{ labels: dispLabels, datasets: [
              { label: "モバイル", data: dispCharts.mapMobile, backgroundColor: "rgba(129,199,132,.75)" },
              { label: "PC", data: dispCharts.mapPC, backgroundColor: "rgba(56,142,60,.75)" },
            ]}} options={buildStackedOptions()} />
          </div>
          <table style={{ width: "95%", margin: "8px auto 0", borderCollapse: "collapse", fontSize: 16 }}>
            <tbody>
              <tr style={{ background: "#0f3460" }}>
                <td style={{ padding: "3px 4px", fontWeight: 600, color: "#fff", width: 60, whiteSpace: "nowrap" }}>月</td>
                {dispLabels.map((l, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center", color: "#fff", fontWeight: 600 }}>{l.split("/")[1]}月</td>)}
              </tr>
              <tr style={{ background: "#fff" }}><td style={{ padding: "3px 4px", fontWeight: 600, color: "#666", whiteSpace: "nowrap" }}>モバイル</td>
                {dispCharts.mapMobile.map((v, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center" }}>{v.toLocaleString()}</td>)}</tr>
              <tr style={{ background: "#fff" }}><td style={{ padding: "3px 4px", fontWeight: 600, color: "#666", whiteSpace: "nowrap" }}>PC</td>
                {dispCharts.mapPC.map((v, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center" }}>{v.toLocaleString()}</td>)}</tr>
              <tr style={{ background: "#0f3460" }}><td style={{ padding: "3px 4px", fontWeight: 700, color: "#fff", whiteSpace: "nowrap" }}>合計</td>
                {dispCharts.mapMobile.map((v, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center", fontWeight: 700, color: "#fff" }}>{(v + dispCharts.mapPC[i]).toLocaleString()}</td>)}</tr>
            </tbody>
          </table>
          {renderPageComment("map", "AI総評")}
        </div>
      </div>

      {/* ════ P4: Google検索数推移 ════ */}
      {(() => { pageNum = 4; return null; })()}
      <div style={slideStyle} className="slide">
        <div style={slideBarStyle}><span>{shop.name} — Google検索数推移</span><span className="pn-label" style={{ fontSize: 16, opacity: 0.45, fontWeight: 400 }}>{pn(pageNum)}</span></div>
        <div style={slideBodyStyle}>
          <div style={{ width: "95%", margin: "0 auto" }}>
            <Bar data={{ labels: dispLabels, datasets: [
              { label: "モバイル", data: dispCharts.searchMobile, backgroundColor: "rgba(79,195,247,.75)" },
              { label: "PC", data: dispCharts.searchPC, backgroundColor: "rgba(2,136,209,.75)" },
            ]}} options={buildStackedOptions()} />
          </div>
          <table style={{ width: "95%", margin: "8px auto 0", borderCollapse: "collapse", fontSize: 16 }}>
            <tbody>
              <tr style={{ background: "#0f3460" }}>
                <td style={{ padding: "3px 4px", fontWeight: 600, color: "#fff", width: 60, whiteSpace: "nowrap" }}>月</td>
                {dispLabels.map((l, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center", color: "#fff", fontWeight: 600 }}>{l.split("/")[1]}月</td>)}
              </tr>
              <tr style={{ background: "#fff" }}><td style={{ padding: "3px 4px", fontWeight: 600, color: "#666", whiteSpace: "nowrap" }}>モバイル</td>
                {dispCharts.searchMobile.map((v, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center" }}>{v.toLocaleString()}</td>)}</tr>
              <tr style={{ background: "#fff" }}><td style={{ padding: "3px 4px", fontWeight: 600, color: "#666", whiteSpace: "nowrap" }}>PC</td>
                {dispCharts.searchPC.map((v, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center" }}>{v.toLocaleString()}</td>)}</tr>
              <tr style={{ background: "#0f3460" }}><td style={{ padding: "3px 4px", fontWeight: 700, color: "#fff", whiteSpace: "nowrap" }}>合計</td>
                {dispCharts.searchMobile.map((v, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center", fontWeight: 700, color: "#fff" }}>{(v + dispCharts.searchPC[i]).toLocaleString()}</td>)}</tr>
            </tbody>
          </table>
          {renderPageComment("search", "AI総評")}
        </div>
      </div>

      {/* ════ P5: ユーザー反応数推移 ════ */}
      {(() => { pageNum = 5; return null; })()}
      <div style={slideStyle} className="slide">
        <div style={slideBarStyle}><span>{shop.name} — ユーザー反応数推移</span><span className="pn-label" style={{ fontSize: 16, opacity: 0.45, fontWeight: 400 }}>{pn(pageNum)}</span></div>
        <div style={slideBodyStyle}>
          <div style={{ width: "95%", margin: "0 auto" }}>
            <Bar data={{ labels: dispLabels, datasets: [
              { label: "ウェブサイト", data: dispCharts.websites, backgroundColor: "rgba(255,183,77,.75)" },
              { label: "ルート", data: dispCharts.routes, backgroundColor: "rgba(186,104,200,.75)" },
              { label: "通話", data: dispCharts.calls, backgroundColor: "rgba(239,154,154,.75)" },
              ...(hasFoodMenus ? [{ label: "メニュー", data: dispCharts.foodMenus, backgroundColor: "rgba(77,182,172,.75)" }] : []),
              ...(hasBookings ? [{ label: "予約", data: dispCharts.bookings, backgroundColor: "rgba(121,134,203,.75)" }] : []),
            ]}} options={buildStackedOptions()} />
          </div>
          <table style={{ width: "95%", margin: "8px auto 0", borderCollapse: "collapse", fontSize: 16 }}>
            <tbody>
              <tr style={{ background: "#0f3460" }}>
                <td style={{ padding: "3px 4px", fontWeight: 600, color: "#fff", width: 60, whiteSpace: "nowrap" }}>月</td>
                {dispLabels.map((l, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center", color: "#fff", fontWeight: 600 }}>{l.split("/")[1]}月</td>)}
              </tr>
              <tr style={{ background: "#fff" }}><td style={{ padding: "3px 4px", fontWeight: 600, color: "#666", whiteSpace: "nowrap" }}>Web</td>
                {dispCharts.websites.map((v, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center" }}>{v.toLocaleString()}</td>)}</tr>
              <tr style={{ background: "#fff" }}><td style={{ padding: "3px 4px", fontWeight: 600, color: "#666", whiteSpace: "nowrap" }}>ルート</td>
                {dispCharts.routes.map((v, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center" }}>{v.toLocaleString()}</td>)}</tr>
              <tr style={{ background: "#fff" }}><td style={{ padding: "3px 4px", fontWeight: 600, color: "#666", whiteSpace: "nowrap" }}>通話</td>
                {dispCharts.calls.map((v, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center" }}>{v.toLocaleString()}</td>)}</tr>
              {hasFoodMenus && <tr style={{ background: "#fff" }}><td style={{ padding: "3px 4px", fontWeight: 600, color: "#666", whiteSpace: "nowrap" }}>メニュー</td>
                {dispCharts.foodMenus.map((v, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center" }}>{v.toLocaleString()}</td>)}</tr>}
              {hasBookings && <tr style={{ background: "#fff" }}><td style={{ padding: "3px 4px", fontWeight: 600, color: "#666", whiteSpace: "nowrap" }}>予約</td>
                {dispCharts.bookings.map((v, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center" }}>{v.toLocaleString()}</td>)}</tr>}
              <tr style={{ background: "#0f3460" }}><td style={{ padding: "3px 4px", fontWeight: 700, color: "#fff", whiteSpace: "nowrap" }}>合計</td>
                {dispCharts.websites.map((v, i) => {
                  let total = v + dispCharts.routes[i] + dispCharts.calls[i];
                  if (hasFoodMenus) total += dispCharts.foodMenus[i];
                  if (hasBookings) total += dispCharts.bookings[i];
                  return <td key={i} style={{ padding: "3px 2px", textAlign: "center", fontWeight: 700, color: "#fff" }}>{total.toLocaleString()}</td>;
                })}</tr>
            </tbody>
          </table>
          {renderPageComment("reactions", "AI総評")}
        </div>
      </div>

      {/* ════ P7: キーワード順位 (データある場合のみ) ════ */}
      {showKeywords && (() => { pageNum = 6; return (
        <div style={slideStyle} className="slide">
          <div style={slideBarStyle}><span>{shop.name} — キーワード順位変動</span><span className="pn-label" style={{ fontSize: 16, opacity: 0.45, fontWeight: 400 }}>{pn(pageNum)}</span></div>
          <div style={slideBodyStyle}>
            {/* 比較元は前月とは限らない（5月に計測が無ければ4月と比較になる）ため注記する */}
            <div style={stitleStyle}>
              キーワード順位変動（{curLabel}）
              <span style={{ fontSize: 13, fontWeight: 400, color: "#999", marginLeft: 10 }}>※左側は直近で計測できた月との比較です</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, flex: 1 }}>
              {visibleKeywords.map((kw, i) => {
                const hasRank = kw.rank > 0;
                const hasPrev = kw.prevRank > 0;
                const diff = hasRank && hasPrev ? kw.prevRank - kw.rank : 0;
                // 圏外への転落は↓・圏外からの復帰は↑。未計測は矢印を出さない（下落と誤読されるため）
                const unmeasured = !hasRank && !kw.curMeasured;
                const arrow = unmeasured ? "—" : hasPrev && !hasRank ? "↓" : !hasPrev && hasRank ? "↑" : diff > 0 ? "↑" : diff < 0 ? "↓" : "→";
                const arrowColor = arrow === "↑" ? "#0a8f3c" : arrow === "↓" ? "#c0392b" : "#888";
                return (
                  <div key={i} style={{ background: "#fff", borderRadius: 12, padding: "24px 28px", boxShadow: "0 1px 6px rgba(0,0,0,.04)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>{kw.word}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 16, color: "#999" }}>{kw.firstMeasure ? "初計測" : `${kw.prevMonth ? `${parseInt(kw.prevMonth.split("/")[1])}月` : "前月"}${hasPrev ? ` ${kw.prevRank}位` : " 圏外"}`}</span>
                      <span style={{ fontSize: 22, color: arrowColor }}>{arrow}</span>
                      {hasRank ? (
                        // 順位帯で色分け（一律赤だと1位も30位も同じ見た目になり、良い結果が警告色になる）
                        <><span style={{ fontSize: 36, fontWeight: 900, color: rankTextColor(kw.rank) }}>{kw.rank}</span>
                        <span style={{ fontSize: 16, color: "#666" }}>位</span></>
                      ) : (
                        <span style={{ fontSize: 26, fontWeight: 900, color: "#94a3b8" }}>{unmeasured ? "未計測" : "圏外"}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {renderPageComment("keyword", "AI総評")}
          </div>
        </div>
      ); })()}

      {/* ════ P7.5: キーワード順位推移テーブル ════ */}
      {showRankingHistory && (() => { pageNum++; return (
        <div style={slideStyle} className="slide">
          <div style={slideBarStyle}><span>{shop.name} — キーワード順位推移</span><span className="pn-label" style={{ fontSize: 16, opacity: 0.45, fontWeight: 400 }}>{pn(pageNum)}</span></div>
          <div style={{ ...slideBodyStyle, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            {/* labelsは「計測実績のある月」だけを並べたもので連続月とは限らない
                （例: 5月に計測が無いと 1月/2月/3月/4月/6月 になる）。連続月と誤読されないよう明示する */}
            <div style={stitleStyle}>
              キーワード順位推移（計測実績のある直近{unifiedRankingHistory.labels.length}ヶ月）
              <span style={{ fontSize: 13, fontWeight: 400, color: "#999", marginLeft: 10 }}>※計測の無い過去月は列に含まれません</span>
            </div>
            <div style={{ overflowX: "auto", borderRadius: 12, boxShadow: "0 1px 6px rgba(0,0,0,.04)", flex: 1, display: "flex", flexDirection: "column" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", flex: 1, minWidth: 700 }}>
                <thead>
                  <tr>
                    <th style={{ background: "#0f3460", color: "#fff", padding: "8px 6px", textAlign: "left", fontWeight: 600, whiteSpace: "nowrap", fontSize: 16, position: "sticky", left: 0 }}>キーワード</th>
                    {unifiedRankingHistory.labels.map((l, i) => (
                      <th key={i} style={{ background: i === unifiedRankingHistory.labels.length - 1 ? "#e94560" : "#0f3460", color: "#fff", padding: "8px 4px", textAlign: "center", fontWeight: 600, whiteSpace: "nowrap", fontSize: 16 }}>
                        {l}
                      </th>
                    ))}
                    <th style={{ background: "#0f3460", color: "#fff", padding: "8px 4px", textAlign: "center", fontWeight: 600, fontSize: 16 }}>変動</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRankingDatasets.map((ds, di) => {
                    // 変動は必ず「最新列」基準。null除外後の末尾2件を比較すると
                    // 当月データなしの時に過去2ヶ月の差分が当月の変動として出てしまう
                    const trend = rankTrend(ds.ranks, ds.measured);
                    return (
                      <tr key={di} style={{ background: di % 2 === 0 ? "#fff" : "#f8f9fb" }}>
                        <td style={{ padding: "6px 6px", fontWeight: 700, color: "#333", whiteSpace: "nowrap", borderBottom: "1px solid #eee", fontSize: 16 }}>{ds.word}</td>
                        {ds.ranks.map((r, ri) => {
                          const isLatest = ri === unifiedRankingHistory.labels.length - 1;
                          return (
                            <td key={ri} style={{
                              padding: "6px 4px", textAlign: "center", borderBottom: "1px solid #eee", fontSize: 16,
                              fontWeight: r !== null && r <= 3 ? 900 : isLatest ? 700 : 400,
                              // 順位帯の色は全ページ共通のrankTextColorに統一（3位以内=青／4-10位=緑）
                              color: r === null ? "#ddd" : rankTextColor(r),
                              background: isLatest ? "#fff8f0" : undefined,
                            }}>
                              {r ?? "-"}
                            </td>
                          );
                        })}
                        <td style={{
                          padding: "6px 4px", textAlign: "center", borderBottom: "1px solid #eee",
                          fontSize: trend.text.length > 2 ? 14 : 16, fontWeight: 700,
                          color: trend.color,
                        }}>
                          {trend.text}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {renderPageComment("rankingHistory", "AI総評")}
          </div>
        </div>
      ); })()}

      {/* ════ 多地点順位計測（画面:1ページタブ切替 / PDF:全KW展開 2KW/ページ） ════ */}
      {showGridRanking && (() => {
        const gr = visibleGridRanking!;
        // KW非表示化でリストが縮んだ場合に選択インデックスが範囲外にならないようクランプ
        const activeKwI = Math.min(gridKwIdx, Math.max(gr.keywords.length - 1, 0));
        const filteredHistory = gr.history.filter(h => monthToNum(h.month) <= monthToNum(curLabel));
        const recentHistory = filteredHistory.slice(-6);
        const defaultMonthI = (() => {
          if (gridMonthIdx >= 0 && gridMonthIdx < recentHistory.length) return gridMonthIdx;
          const curIdx = recentHistory.findIndex(h => h.month === curLabel);
          return curIdx >= 0 ? curIdx : recentHistory.length - 1;
        })();
        const activeMonthI = defaultMonthI;
        const monthData = recentHistory[activeMonthI];
        const prevMonthData = activeMonthI > 0 ? recentHistory[activeMonthI - 1] : null;
        pageNum++; // サマリーページ
        const summaryPageNum = pageNum;

        // サマリーページ用データ
        const latestMonth = recentHistory[recentHistory.length - 1];
        const prevMonth = recentHistory.length >= 2 ? recentHistory[recentHistory.length - 2] : null;
        const trendMonthLabels = recentHistory.map(h => h.month.replace(/^\d{4}\//, "") + "月");

        // キーワードを2つずつペアにグループ化（PDF時に1ページ2KW表示用）
        const kwPairs: string[][] = [];
        for (let i = 0; i < gr.keywords.length; i += 2) {
          kwPairs.push(gr.keywords.slice(i, i + 2));
        }

        // サマリースライド（web表示用、PDF時はgrid-kw-pairとして非表示→動的版に置換）
        const summarySlide = (
          <div key="grid-summary" className="grid-summary-slide">
            <div style={slideStyle} className="slide">
              <div style={slideBarStyle}>
                <span>{shop.name} — 多地点順位計測 サマリー</span>
                <span className="pn-label" style={{ fontSize: 16, opacity: 0.45, fontWeight: 400 }}>{pn(summaryPageNum)}</span>
              </div>
              <div style={{ ...slideBodyStyle, padding: "16px 24px", gap: 16 }}>
                <div style={stitleStyle}>多地点順位 総合レポート（{latestMonth?.month || curLabel}）</div>
                <div style={{ display: "flex", gap: 24, flex: 1, minHeight: 0 }}>
                {/* 左: 全KW比較テーブル */}
                <div style={{ flex: "0 0 480px", display: "flex", flexDirection: "column" }}>
                  {latestMonth && (
                    <>
                      <h3 style={{ fontSize: 16, fontWeight: 700, color: "#0f3460", margin: "0 0 8px" }}>全キーワード比較（{latestMonth.month}）</h3>
                      <div style={{ borderRadius: 10, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,.04)" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff" }}>
                          <thead>
                            <tr>
                              {["キーワード", "平均順位", "圏内率", "前回比", "計測地点"].map((t, ti) => (
                                <th key={t} style={{ background: "#0f3460", color: "#fff", padding: "8px 10px", textAlign: ti === 0 ? "left" : "center", fontSize: 15 }}>{t}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {/* 右の月別表と同じ全KWを表示（この月のデータがないKWは「-」） */}
                            {gr.keywords.map((kw, si) => {
                              const s = latestMonth.snapshots.find(sn => sn.keyword === kw);
                              // 前回比は右の月別表と同じ最新列基準のロジックに統一（左右で結論が食い違わないように）
                              const series = recentHistory.map(h => { const sn = h.snapshots.find(x => x.keyword === kw); return sn ? sn.avgRank : null; });
                              const measuredArr = recentHistory.map(h => h.snapshots.some(x => x.keyword === kw));
                              const diff = rankTrend(series, measuredArr, 1);
                              // avgRankは圏内地点のみの平均なので、圏内率が無いと実態を誤認する
                              const cov = rankCoverage(s?.results);
                              return (
                                <tr key={si} style={{ background: si % 2 === 0 ? "#fff" : "#f8f9fb" }}>
                                  <td style={{ padding: "8px 10px", fontSize: 15, borderBottom: "1px solid #eee" }}>{kw}</td>
                                  <td style={{ padding: "8px 10px", textAlign: "center", fontSize: 15, fontWeight: 800, borderBottom: "1px solid #eee",
                                    color: !s ? "#ccc" : s.avgRank <= 0 ? "#999" : s.avgRank <= 3 ? "#1d4ed8" : s.avgRank <= 10 ? "#15803d" : s.avgRank <= 20 ? "#b45309" : "#999" }}>{s ? fmtAvgRank(s.avgRank) : "-"}</td>
                                  <td style={{ padding: "8px 10px", textAlign: "center", fontSize: 14, borderBottom: "1px solid #eee",
                                    fontWeight: cov && cov.pct < 50 ? 700 : 400,
                                    color: !cov ? "#ccc" : cov.pct >= 80 ? "#15803d" : cov.pct >= 50 ? "#b45309" : "#c0392b" }}>
                                    {cov ? `${cov.ranked}/${cov.total}` : "-"}
                                  </td>
                                  <td style={{ padding: "8px 10px", textAlign: "center", fontSize: diff.text.length > 2 ? 13 : 15, fontWeight: 700, borderBottom: "1px solid #eee",
                                    color: diff.color }}>
                                    {diff.text}
                                  </td>
                                  <td style={{ padding: "8px 10px", textAlign: "center", fontSize: 15, color: "#888", borderBottom: "1px solid #eee" }}>{s ? gridLayoutLabel(s.gridSize, s.results?.length ?? 0) : "-"}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
                {/* 右: 各KWの月別平均順位。
                    7件までは以前の見た目（gap10・上詰め）。
                    8件以上は行を詰めて確実にスライド内に収めた上で space-between で縦いっぱいに均等配置し下余白を埋める */}
                {(() => {
                const many = gr.keywords.length >= 8;
                // 8件以上は詰める（そのままだと固定高スライドをはみ出して最終行が見切れるため）
                const cellPad = many ? "2px 4px" : "5px 4px";
                const cellFS = many ? 11 : 12;
                return (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5, justifyContent: "flex-start", overflow: "hidden" }}>
                  {gr.keywords.map(kw => {
                    const data = recentHistory.map(h => { const s = h.snapshots.find(s => s.keyword === kw); return s ? s.avgRank : null; });
                    // その月にスナップショットがあれば計測済み（avgRank=0でも「全地点圏外」として計測済み扱い）
                    const measuredArr = recentHistory.map(h => h.snapshots.some(s => s.keyword === kw));
                    // 変動は最新列基準。null除外して末尾2件を比べると圏外/未計測が「改善」に見える
                    const diff = rankTrend(data, measuredArr, 1);
                    return (
                      <div key={kw}>
                        <div style={{ fontSize: 18, fontWeight: 700, color: "#0f3460", marginBottom: 0 }}>「{kw}」</div>
                        <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", borderRadius: 6, overflow: "hidden" }}>
                          <thead>
                            <tr>
                              {trendMonthLabels.map((l, li) => (
                                <th key={li} style={{ background: li === trendMonthLabels.length - 1 ? "#e94560" : "#0f3460", color: "#fff", padding: cellPad, textAlign: "center", fontWeight: 600, fontSize: cellFS, whiteSpace: "nowrap" }}>{l}</th>
                              ))}
                              <th style={{ background: "#0f3460", color: "#fff", padding: cellPad, textAlign: "center", fontWeight: 600, fontSize: cellFS }}>変動</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              {data.map((v, i) => (
                                <td key={i} style={{ padding: cellPad, textAlign: "center", fontSize: cellFS, fontWeight: v !== null && v > 0 && v <= 5 ? 900 : 600,
                                  color: v === null ? "#ddd" : v <= 0 ? "#999" : v <= 3 ? "#1d4ed8" : v <= 10 ? "#15803d" : v <= 20 ? "#b45309" : "#999", borderBottom: "1px solid #eee" }}>
                                  {fmtAvgRank(v)}
                                </td>
                              ))}
                              <td style={{ padding: cellPad, textAlign: "center", fontSize: cellFS, fontWeight: 700, borderBottom: "1px solid #eee",
                                color: diff.color }}>
                                {diff.text}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    );
                  })}
                </div>
                );
                })()}
                </div>
                {renderPageComment("grid", "AI総評")}
              </div>
            </div>
          </div>
        );

        pageNum++; // KW切替ページ（web表示では全KWで1ページ共有）
        const gridKwPageNum = pageNum;
        return [summarySlide, ...kwPairs.map((pair, pairI) => {
          return (
          <div key={`grid-pair-${pairI}`} className="grid-kw-pair">
            {pair.map((loopKw, kwInPair) => {
              const kwI = pairI * 2 + kwInPair;
              const isActive = kwI === activeKwI;
              const snapshot = monthData?.snapshots.find(s => s.keyword === loopKw);
              const prevSnapshot = prevMonthData?.snapshots.find(s => s.keyword === loopKw);
              const trendLabels = recentHistory.map(h => h.month.replace(/^\d{4}\//, "") + "月");
              const trendData = recentHistory.map(h => {
                const s = h.snapshots.find(s => s.keyword === loopKw);
                return s ? s.avgRank : null;
              });
              return (
              <div key={`grid-${kwI}`} style={slideStyle} className={`slide grid-kw-slide${!isActive ? " grid-kw-hidden" : ""}`}>
                <div style={slideBarStyle} className="grid-kw-header">
                  <span>{shop.name} — 多地点順位計測</span>
                  <span className="pn-label" style={{ fontSize: 16, opacity: 0.45, fontWeight: 400 }}>{pn(gridKwPageNum)}</span>
                </div>
                <div style={{ ...slideBodyStyle, padding: "20px 9px", gap: 12 }} className="grid-kw-body">
                  {/* KWタブ（画面のみ、全スライドに配置するが表示は1つだけ） */}
                  <div className="no-print" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 16, fontWeight: 700, color: "#0f3460" }}>KW:</span>
                    {gr.keywords.map((kw, i) => (
                      <button key={kw} onClick={() => setGridKwIdx(i)}
                        style={{ padding: "5px 14px", borderRadius: 20, fontSize: 16, fontWeight: 600, border: "none", cursor: "pointer",
                          background: i === activeKwI ? "#0f3460" : "#e8edf3",
                          color: i === activeKwI ? "#fff" : "#555" }}>
                        {kw}
                      </button>
                    ))}
                  </div>
                  <div className="no-print" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 16, fontWeight: 700, color: "#0f3460" }}>月:</span>
                    {recentHistory.map((h, i) => (
                      <button key={h.month} onClick={() => setGridMonthIdx(i)}
                        style={{ padding: "4px 10px", borderRadius: 14, fontSize: 16, fontWeight: 600, border: "none", cursor: "pointer",
                          background: i === activeMonthI ? "#e94560" : "#f0f2f5",
                          color: i === activeMonthI ? "#fff" : "#666" }}>
                        {h.month.replace(/^\d{4}\//, "")}月
                      </button>
                    ))}
                  </div>
                  <div style={stitleStyle} className="grid-kw-title">多地点順位 —「{loopKw}」{monthData ? ` (${monthData.month})` : ""}</div>
                  <div style={{ display: "flex", gap: 16, flex: 1, minHeight: 0 }} className="grid-kw-content">
                    <div style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6 }} className="grid-kw-map-area">
                      {snapshot ? (
                        <>
                          <div ref={el => { gridMapRefs.current[loopKw] = el; }} className="grid-map-container" style={{ width: 440, height: 400, borderRadius: 12, overflow: "hidden", boxShadow: "0 2px 12px rgba(0,0,0,.15)", background: "#e8edf5" }} />
                          <div className="grid-kw-legend" style={{ display: "flex", fontSize: 18, color: "#555", marginTop: 4, width: 440, justifyContent: "space-between" }}>
                            <span><span style={{ width: 20, height: 20, borderRadius: "50%", background: "#2563EB", display: "inline-block", verticalAlign: "middle", marginRight: 6 }} /><span style={{ verticalAlign: "middle" }}>1-3位</span></span>
                            <span><span style={{ width: 20, height: 20, borderRadius: "50%", background: "#16A34A", display: "inline-block", verticalAlign: "middle", marginRight: 6 }} /><span style={{ verticalAlign: "middle" }}>4-10位</span></span>
                            <span><span style={{ width: 20, height: 20, borderRadius: "50%", background: "#F59E0B", display: "inline-block", verticalAlign: "middle", marginRight: 6 }} /><span style={{ verticalAlign: "middle" }}>11-20位</span></span>
                            <span><span style={{ width: 20, height: 20, borderRadius: "50%", background: "#EF4444", display: "inline-block", verticalAlign: "middle", marginRight: 6 }} /><span style={{ verticalAlign: "middle" }}>21位~</span></span>
                            <span><span style={{ width: 20, height: 20, borderRadius: "50%", background: "#6B7280", display: "inline-block", verticalAlign: "middle", marginRight: 6 }} /><span style={{ verticalAlign: "middle" }}>圏外</span></span>
                          </div>
                          <div className="grid-kw-avg" style={{ fontSize: 20, color: "#555", textAlign: "center", width: 440 }}>
                            平均順位: {snapshot.avgRank > 0 ? (
                              // 順位帯で色分け（一律赤だと2.7位の好成績も警告色に見える）
                              <><span style={{ fontSize: 28, fontWeight: 900, color: rankTextColor(snapshot.avgRank) }}>{snapshot.avgRank}</span>位</>
                            ) : (
                              <span style={{ fontSize: 28, fontWeight: 900, color: "#94a3b8" }}>圏外</span>
                            )}
                            {prevSnapshot && (() => {
                              // このスライドは月セレクタで選択中の月を表示するため、系列を選択月までに切る
                              const measuredArr = recentHistory.map(h => h.snapshots.some(s => s.keyword === loopKw));
                              const diff = rankTrend(trendData.slice(0, activeMonthI + 1), measuredArr.slice(0, activeMonthI + 1), 1);
                              return diff.text !== "→" && diff.text !== "-" ? (
                                <span style={{ marginLeft: 8, fontSize: 20, fontWeight: 700, color: diff.color }}>
                                  {diff.text}
                                </span>
                              ) : null;
                            })()}
                          </div>
                          {/* avgRankは圏内地点のみの平均。圏内率が無いと「45/49が圏外でも26.5位」と読めてしまう */}
                          {(() => {
                            const cov = rankCoverage(snapshot.results);
                            if (!cov) return null;
                            return (
                              <div className="grid-kw-cov" style={{ fontSize: 16, color: "#666", textAlign: "center", width: 440 }}>
                                圏内 <span style={{ fontWeight: 800, color: cov.pct >= 80 ? "#15803d" : cov.pct >= 50 ? "#b45309" : "#c0392b" }}>{cov.ranked}</span>
                                <span style={{ color: "#999" }}> / {cov.total}地点（{cov.pct}%）</span>
                              </div>
                            );
                          })()}
                        </>
                      ) : (
                        <div style={{ padding: 40, textAlign: "center" }}>
                          {/* 生成ボタンはクライアントに見える画面のため置かない（生成は表示設定モーダルから） */}
                          <div style={{ color: "#999", fontSize: 16 }}>この月のデータなし</div>
                        </div>
                      )}
                    </div>
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }} className="grid-kw-tables">
                      <h4 style={{ fontSize: 16, fontWeight: 700, color: "#0f3460", margin: 0 }}>「{loopKw}」月別平均順位</h4>
                      <div style={{ overflow: "auto", borderRadius: 10, boxShadow: "0 1px 4px rgba(0,0,0,.04)", flex: 1 }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff" }}>
                          <thead>
                            <tr>
                              {trendLabels.map((l, i) => (
                                <th key={i} style={{ background: i === activeMonthI ? "#e94560" : "#0f3460", color: "#fff", padding: "10px 6px", textAlign: "center", fontWeight: 600, fontSize: 16, whiteSpace: "nowrap" }}>{l}</th>
                              ))}
                              <th style={{ background: "#0f3460", color: "#fff", padding: "10px 6px", textAlign: "center", fontWeight: 600, fontSize: 16 }}>変動</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              {trendData.map((v, i) => (
                                <td key={i} style={{
                                  padding: "12px 6px", textAlign: "center", fontSize: 16, fontWeight: v !== null && v > 0 && v <= 5 ? 900 : 600,
                                  color: v === null ? "#ddd" : v <= 0 ? "#999" : v <= 3 ? "#1d4ed8" : v <= 10 ? "#15803d" : v <= 20 ? "#b45309" : "#999",
                                  background: i === activeMonthI ? "#fff8f0" : undefined, borderBottom: "1px solid #eee",
                                }}>
                                  {fmtAvgRank(v)}
                                </td>
                              ))}
                              {(() => {
                                // 選択月基準。null除外後の末尾2件比較は当月未計測時に誤った改善を出す
                                const measuredArr = recentHistory.map(h => h.snapshots.some(s => s.keyword === loopKw));
                                const diff = rankTrend(trendData.slice(0, activeMonthI + 1), measuredArr.slice(0, activeMonthI + 1), 1);
                                return (
                                  <td style={{ padding: "12px 6px", textAlign: "center", fontSize: diff.text.length > 2 ? 14 : 16, fontWeight: 700, borderBottom: "1px solid #eee",
                                    color: diff.color }}>
                                    {diff.text}
                                  </td>
                                );
                              })()}
                            </tr>
                          </tbody>
                        </table>
                      </div>
                      {monthData && monthData.snapshots.length > 1 && (
                        <div className={`grid-kw-comparison${kwI > 0 ? " grid-kw-comparison-sub" : ""}`}>
                          <h4 style={{ fontSize: 16, fontWeight: 700, color: "#0f3460", margin: "8px 0 0" }}>全キーワード比較（{monthData.month}）</h4>
                          <div style={{ overflow: "auto", borderRadius: 10, boxShadow: "0 1px 4px rgba(0,0,0,.04)" }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff" }}>
                              <thead>
                                <tr>
                                  <th style={{ background: "#0f3460", color: "#fff", padding: "8px 10px", textAlign: "left", fontSize: 16 }}>キーワード</th>
                                  <th style={{ background: "#0f3460", color: "#fff", padding: "8px 10px", textAlign: "center", fontSize: 16 }}>平均順位</th>
                                  <th style={{ background: "#0f3460", color: "#fff", padding: "8px 10px", textAlign: "center", fontSize: 16 }}>圏内率</th>
                                  <th style={{ background: "#0f3460", color: "#fff", padding: "8px 10px", textAlign: "center", fontSize: 16 }}>前回比</th>
                                  <th style={{ background: "#0f3460", color: "#fff", padding: "8px 10px", textAlign: "center", fontSize: 16 }}>計測地点</th>
                                </tr>
                              </thead>
                              <tbody>
                                {monthData.snapshots.map((s, si) => {
                                  // 選択月までの系列で最新列基準の変動を出す（サマリーページと同一ロジック）
                                  const series = recentHistory.slice(0, activeMonthI + 1).map(h => { const sn = h.snapshots.find(x => x.keyword === s.keyword); return sn ? sn.avgRank : null; });
                                  const measuredArr = recentHistory.slice(0, activeMonthI + 1).map(h => h.snapshots.some(x => x.keyword === s.keyword));
                                  const diff = rankTrend(series, measuredArr, 1);
                                  const cov = rankCoverage(s.results);
                                  return (
                                    <tr key={si} style={{ background: s.keyword === loopKw ? "#fff8f0" : si % 2 === 0 ? "#fff" : "#f8f9fb" }}>
                                      <td style={{ padding: "8px 10px", fontWeight: s.keyword === loopKw ? 700 : 500, fontSize: 16, borderBottom: "1px solid #eee" }}>{s.keyword}</td>
                                      <td style={{ padding: "8px 10px", textAlign: "center", fontSize: 16, fontWeight: 800, borderBottom: "1px solid #eee",
                                        color: s.avgRank <= 0 ? "#999" : s.avgRank <= 3 ? "#1d4ed8" : s.avgRank <= 10 ? "#15803d" : s.avgRank <= 20 ? "#b45309" : "#999" }}>
                                        {fmtAvgRank(s.avgRank)}
                                      </td>
                                      <td style={{ padding: "8px 10px", textAlign: "center", fontSize: 15, borderBottom: "1px solid #eee",
                                        fontWeight: cov && cov.pct < 50 ? 700 : 400,
                                        color: !cov ? "#ccc" : cov.pct >= 80 ? "#15803d" : cov.pct >= 50 ? "#b45309" : "#c0392b" }}>
                                        {cov ? `${cov.ranked}/${cov.total}` : "-"}
                                      </td>
                                      <td style={{ padding: "8px 10px", textAlign: "center", fontSize: diff.text.length > 2 ? 14 : 16, fontWeight: 700, borderBottom: "1px solid #eee",
                                        color: diff.color }}>
                                        {diff.text}
                                      </td>
                                      <td style={{ padding: "8px 10px", textAlign: "center", fontSize: 16, color: "#888", borderBottom: "1px solid #eee" }}>
                                        {gridLayoutLabel(s.gridSize, s.results?.length ?? 0)}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        );
        })];
      })()}

      {/* ════ 検索語句（月切り替え対応） ════ */}
      {showSearchQueries && (() => { pageNum++;
        const sqHistory: { month: string; keywords: { word: string; count: number }[] }[] = Array.isArray(searchQueries.history) ? searchQueries.history : [];
        if (sqHistory.length === 0) return null;
        const activeIdx = sqMonthIdx < 0 || sqMonthIdx >= sqHistory.length ? sqHistory.length - 1 : sqMonthIdx;
        const sqCurrent = sqHistory[activeIdx];
        const sqPrev = activeIdx > 0 ? sqHistory[activeIdx - 1] : null;
        const sqPrev2 = activeIdx > 1 ? sqHistory[activeIdx - 2] : null;
        const currentKeywords = Array.isArray(sqCurrent?.keywords) ? sqCurrent.keywords : [];
        const prevMap = new Map((sqPrev?.keywords || []).map(k => [k.word, k.count]));
        const prev2Map = new Map((sqPrev2?.keywords || []).map(k => [k.word, k.count]));
        const totalCount = currentKeywords.reduce((sum, kw) => sum + kw.count, 0);
        const prevTotalCount = sqPrev ? (sqPrev.keywords || []).reduce((sum: number, kw: any) => sum + kw.count, 0) : null;
        const totalDiff = prevTotalCount !== null ? totalCount - prevTotalCount : null;
        // 前年同月データ
        const curMonth = sqCurrent?.month || "";
        const curParts = curMonth.split("/").map(Number);
        const yoyMonth = curParts.length === 2 ? `${curParts[0] - 1}/${curParts[1]}` : "";
        const sqYoy = yoyMonth ? sqHistory.find(h => h.month === yoyMonth) : null;
        const yoyMap = new Map((sqYoy?.keywords || []).map(k => [k.word, k.count]));
        const yoyTotalCount = sqYoy ? (sqYoy.keywords || []).reduce((sum: number, kw: any) => sum + kw.count, 0) : null;
        // 前年同月が「対策開始前」「語句0件」「当月と共通語句なし」のいずれかなら列を出さない。
        // 出すと全行「-」の空列が2列できるだけで情報量がゼロになる（2026-07-31 発見）
        const yoyStartMonth = parseStartMonth(shop.startDate);
        const yoyBeforeStart = !!(yoyStartMonth && yoyMonth && monthToNum(yoyMonth) < monthToNum(yoyStartMonth));
        const hasYoy = !!sqYoy && !yoyBeforeStart
          && (sqYoy.keywords || []).length > 0
          && currentKeywords.some(kw => yoyMap.has(kw.word));
        const yoyTotalDiff = hasYoy && yoyTotalCount !== null ? totalCount - yoyTotalCount : null;
        // 全期間の累計マップ
        const cumulativeMap = new Map<string, number>();
        for (const m of sqHistory) {
          for (const kw of m.keywords || []) {
            cumulativeMap.set(kw.word, (cumulativeMap.get(kw.word) || 0) + kw.count);
          }
        }
        const canPrev = activeIdx > 0;
        const canNext = activeIdx < sqHistory.length - 1;
        const btnStyle = (disabled: boolean): React.CSSProperties => ({
          background: disabled ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.25)",
          color: disabled ? "rgba(255,255,255,0.3)" : "#fff",
          border: "none", borderRadius: 6, padding: "4px 12px", fontSize: 16, fontWeight: 600,
          cursor: disabled ? "default" : "pointer",
        });
        const hasPrev = sqPrev !== null;
        const hasPrev2 = sqPrev2 !== null;
        const PER_PAGE = SEARCH_QUERIES_PER_PAGE;
        const page1 = currentKeywords.slice(0, PER_PAGE);
        const thStyle = (w?: number, groupStart?: boolean): React.CSSProperties => ({ background: "#0f3460", color: "#fff", padding: "4px 4px", textAlign: "center", fontWeight: 600, fontSize: 14, whiteSpace: "nowrap", ...(w ? { width: w } : {}), ...(groupStart ? { borderLeft: "2px solid rgba(255,255,255,0.3)" } : {}) });
        const renderSqTable = (rows: typeof currentKeywords, startIdx: number) => (
          <div style={{ overflow: "hidden", borderRadius: 12, boxShadow: "0 1px 6px rgba(0,0,0,.04)", flex: 1, display: "flex", flexDirection: "column" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", flex: 1 }}>
              <thead>
                <tr>
                  <th style={thStyle(40)}>順位</th>
                  <th style={{ ...thStyle(), textAlign: "left", padding: "4px 8px" }}>検索語句</th>
                  <th style={thStyle(65)}>検索数</th>
                  {hasPrev && <th style={thStyle(50, true)}>前月</th>}
                  {hasPrev && <th style={thStyle(50)}>前月比</th>}
                  {hasPrev2 && <th style={thStyle(50, true)}>前々月</th>}
                  {hasPrev2 && <th style={thStyle(50)}>前々月比</th>}
                  {hasYoy && <th style={thStyle(50, true)}>前年</th>}
                  {hasYoy && <th style={thStyle(50)}>前年比</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((kw, ri) => {
                  const rank = startIdx + ri;
                  const prev = prevMap.get(kw.word);
                  const prev2 = prev2Map.get(kw.word);
                  const prevDiff = prev !== undefined ? kw.count - prev : null;
                  const prev2Diff = prev2 !== undefined ? kw.count - prev2 : null;
                  const yoyVal = yoyMap.get(kw.word);
                  const yoyDiff = yoyVal !== undefined ? kw.count - yoyVal : null;
                  const diffStyle = (d: number | null): React.CSSProperties => ({ padding: "2px 2px", textAlign: "center", fontSize: 14, fontWeight: 600, color: d === null ? "#ccc" : d > 0 ? "#0a8f3c" : d < 0 ? "#c0392b" : "#888" });
                  const fmtDiff = (d: number | null) => d === null ? "-" : d > 0 ? `+${d.toLocaleString()}` : d === 0 ? "→" : d.toLocaleString();
                  return (
                    <tr key={`${sqCurrent?.month}-${rank}`} style={{ background: ri % 2 === 0 ? "#fff" : "#f8f9fb", borderBottom: "1px solid #eee" }}>
                      {/* 上位を赤にすると他ページの順位色（3位以内=青）と逆の意味に見えるため統一する */}
                      <td style={{ padding: "2px 4px", textAlign: "center", fontSize: 14, fontWeight: 700, color: rankTextColor(rank + 1) }}>{rank + 1}</td>
                      <td style={{ padding: "2px 6px", fontSize: 14, color: "#333" }}>{kw.word}</td>
                      <td style={{ padding: "2px 4px", textAlign: "center", fontSize: 14, fontWeight: 700, color: "#0f3460" }}>{kw.count.toLocaleString()}</td>
                      {hasPrev && <td style={{ padding: "2px 4px", textAlign: "center", fontSize: 14, color: "#888", borderLeft: "2px solid #e8edf3" }}>{prev !== undefined ? prev.toLocaleString() : "-"}</td>}
                      {hasPrev && <td style={{ ...diffStyle(prevDiff) }}>{fmtDiff(prevDiff)}</td>}
                      {hasPrev2 && <td style={{ padding: "2px 4px", textAlign: "center", fontSize: 14, color: "#888", borderLeft: "2px solid #e8edf3" }}>{prev2 !== undefined ? prev2.toLocaleString() : "-"}</td>}
                      {hasPrev2 && <td style={{ ...diffStyle(prev2Diff) }}>{fmtDiff(prev2Diff)}</td>}
                      {hasYoy && <td style={{ padding: "2px 4px", textAlign: "center", fontSize: 14, color: "#888", borderLeft: "2px solid #e8edf3" }}>{yoyVal !== undefined ? yoyVal.toLocaleString() : "-"}</td>}
                      {hasYoy && <td style={{ ...diffStyle(yoyDiff) }}>{fmtDiff(yoyDiff)}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
        const sqNavBar = (
          <div className="no-print" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button onClick={() => { if (canPrev) setSqMonthIdx(activeIdx - 1); }} style={btnStyle(!canPrev)}>◀</button>
            <span style={{ fontSize: 16, minWidth: 60, textAlign: "center" }}>{sqCurrent?.month || ""}</span>
            <button onClick={() => { if (canNext) setSqMonthIdx(activeIdx + 1); }} style={btnStyle(!canNext)}>▶</button>
            <span style={{ fontSize: 16, opacity: 0.4, marginLeft: 4 }}>{sqHistory.length}ヶ月分</span>
          </div>
        );
        const sqSummary = (
          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12, padding: "2px 16px 2px", fontSize: 14 }}>
            {/* 表は上位20件ずつだが、この合計は当月の全語句が対象なので明示する */}
            <span style={{ color: "#555", fontWeight: 500 }}>総検索数（全語句）: <strong style={{ color: "#0f3460", fontSize: 15 }}>{totalCount.toLocaleString()}</strong></span>
            {totalDiff !== null && (
              <span style={{ fontSize: 14, fontWeight: 600, color: totalDiff > 0 ? "#0a8f3c" : totalDiff < 0 ? "#c0392b" : "#888" }}>
                前月比: {totalDiff > 0 ? `+${totalDiff.toLocaleString()}` : totalDiff === 0 ? "→" : totalDiff.toLocaleString()}
              </span>
            )}
            {yoyTotalDiff !== null && (
              <span style={{ fontSize: 14, fontWeight: 600, color: yoyTotalDiff > 0 ? "#0a8f3c" : yoyTotalDiff < 0 ? "#c0392b" : "#888" }}>
                前年比: {yoyTotalDiff > 0 ? `+${yoyTotalDiff.toLocaleString()}` : yoyTotalDiff === 0 ? "→" : yoyTotalDiff.toLocaleString()}
              </span>
            )}
          </div>
        );
        return (<>
        {/* 検索語句 ページ1 */}
        <div style={slideStyle} className="slide">
          <div style={slideBarStyle}>
            <span>{shop.name} — 検索語句</span>
            {sqNavBar}
            <span className="pn-label" style={{ fontSize: 16, opacity: 0.45, fontWeight: 400 }}>{pn(pageNum)}</span>
          </div>
          <div style={{ ...slideBodyStyle, padding: "10px 9px", display: "flex", flexDirection: "column" }}>
            <div style={stitleStyle}>検索語句ランキング（{sqCurrent?.month || ""}）1〜{Math.min(PER_PAGE, currentKeywords.length)}位</div>
            {sqSummary}
            {renderSqTable(page1, 0)}
            {renderPageComment("searchQuery", "AI総評")}
          </div>
        </div>
        </>);
      })()}

      {/* ════ P8: 口コミ件数推移 ════ */}
      {(() => { pageNum++; return null; })()}
      {hasReviews && (
        <div style={slideStyle} className="slide">
          <div style={slideBarStyle}><span>{shop.name} — 口コミ件数推移</span><span className="pn-label" style={{ fontSize: 16, opacity: 0.45, fontWeight: 400 }}>{pn(pageNum)}</span></div>
          <div style={{ ...slideBodyStyle, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: "95%", maxHeight: 600 }}>
              <Line data={{ labels: reviewLabels, datasets: [{
                label: "口コミ件数", data: reviewCounts,
                borderColor: "#fbc02d", backgroundColor: "rgba(251,192,45,.35)",
                fill: true, tension: 0.3, pointRadius: 4, pointBackgroundColor: "#fbc02d", borderWidth: 2,
              }]}} options={{ ...lineOptions, scales: { ...lineOptions.scales, y: { ...lineOptions.scales.y, ticks: { ...lineOptions.scales.y.ticks, stepSize: 1, callback: (v: any) => Number.isInteger(Number(v)) ? Number(v).toLocaleString() : "" } } } }} />
            </div>
            <table style={{ width: "95%", margin: "8px auto 0", borderCollapse: "collapse", fontSize: 16 }}>
              <tbody>
                <tr style={{ background: "#0f3460" }}>
                  <td style={{ padding: "3px 4px", fontWeight: 600, color: "#fff", width: 60, whiteSpace: "nowrap" }}>月</td>
                  {reviewLabels.map((l, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center", color: "#fff", fontWeight: 600 }}>{l.split("/")[1]}月</td>)}
                </tr>
                <tr style={{ background: "#fff" }}>
                  <td style={{ padding: "3px 4px", fontWeight: 700, color: "#333" }}>件数</td>
                  {reviewCounts.map((v, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center", fontWeight: 700 }}>{v.toLocaleString()}</td>)}
                </tr>
              </tbody>
            </table>
            {renderPageComment("reviewCount", "AI総評")}
          </div>
        </div>
      )}

      {/* ════ P9: 月間口コミ増加数 ════ */}
      {(() => { pageNum++; return null; })()}
      {hasReviews && (
        <div style={slideStyle} className="slide">
          <div style={slideBarStyle}><span>{shop.name} — 月間口コミ増加数</span><span className="pn-label" style={{ fontSize: 16, opacity: 0.45, fontWeight: 400 }}>{pn(pageNum)}</span></div>
          <div style={{ ...slideBodyStyle, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: "95%", maxHeight: 600 }}>
              {(() => {
                const deltaData = reviewDelta.slice(1).map(v => Math.max(v ?? 0, 0));
                const deltaColors = deltaData.map(v => v >= 20 ? "rgba(39,174,96,.75)" : v >= 10 ? "rgba(251,192,45,.75)" : v > 0 ? "rgba(229,115,115,.75)" : "rgba(200,200,200,.4)");
                const datalabelPlugin = {
                  id: "reviewDeltaLabels",
                  afterDatasetsDraw(chart: any) {
                    const { ctx } = chart;
                    chart.data.datasets[0]?.data?.forEach((value: number, index: number) => {
                      const meta = chart.getDatasetMeta(0);
                      const bar = meta.data[index];
                      if (!bar) return;
                      ctx.save();
                      ctx.fillStyle = "#333";
                      ctx.font = "bold 12px 'Noto Sans JP', sans-serif";
                      ctx.textAlign = "center";
                      ctx.textBaseline = "bottom";
                      ctx.fillText(value > 0 ? `+${value}` : String(value), bar.x, bar.y - 4);
                      ctx.restore();
                    });
                  },
                };
                return (
                  <Bar data={{ labels: reviewLabels.slice(1), datasets: [{
                    label: "月間増加数", data: deltaData,
                    backgroundColor: deltaColors,
                    borderRadius: 3,
                  }]}} plugins={[datalabelPlugin]} options={{ responsive: true, maintainAspectRatio: true, plugins: { legend: { display: false } }, layout: { padding: { top: 24 } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, min: 0, grid: { color: "#f0f0f0" }, ticks: { stepSize: 1 } } } }} />
                );
              })()}
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: 16, margin: "8px 0 4px", fontSize: 14 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 14, height: 14, borderRadius: 3, background: "rgba(39,174,96,.75)", display: "inline-block" }} />20件以上</span>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 14, height: 14, borderRadius: 3, background: "rgba(251,192,45,.75)", display: "inline-block" }} />10〜19件</span>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 14, height: 14, borderRadius: 3, background: "rgba(229,115,115,.75)", display: "inline-block" }} />1〜9件</span>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 14, height: 14, borderRadius: 3, background: "rgba(200,200,200,.4)", display: "inline-block" }} />0件</span>
            </div>
            <table style={{ width: "95%", margin: "4px auto 0", borderCollapse: "collapse", fontSize: 16 }}>
              <tbody>
                <tr style={{ background: "#f8f9fa" }}>
                  <td style={{ padding: "3px 4px", fontWeight: 600, color: "#666", width: 60, whiteSpace: "nowrap" }}>月</td>
                  {reviewLabels.slice(1).map((l, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center", color: "#888" }}>{l.split("/")[1]}月</td>)}
                </tr>
                <tr>
                  <td style={{ padding: "3px 4px", fontWeight: 700, color: "#333" }}>増加数</td>
                  {reviewDelta.slice(1).map((v, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center", fontWeight: 700 }}>{v != null ? (v >= 0 ? `+${v}` : String(v)) : "-"}</td>)}
                </tr>
              </tbody>
            </table>
            {/* 増加数は前月との差分なので初月は必ず出せない。
                前ページ（累計）と期間がずれる理由が分からないと欠測に見える */}
            {reviewLabels.length > 1 && (
              <div style={{ fontSize: 12, color: "#999", textAlign: "right", width: "95%", margin: "4px auto 0" }}>
                ※増加数は前月との差分のため、集計開始月（{reviewLabels[0]}）は対象外です
              </div>
            )}
            {renderPageComment("reviewDelta", "AI総評")}
          </div>
        </div>
      )}

      {/* ════ P10: 口コミ分析 ════ */}
      {(() => { pageNum++; return null; })()}
      <div style={slideStyle} className="slide">
        <div style={slideBarStyle}><span>{shop.name} — AIによる口コミ分析</span><span className="pn-label" style={{ fontSize: 16, opacity: 0.45, fontWeight: 400 }}>{pn(pageNum)}</span></div>
        <div style={slideBodyStyle}>
          <div style={stitleStyle}>口コミ分析（直近1年）</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "auto 1fr", gap: 16, flex: 1 }}>
            <div style={{ background: "#fff", borderRadius: 12, padding: "24px 28px", boxShadow: "0 1px 6px rgba(0,0,0,.04)", display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: "#27ae60", marginBottom: 14 }}>よく挙がる好評ポイント</h3>
              <div>{(() => {
                const sources = reviewAnalysis.positiveWordSources;
                const hasSources = sources && sources.length > 0 && sources.some(s => s.reviews.length > 0);
                const displayWords = (hasSources
                  ? reviewAnalysis.positiveWords.filter(w => sources.some(s => s.word === w && s.reviews.length > 0))
                  : reviewAnalysis.positiveWords
                ).filter(w => rwVisibility[`pos:${w}`] !== false);
                return displayWords.length > 0 ? displayWords.map((w, i) => {
                  const source = reviewAnalysis.positiveWordSources?.find(s => s.word === w);
                  return (
                    <span key={i}
                      onClick={() => handleWordClick(w, source, "positive")}
                      style={{ display: "inline-block", padding: "6px 16px", borderRadius: 16, fontSize: 16, margin: 5, fontWeight: 500, background: "#e6f9ee", color: "#0a8f3c", cursor: "pointer", transition: "opacity 0.2s" }}
                      title="クリックで該当口コミを表示"
                    >{w}</span>
                  );
                }) : <span style={{ color: "#bbb", fontSize: 16, fontStyle: "italic" }}>データ準備中</span>;
              })()}</div>
              <p className="no-print" style={{ fontSize: 16, color: "#aaa", marginTop: 8, margin: "8px 0 0" }}>※ クリックで該当する口コミを表示します</p>
            </div>
            <div style={{ background: "#fff", borderRadius: 12, padding: "24px 28px", boxShadow: "0 1px 6px rgba(0,0,0,.04)", display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: "#c0392b", marginBottom: 14 }}>よく挙がる改善ポイント</h3>
              <div>{(() => {
                const sources = reviewAnalysis.negativeWordSources;
                const hasSources = sources && sources.length > 0 && sources.some(s => s.reviews.length > 0);
                const displayWords = (hasSources
                  ? reviewAnalysis.negativeWords.filter(w => sources.some(s => s.word === w && s.reviews.length > 0))
                  : reviewAnalysis.negativeWords
                ).filter(w => rwVisibility[`neg:${w}`] !== false);
                return displayWords.length > 0 ? displayWords.map((w, i) => {
                  const source = reviewAnalysis.negativeWordSources?.find(s => s.word === w);
                  return (
                    <span key={i}
                      onClick={() => handleWordClick(w, source, "negative")}
                      style={{ display: "inline-block", padding: "6px 16px", borderRadius: 16, fontSize: 16, margin: 5, fontWeight: 500, background: "#fde8e8", color: "#c0392b", cursor: "pointer", transition: "opacity 0.2s" }}
                      title="クリックで該当口コミを表示"
                    >{w}</span>
                  );
                }) : <span style={{ color: "#bbb", fontSize: 16, fontStyle: "italic" }}>データ準備中</span>;
              })()}</div>
              <p className="no-print" style={{ fontSize: 16, color: "#aaa", marginTop: 8, margin: "8px 0 0" }}>※ クリックで該当する口コミを表示します</p>
            </div>
            <div style={{ background: "#fff", borderRadius: 12, padding: "24px 28px", boxShadow: "0 1px 6px rgba(0,0,0,.04)", gridColumn: "1/-1", display: "flex", flexDirection: "column", justifyContent: "center" }}>
              {/* summaryは口コミ限定ではなく当月全体の総評フィールドなので見出しを実態に合わせる */}
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>口コミ評価と今月の総評</h3>
              <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12 }}>
                <div>
                  {/* Math.roundだと4.7が★5つ＝満点に見えるため、評価値どおりの部分塗りにする */}
                  <div style={{ position: "relative", display: "inline-block", fontSize: 32, lineHeight: 1.2, letterSpacing: 1 }}>
                    <span style={{ color: "#dcdcdc" }}>★★★★★</span>
                    <span style={{
                      position: "absolute", top: 0, left: 0, color: "#fbc02d", overflow: "hidden", whiteSpace: "nowrap",
                      width: `${Math.max(0, Math.min(5, shop.rating)) / 5 * 100}%`,
                    }}>★★★★★</span>
                  </div>
                  <div>
                    <span style={{ fontSize: 56, fontWeight: 900, color: "#0f3460" }}>{shop.rating}</span>
                    <span style={{ fontSize: 16, color: "#888", marginLeft: 8 }}>/ 5.0（{displayTotalReviews.toLocaleString()}件）</span>
                  </div>
                </div>
              </div>
              <p style={{ fontSize: 16, lineHeight: 1.9, color: "#444", margin: 0 }} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(reviewAnalysis.summary, { ALLOWED_TAGS: ["strong", "em", "br"] }) }} />
              {renderPageComment("reviews", "口コミ傾向と強み")}
            </div>
          </div>
        </div>
      </div>

      {/* ════ 口コミの競合比較（同エリア） ════ */}
      {showCompetitors && competitorComparison && (() => {
        pageNum++;
        const comp = competitorComparison;
        // 差分の基準: リスト内の自店口コミ数（圏外なら店舗の総口コミ数で代用）
        const baseCount = comp.self?.reviewCount ?? displayTotalReviews;
        const selfIdx = comp.self ? comp.self.rank - 1 : -1;
        return (
        <div style={slideStyle} className="slide">
          <div style={slideBarStyle}><span>{shop.name} — 口コミの競合比較</span><span className="pn-label" style={{ fontSize: 16, opacity: 0.45, fontWeight: 400 }}>{pn(pageNum)}</span></div>
          {/* 20行の表で中身が詰まっているページ。justifyContent:center のままだと
              溢れた時に上下両方が切れてタイトルごと消えるため、上詰めにして
              万一溢れても見出しは必ず残るようにする */}
          <div style={{ ...slideBodyStyle, padding: "16px 24px", justifyContent: "flex-start" }}>
            <div style={{ ...stitleStyle, marginBottom: 10, flexShrink: 0 }}>
              口コミの競合比較（同エリア）
              <span style={{ fontSize: 14, fontWeight: 400, color: "#999", marginLeft: 10 }}>
                「{comp.keyword}」検索の上位{comp.competitors.length}店舗
                {comp.fetchedAt && (() => { const d = new Date(comp.fetchedAt); return `（${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}時点）`; })()}
                {!comp.self && "／あなたの店舗は上位圏外"}
              </span>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", borderRadius: 10, overflow: "hidden", boxShadow: "0 1px 6px rgba(0,0,0,.04)" }}>
              <thead>
                <tr style={{ background: "#0f3460" }}>
                  {/* 「#」だけでは何の順位か分からないため列名を明示 */}
                  <th style={{ padding: "4px 10px", color: "#fff", fontSize: 13, fontWeight: 600, textAlign: "center", width: 52 }}>検索順位</th>
                  <th style={{ padding: "4px 12px", color: "#fff", fontSize: 13, fontWeight: 600, textAlign: "left" }}>店舗名</th>
                  <th style={{ padding: "4px 10px", color: "#fff", fontSize: 13, fontWeight: 600, textAlign: "center", width: 70 }}>評価</th>
                  <th style={{ padding: "4px 10px", color: "#fff", fontSize: 13, fontWeight: 600, textAlign: "center", width: 90 }}>口コミ数</th>
                  <th style={{ padding: "4px 10px", color: "#fff", fontSize: 13, fontWeight: 600, textAlign: "center", width: 100 }}>自店との差</th>
                </tr>
              </thead>
              <tbody>
                {comp.competitors.map((c, i) => {
                  const isSelf = i === selfIdx;
                  const diff = baseCount - c.reviewCount;
                  return (
                    <tr key={i} style={{ background: isSelf ? "#cfe0f5" : i % 2 === 1 ? "#f7f9fc" : "#fff", fontWeight: isSelf ? 700 : 400 }}>
                      <td style={{ padding: "2px 10px", fontSize: 13, textAlign: "center", color: "#333", borderBottom: "1px solid #eef1f6" }}>{i + 1}</td>
                      <td style={{ padding: "2px 12px", fontSize: 13, color: "#333", borderBottom: "1px solid #eef1f6", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 480 }}>{c.name}{isSelf && "（あなた）"}</td>
                      <td style={{ padding: "2px 10px", fontSize: 13, textAlign: "center", color: "#333", borderBottom: "1px solid #eef1f6" }}>{c.rating > 0 ? c.rating.toFixed(1) : "-"}</td>
                      <td style={{ padding: "2px 10px", fontSize: 13, textAlign: "center", color: "#333", borderBottom: "1px solid #eef1f6" }}>{c.reviewCount.toLocaleString()}件</td>
                      <td style={{ padding: "2px 10px", fontSize: 13, textAlign: "center", fontWeight: 700, borderBottom: "1px solid #eef1f6", color: isSelf ? "#888" : diff < 0 ? "#c0392b" : diff > 0 ? "#0a8f3c" : "#888" }}>
                        {isSelf ? "-" : diff < 0 ? `${diff.toLocaleString()}件` : diff > 0 ? `+${diff.toLocaleString()}件` : "±0件"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {/* 競合値はMaps掲載値のスナップショットのため、レポート対象月の自店数値と一致しない。
                注記が無いと「P1は231件なのにここは243件」と読まれるので必ず突き合わせを書く */}
            <div style={{ fontSize: 11, color: "#888", marginTop: 4, lineHeight: 1.45, flexShrink: 0 }}>
              ※「自店との差」は自店の口コミ数−各店の口コミ数です。
              {comp.fetchedAt && (() => {
                const d = new Date(comp.fetchedAt);
                const stamp = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
                return `この表はすべて${stamp}時点のGoogleマップ掲載値のため、レポート対象月（${curLabel}）末時点の自店実績（${displayTotalReviews.toLocaleString()}件・評価${shop.rating}）とは一致しません。`;
              })()}
            </div>
            {renderPageComment("competitor", "AI総評")}
          </div>
        </div>
        );
      })()}

      {/* ════ 口コミ言語別分析 ════ */}
      {langStats.length > 1 && (() => { pageNum++; return (
        <div style={slideStyle} className="slide">
          <div style={slideBarStyle}><span>{shop.name} — 口コミ言語別分析</span><span className="pn-label" style={{ fontSize: 16, opacity: 0.45, fontWeight: 400 }}>{pn(pageNum)}</span></div>
          <div style={slideBodyStyle}>
            <div style={stitleStyle}>口コミ言語別集計 <span style={{ fontSize: 16, fontWeight: 400, color: "#999" }}>※コメント付き口コミのみ対象（{shop.totalReviews}件中{langStats.reduce((s, st) => s + st.total, 0)}件）</span></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
              <div style={{ background: "#fff", borderRadius: 10, padding: "16px 20px", boxShadow: "0 1px 4px rgba(0,0,0,.04)" }}>
                <div style={{ fontSize: 16, color: "#888" }}>口コミ総数</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: "#1a2a44" }}>{langStats.reduce((s, st) => s + st.total, 0).toLocaleString()}</div>
              </div>
              <div style={{ background: "#fff", borderRadius: 10, padding: "16px 20px", boxShadow: "0 1px 4px rgba(0,0,0,.04)" }}>
                <div style={{ fontSize: 16, color: "#888" }}>低評価（★1-3）</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: "#c0392b" }}>{langStats.reduce((s, st) => s + st.lowRatingCount, 0).toLocaleString()}</div>
              </div>
              <div style={{ background: "#fff", borderRadius: 10, padding: "16px 20px", boxShadow: "0 1px 4px rgba(0,0,0,.04)" }}>
                <div style={{ fontSize: 16, color: "#888" }}>検出言語数</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: "#2980b9" }}>{langStats.length}</div>
              </div>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 16 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #e0e0e0" }}>
                  <th style={{ textAlign: "left", padding: "8px 10px", color: "#666", fontWeight: 600 }}>言語</th>
                  <th style={{ textAlign: "left", padding: "8px 6px", color: "#666", fontWeight: 600 }}>推定国</th>
                  <th style={{ textAlign: "right", padding: "8px 6px", color: "#666", fontWeight: 600 }}>合計</th>
                  <th style={{ textAlign: "right", padding: "8px 6px", color: "#666", fontWeight: 600 }}>★1</th>
                  <th style={{ textAlign: "right", padding: "8px 6px", color: "#666", fontWeight: 600 }}>★2</th>
                  <th style={{ textAlign: "right", padding: "8px 6px", color: "#666", fontWeight: 600 }}>★3</th>
                  <th style={{ textAlign: "right", padding: "8px 6px", color: "#666", fontWeight: 600 }}>★4</th>
                  <th style={{ textAlign: "right", padding: "8px 6px", color: "#666", fontWeight: 600 }}>★5</th>
                  <th style={{ textAlign: "right", padding: "8px 6px", color: "#c0392b", fontWeight: 600 }}>低評価</th>
                  <th style={{ textAlign: "right", padding: "8px 6px", color: "#c0392b", fontWeight: 600 }}>低評価率</th>
                  <th style={{ textAlign: "right", padding: "8px 10px", color: "#666", fontWeight: 600 }}>構成比</th>
                </tr>
              </thead>
              <tbody>
                {(() => { const totalLang = langStats.reduce((s, st) => s + st.total, 0); return langStats.map((s, i) => (
                  <tr key={s.lang} style={{ borderBottom: "1px solid #f0f0f0", background: i % 2 === 0 ? "#fafbfc" : "#fff" }}>
                    <td style={{ padding: "7px 10px", fontWeight: 600, color: "#333" }}>{s.lang}</td>
                    <td style={{ padding: "7px 6px", color: "#666" }}>{s.country}</td>
                    <td style={{ padding: "7px 6px", textAlign: "right", fontWeight: 600 }}>{s.total.toLocaleString()}</td>
                    <td style={{ padding: "7px 6px", textAlign: "right", color: "#c0392b" }}>{s.star1 || "-"}</td>
                    <td style={{ padding: "7px 6px", textAlign: "right", color: "#e67e22" }}>{s.star2 || "-"}</td>
                    <td style={{ padding: "7px 6px", textAlign: "right", color: "#f39c12" }}>{s.star3 || "-"}</td>
                    <td style={{ padding: "7px 6px", textAlign: "right", color: "#888" }}>{s.star4 || "-"}</td>
                    <td style={{ padding: "7px 6px", textAlign: "right", color: "#27ae60" }}>{s.star5 || "-"}</td>
                    <td style={{ padding: "7px 6px", textAlign: "right", fontWeight: 600, color: "#c0392b" }}>{s.lowRatingCount || "-"}</td>
                    <td style={{ padding: "7px 6px", textAlign: "right", color: "#c0392b" }}>{s.total > 0 ? (s.lowRatingCount / s.total * 100).toFixed(1) + "%" : "-"}</td>
                    <td style={{ padding: "7px 10px", textAlign: "right", color: "#999" }}>{totalLang > 0 ? (s.total / totalLang * 100).toFixed(1) + "%" : "-"}</td>
                  </tr>
                )); })()}
              </tbody>
            </table>
            {renderPageComment("language", "AI総評")}
          </div>
        </div>
      ); })()}

      {/* ════ 総括 ════ */}
      {(() => { pageNum++; const isEditingActions = pcEditingKey === "actions"; return (
        <div style={slideStyle} className="slide">
          <div style={slideBarStyle}><span>{shop.name} — 総括</span><span className="pn-label" style={{ fontSize: 16, opacity: 0.45, fontWeight: 400 }}>{pn(pageNum)}</span></div>
          <div style={slideBodyStyle}>
            <div style={stitleStyle}>{curLabel} 総括</div>
            {/* 当月サマリー: 「総括」ページに総括が無く改善策だけ、という構成を解消する */}
            {pageComments.monthly && (
              <div style={{ background: "#fff", border: "1px solid #dbe3ef", borderRadius: 12, padding: "14px 20px", marginBottom: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#0f3460", marginBottom: 6 }}>{curLabel} のまとめ</div>
                <p style={{ fontSize: 16, lineHeight: 1.8, color: "#333", margin: 0 }}
                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(pageComments.monthly, { ALLOWED_TAGS: ["strong", "em", "br"] }) }} />
              </div>
            )}
            {/* flex:1 だと項目3件でも枠がスライド高いっぱいに広がり8割が空白になる */}
            <div style={{ background: "linear-gradient(135deg,#f0f4ff,#fff)", border: "2px solid #0f3460", borderRadius: 14, padding: "24px 28px", display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: "#0f3460", margin: 0 }}>次のアクション</h3>
                {isLoggedIn && (
                  <div className="no-print" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    {!isEditingActions ? (
                      <button onClick={() => startEditPageComment("actions")} style={{ fontSize: 14, padding: "3px 10px", borderRadius: 6, border: "1px solid #ccd", background: "#fff", cursor: "pointer", color: "#555" }}>編集</button>
                    ) : (
                      <>
                        <button onClick={savePageComment} disabled={pcSaving || !canData}
                          title={!canData ? PERMISSION_DENIED_HINT.DATA_OP : undefined}
                          style={{ fontSize: 14, padding: "3px 10px", borderRadius: 6, border: "none", background: pcSaving || !canData ? "#999" : "#0a8f3c", color: "#fff", cursor: pcSaving ? "wait" : !canData ? "not-allowed" : "pointer" }}>{pcSaving ? "保存中..." : "保存"}</button>
                        <button onClick={() => { setPcEditingKey(null); setPcError(""); }} style={{ fontSize: 14, padding: "3px 10px", borderRadius: 6, border: "1px solid #ccd", background: "#fff", cursor: "pointer", color: "#555" }}>キャンセル</button>
                      </>
                    )}
                    {pcSavedKey === "actions" && <span style={{ fontSize: 14, color: "#0a8f3c" }}>保存しました</span>}
                    {isEditingActions && pcError && <span style={{ fontSize: 14, color: "#c0392b" }}>{pcError}</span>}
                  </div>
                )}
              </div>
              {isEditingActions ? (
                <textarea value={pcEditingValue} onChange={(e) => setPcEditingValue(e.target.value)}
                  style={{ width: "100%", flex: 1, minHeight: 200, padding: "10px 12px", fontSize: 16, lineHeight: 1.8, border: "1px solid #ccd", borderRadius: 8, resize: "vertical", fontFamily: "inherit", color: "#333", background: "#fff" }} />
              ) : pageComments.actions.length > 0 ? (
                /* Tailwindのpreflightが list-style を none にするため明示指定が必須。
                   指定が無いと番号も「・」も出ず、ただの改行の羅列に見える（2026-07-31） */
                <ol style={{ fontSize: 16, lineHeight: 2, color: "#333", paddingLeft: 26, margin: 0, listStyleType: "decimal", listStylePosition: "outside" }}>
                  {pageComments.actions.map((a, i) => (
                    <li key={i} style={{ paddingLeft: 4 }} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(a, { ALLOWED_TAGS: ["strong", "em", "br"] }) }} />
                  ))}
                </ol>
              ) : (
                <p style={{ color: "#999", fontStyle: "italic" }}>データ準備中</p>
              )}
            </div>
          </div>
        </div>
      ); })()}

      {/* ════ メモ ════ */}
      {/* メモが空のときはスライドごとPDFから除外（空白ページ防止）。
          最終ページなので他ページの番号はずれず、印刷時は分母のみ handlePdfDownload で調整する */}
      {(() => { pageNum++; return (
        <div style={slideStyle} className={memo ? "slide" : "slide no-print"}>
          <div style={slideBarStyle}><span>{shop.name} — メモ</span><span className="pn-label" style={{ fontSize: 16, opacity: 0.45, fontWeight: 400 }}>{pn(pageNum)}</span></div>
          <div style={{ ...slideBodyStyle, display: "flex", flexDirection: "column" }}>
            <div style={stitleStyle}>メモ<span className="no-print" style={{ fontSize: 16, fontWeight: 400, color: "#999" }}>（担当者用）</span></div>
            <div className={memo && !memoEditing ? undefined : "no-print"} style={{ background: "#fff", borderRadius: 12, padding: "24px 28px", boxShadow: "0 1px 6px rgba(0,0,0,.04)", flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginBottom: 10 }}>
                <div className="no-print" style={{ display: "flex", gap: 6 }}>
                  {!memoEditing ? (
                    <button onClick={() => setMemoEditing(true)} style={{ fontSize: 16, padding: "3px 10px", borderRadius: 6, border: "1px solid #ccd", background: "#fff", cursor: "pointer", color: "#555" }}>
                      {memo ? "編集" : "追加"}
                    </button>
                  ) : (
                    <>
                      <button onClick={saveMemo} disabled={memoLoading || !canMemo}
                        title={!canMemo ? PERMISSION_DENIED_HINT.MEMO : undefined}
                        style={{ fontSize: 16, padding: "3px 10px", borderRadius: 6, border: "none", background: memoLoading || !canMemo ? "#999" : "#0f3460", color: "#fff", cursor: memoLoading ? "wait" : !canMemo ? "not-allowed" : "pointer" }}>{memoLoading ? "保存中..." : "保存"}</button>
                      <button onClick={() => setMemoEditing(false)} style={{ fontSize: 16, padding: "3px 10px", borderRadius: 6, border: "1px solid #ccd", background: "#fff", cursor: "pointer", color: "#555" }}>キャンセル</button>
                    </>
                  )}
                  {memoSaved && <span style={{ fontSize: 16, color: "#0a8f3c" }}>保存しました</span>}
                </div>
              </div>
              {memoEditing ? (
                <textarea value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="この店舗への所感やメモを記入..."
                  style={{ width: "100%", minHeight: 200, padding: "8px 10px", fontSize: 16, lineHeight: 1.6, border: "1px solid #ccd", borderRadius: 8, resize: "vertical", fontFamily: "inherit" }} />
              ) : memo ? (
                <p style={{ fontSize: 16, lineHeight: 1.8, color: "#444", margin: 0, whiteSpace: "pre-wrap" }}>{memo}</p>
              ) : (
                <p style={{ fontSize: 16, color: "#aaa", margin: 0, fontStyle: "italic" }}>メモなし</p>
              )}
            </div>
          </div>
        </div>
      ); })()}

      {/* ワード詳細モーダル（ポジティブ/ネガティブ共用） */}
      {negativeModal && (
        <div style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", background: "rgba(0,0,0,0.5)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setNegativeModal(null)}>
          <div style={{ background: "#fff", borderRadius: 16, padding: "28px 32px", maxWidth: 700, width: "90%", maxHeight: "80vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: negativeModal.type === "positive" ? "#0a8f3c" : "#c0392b" }}>
                「{negativeModal.word}」に関する口コミ
              </h3>
              <button onClick={() => setNegativeModal(null)}
                style={{ background: "none", border: "none", fontSize: 24, cursor: "pointer", color: "#999", padding: "0 4px" }}>×</button>
            </div>
            {negativeModal.reviews.length > 0 && (
              <p style={{ fontSize: 16, color: negativeModal.matched ? "#0a8f3c" : "#999", margin: "0 0 12px", padding: "6px 12px", background: negativeModal.matched ? "#e6f9ee" : "#f8f9fb", borderRadius: 8 }}>
                {negativeModal.matched
                  ? `「${negativeModal.word}」に関連する口コミ ${negativeModal.reviews.length}件`
                  : `キーワードに一致する口コミが見つからなかったため、最新の口コミを表示しています`}
              </p>
            )}
            {negativeModal.reviews.length > 0 ? negativeModal.reviews.map((r, i) => {
              const ratingMap: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
              const stars = ratingMap[r.starRating] || 0;
              return (
                <div key={i} style={{ borderBottom: "1px solid #f0f0f0", padding: "14px 0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 16, color: "#333" }}>{r.reviewer}</span>
                      {stars > 0 && <span style={{ color: "#fbc02d", fontSize: 16 }}>{"★".repeat(stars)}{"☆".repeat(5 - stars)}</span>}
                    </div>
                    <span style={{ fontSize: 16, color: "#999" }}>{r.date}</span>
                  </div>
                  <p style={{ fontSize: 16, lineHeight: 1.8, color: "#444", margin: "0 0 4px" }}>{r.comment}</p>
                  {r.reply && (
                    <div style={{ marginTop: 8, padding: "10px 14px", background: "#f0f4ff", borderRadius: 8, borderLeft: "3px solid #4a7fff" }}>
                      <div style={{ fontSize: 16, fontWeight: 600, color: "#4a7fff", marginBottom: 4 }}>返信済み</div>
                      <p style={{ fontSize: 16, lineHeight: 1.7, color: "#555", margin: 0 }}>{r.reply}</p>
                    </div>
                  )}
                </div>
              );
            }) : (
              <p style={{ color: "#999", textAlign: "center", padding: 20 }}>該当する口コミが見つかりませんでした。分析時より古い口コミが対象期間から外れた可能性があります。再分析すると解消されます。</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
