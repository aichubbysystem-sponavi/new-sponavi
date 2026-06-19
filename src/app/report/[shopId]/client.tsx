"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import DOMPurify from "isomorphic-dompurify";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

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

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend, Filler);

// ── Constants (HTML テンプレート準拠) ──

const SLIDE_W = 1123;
const SLIDE_H = 794;

const slideStyle: React.CSSProperties = {
  width: SLIDE_W, height: SLIDE_H, margin: "20px auto", background: "#f0f2f5",
  borderRadius: 8, overflow: "hidden", boxShadow: "0 8px 40px rgba(0,0,0,.4)",
  display: "flex", flexDirection: "column", position: "relative",
  pageBreakAfter: "always", pageBreakInside: "avoid",
};

const slideBarStyle: React.CSSProperties = {
  background: "linear-gradient(135deg,#1a1a2e,#0f3460)", color: "#fff",
  padding: "12px 9px", fontSize: 16, fontWeight: 700,
  display: "flex", justifyContent: "space-between", alignItems: "center",
  flexShrink: 0, letterSpacing: 0.5,
};

const slideBodyStyle: React.CSSProperties = {
  flex: 1, padding: "28px 9px", display: "flex", flexDirection: "column",
  justifyContent: "center", overflow: "hidden",
};

const stitleStyle: React.CSSProperties = {
  fontSize: 17, fontWeight: 700, color: "#0f3460",
  borderLeft: "4px solid #e94560", paddingLeft: 12, marginBottom: 16,
};

const footerStyle: React.CSSProperties = {
  background: "#1a1a2e", color: "rgba(255,255,255,0.3)", textAlign: "center",
  padding: 8, fontSize: 16, flexShrink: 0,
};

// KPI top-bar colors
const kpiTopColors = [
  "linear-gradient(90deg,#4fc3f7,#0288d1)",
  "linear-gradient(90deg,#81c784,#388e3c)",
  "linear-gradient(90deg,#ffb74d,#f57c00)",
  "linear-gradient(90deg,#ba68c8,#7b1fa2)",
  "linear-gradient(90deg,#e57373,#d32f2f)",
  "linear-gradient(90deg,#4db6ac,#00897b)",
  "linear-gradient(90deg,#7986cb,#3949ab)",
  "linear-gradient(90deg,#ffd54f,#fbc02d)",
];

// ── Helpers ──

function pctChange(cur: number, prev: number): { pct: number; text: string; isUp: boolean; isFlat: boolean } {
  if (prev === 0 && cur === 0) return { pct: 0, text: "±0.0%", isUp: true, isFlat: true };
  if (prev === 0) return { pct: 999, text: "+∞", isUp: true, isFlat: false };
  const pct = ((cur - prev) / prev) * 100;
  const isFlat = Math.abs(pct) < 0.05;
  return { pct, text: isFlat ? "+0.0%" : `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`, isUp: pct >= 0, isFlat };
}

function buildStackedOptions() {
  return {
    responsive: true, maintainAspectRatio: true, aspectRatio: 2.2,
    plugins: {
      title: { display: false },
      legend: { position: "top" as const, labels: { font: { family: "Noto Sans JP", size: 11 } } },
      tooltip: { mode: "index" as const, intersect: false, callbacks: {
        afterBody: (items: any[]) => { let t = 0; items.forEach((i: any) => (t += i.parsed.y)); return "合計: " + t.toLocaleString(); },
      }},
    },
    scales: {
      x: { stacked: true, grid: { display: false } },
      y: { stacked: true, beginAtZero: true, grid: { color: "#f0f0f0" }, ticks: { callback: (v: any) => Number(v).toLocaleString() } },
    },
  };
}

const lineOptions = {
  responsive: true, maintainAspectRatio: true,
  plugins: { legend: { display: false } },
  scales: {
    x: { grid: { display: false } },
    y: { beginAtZero: false, grid: { color: "#f0f0f0" }, ticks: { callback: (v: any) => Number(v).toLocaleString() } },
  },
};

/** "2025/10" → 202510 の数値変換（月ソート・比較用） */
function monthToNum(m: string): number {
  const p = m.split("/");
  return (parseInt(p[0]) || 0) * 100 + (parseInt(p[1]) || 0);
}

// ── Component ──

export default function ReportClient({
  data, shopId, dataSource = "mock", googleReviewUrl = null, targetMonth: targetMonthProp,
}: {
  data: ReportData; shopId: string; dataSource?: "cache" | "spreadsheet" | "mock"; googleReviewUrl?: string | null; targetMonth?: string;
}) {
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

  const { shop, kpis: rawKpis, monthlyLabels, charts, keywords, rankingHistory, reviewLabels, reviewCounts, reviewDelta, reviewAnalysis, comments, searchQueries, gridRanking } = trimmedData;

  // 全期間で値が0の指標を自動判定（業種によって「予約」「フードメニュー」等がない場合）
  const hasBookingsData = charts.bookings?.some(v => v > 0) ?? false;
  const hasFoodMenusData = charts.foodMenus?.some(v => v > 0) ?? false;

  // 表示月の口コミ累計（reviewCountsのトリム済み末尾 = 対象月の値）
  const displayTotalReviews = reviewCounts.length > 0 ? reviewCounts[reviewCounts.length - 1] : shop.totalReviews;

  const hasKeywords = keywords.length > 0 || !!(gridRanking && gridRanking.history.length > 0);
  const hasRankingHistory = rankingHistory && rankingHistory.labels.length > 0;
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
  const [showSettings, setShowSettings] = useState(false);
  const [negativeModal, setNegativeModal] = useState<{ word: string; reviews: { reviewer: string; comment: string; reply?: string | null; date: string; starRating: string }[]; type?: "positive" | "negative"; matched?: boolean } | null>(null);
  const [editingGridCell, setEditingGridCell] = useState<{ row: number; col: number } | null>(null);
  const [editingGridValue, setEditingGridValue] = useState("");
  const [gridGenerating, setGridGenerating] = useState(false);
  const [gridEditMonth, setGridEditMonth] = useState("");
  const [gridEditKw, setGridEditKw] = useState("");

  // セクション表示ON/OFF（店舗ごとにDB保存、localStorageはフォールバック）
  const visKey = `report-visibility-${shopId}`;
  const [sectionVisibility, setSectionVisibility] = useState<Record<string, boolean>>({
    keywords: true,
    rankingHistory: true,
    searchQueries: true,
    gridRanking: true,
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
    if (saveTimersRef.current[field]) clearTimeout(saveTimersRef.current[field]);
    saveTimersRef.current[field] = setTimeout(async () => {
      const authH = await getAuthHeaders();
      fetch(`/api/report/display-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authH },
        body: JSON.stringify({ shopId, [field]: value }),
      }).catch(() => {});
    }, 500);
  }, [shopId]);

  useEffect(() => {
    setMounted(true);
    // DBから読み込み → localStorageフォールバック
    fetch(`/api/report/display-settings?shopId=${encodeURIComponent(shopId)}`)
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
      });
  }, [shopId, visKey, kwVisKey, rwVisKey]);

  const toggleSection = (key: string) => {
    setSectionVisibility(prev => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem(visKey, JSON.stringify(next));
      saveToDb("sectionVisibility", next);
      return next;
    });
  };

  const toggleKeyword = (word: string) => {
    setKwVisibility(prev => {
      const next = { ...prev, [word]: prev[word] === false ? true : false };
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

  // 口コミ言語別データ
  const [langStats, setLangStats] = useState<{ lang: string; country: string; total: number; star1: number; star2: number; star3: number; star4: number; star5: number; lowRatingCount: number }[]>([]);
  const [langLoading, setLangLoading] = useState(false);
  useEffect(() => {
    if (!shopId) return;
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
        if (res.ok) {
          const d = await res.json();
          setLangStats(d.stats || []);
        } else {
          console.error("[lang-stats] API error:", res.status, await res.text().catch(() => ""));
        }
      } catch (e) {
        console.error("[lang-stats] fetch error:", e);
      }
      setLangLoading(false);
    })();
  }, [shopId]);

  // 指標の表示判定: 自動（データ0で非表示）+ 手動ON/OFF
  const hasBookings = hasBookingsData && sectionVisibility.metricBookings !== false;
  const hasFoodMenus = hasFoodMenusData && sectionVisibility.metricFoodMenus !== false;
  const kpis = rawKpis.filter(kpi => {
    if (kpi.label === "予約" && !hasBookings) return false;
    if (kpi.label === "フードメニュークリック" && !hasFoodMenus) return false;
    return true;
  });

  // gridRankingの中心点順位をキーワード順位として使用（あればスプレッドシートより優先）
  const gridKeywords = useMemo(() => {
    if (!gridRanking || gridRanking.history.length === 0) return null;
    // 対象月（curLabel）以前のデータのみ使用
    const filtered = curLabel
      ? gridRanking.history.filter(h => monthToNum(h.month) <= monthToNum(curLabel))
      : gridRanking.history;
    if (filtered.length === 0) return null;
    const latest = filtered[filtered.length - 1];
    const prev = filtered.length >= 2 ? filtered[filtered.length - 2] : null;
    if (!latest?.snapshots) return null;

    const result: { word: string; rank: number; prevRank: number }[] = [];
    for (const snap of latest.snapshots) {
      const center = snap.results.find(r => r.row === Math.floor(snap.gridSize / 2) && r.col === Math.floor(snap.gridSize / 2));
      const rank = center?.rank || 0;
      let prevRank = rank;
      if (prev?.snapshots) {
        const prevSnap = prev.snapshots.find(s => s.keyword === snap.keyword);
        if (prevSnap) {
          const prevCenter = prevSnap.results.find(r => r.row === Math.floor(prevSnap.gridSize / 2) && r.col === Math.floor(prevSnap.gridSize / 2));
          prevRank = prevCenter?.rank || 0;
        }
      }
      if (rank > 0) result.push({ word: snap.keyword, rank, prevRank: prevRank || rank });
    }
    return result.length > 0 ? result : null;
  }, [gridRanking, curLabel]);

  // gridRankingの中心点があればそちらを使用、なければスプレッドシートのkeywords
  const effectiveKeywords = gridKeywords || keywords;

  // 表示するキーワードのみフィルタ
  const visibleKeywords = effectiveKeywords.filter(kw => kwVisibility[kw.word] !== false && (kw.rank > 0 || kw.prevRank > 0));
  const visibleRankingDatasets = (rankingHistory?.datasets?.filter(ds => {
    if (kwVisibility[ds.word] === false) return false;
    // 全期間データなし（全て null）のキーワードを非表示
    const hasAnyData = ds.ranks.some((r: number | null) => r !== null);
    return hasAnyData;
  }) || []);

  const showKeywords = mounted && sectionVisibility.keywords !== false && hasKeywords;
  const showRankingHistory = mounted && sectionVisibility.rankingHistory !== false && hasRankingHistory;
  const showSearchQueries = mounted && sectionVisibility.searchQueries !== false && hasSearchQueries;
  const showGridRanking = mounted && sectionVisibility.gridRanking !== false && hasGridRanking;

  // グリッドマップ用: 現在表示中のスナップショットを取得
  const activeGridKw = gridRanking?.keywords[gridKwIdx] || gridRanking?.keywords[0] || "";
  // マップ描画用: レポート対象月以前の直近6ヶ月（グリッドセクション描画と同じ基準）
  const gridRecentHistory = useMemo(() => {
    if (!gridRanking) return [];
    return gridRanking.history.filter(h => monthToNum(h.month) <= monthToNum(curLabel)).slice(-6);
  }, [gridRanking, curLabel]);
  const activeGridMonthI = gridMonthIdx >= 0 && gridMonthIdx < gridRecentHistory.length ? gridMonthIdx : gridRecentHistory.length - 1;
  const activeGridSnapshot = gridRecentHistory[activeGridMonthI]?.snapshots.find(s => s.keyword === activeGridKw);

  // Google Maps JS API読み込み + マーカー描画（キーワード別）
  const renderGridMapForKw = useCallback((kw: string) => {
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

    const centerPt = pts.find(p => p.row === Math.floor(gs / 2) && p.col === Math.floor(gs / 2));
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
      mapTypeControl: true, streetViewControl: false, fullscreenControl: false,
      styles: [
        { featureType: "poi", stylers: [{ visibility: "off" }] },
        { featureType: "transit", stylers: [{ visibility: "off" }] },
      ],
    });
    gridGoogleMapRefs.current[kw] = gmap;
    gridMarkersRefs.current[kw] = [];

    const bounds = new window.google.maps.LatLngBounds();
    const rankColor = (r: number) => r <= 0 ? "#6B7280" : r <= 3 ? "#16A34A" : r <= 10 ? "#2563EB" : r <= 20 ? "#F59E0B" : "#EF4444";

    pts.forEach(pt => {
      const marker = new window.google.maps.Marker({
        position: { lat: pt.lat, lng: pt.lng },
        map: gmap,
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          fillColor: rankColor(pt.rank), fillOpacity: 0.9,
          strokeColor: "#fff", strokeWeight: 2, scale: 18,
        },
        label: { text: pt.rank > 0 ? String(pt.rank) : "-", color: "#fff", fontWeight: "bold", fontSize: "16px" },
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

  // ワードクリック: 直近1年の口コミからAPI検索（全件表示）
  const handleWordClick = async (word: string, _source: any, type: "positive" | "negative") => {
    try {
      const authH = await getAuthHeaders();
      const res = await fetch(`/api/report/search-reviews?shop=${encodeURIComponent(shop.name)}&keyword=${encodeURIComponent(word)}&type=${type}`, { headers: authH });
      const data = await res.json();
      setNegativeModal({ word, reviews: data.reviews || [], type, matched: data.matched });
    } catch {
      setNegativeModal({ word, reviews: [], type, matched: false });
    }
  };

  // メモをSupabaseから読み込み
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/report/memo?shopName=${encodeURIComponent(shop.name)}&month=${encodeURIComponent(curLabel)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.memo) setMemo(data.memo);
        }
      } catch {}
    })();
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
    try {
      const html2canvas = (await import("html2canvas")).default;
      const { jsPDF } = await import("jspdf");
      const allSlides = document.querySelectorAll(".slide");
      if (allSlides.length === 0) { setPdfGenerating(false); return; }

      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pdfW = 297;
      const pdfH = 210;

      // PDF用の一時的なDOM変更
      const noPrintEls = document.querySelectorAll<HTMLElement>(".no-print");
      noPrintEls.forEach(el => { el.dataset.prevDisplay = el.style.display; el.style.display = "none"; });
      await new Promise(r => setTimeout(r, 200));

      // 通常スライド（grid以外）をキャプチャ
      let pageIdx = 0;
      let gridInsertDone = false;

      for (let i = 0; i < allSlides.length; i++) {
        const slide = allSlides[i] as HTMLElement;

        if (slide.classList.contains("grid-kw-slide")) {
          if (gridInsertDone) continue; // gridスライドは独自処理で1回だけ
          gridInsertDone = true;

          // ── グリッドランキングPDF: 独自レイアウト ──
          if (gridRanking && gridRanking.keywords.length > 0) {
            const gr = gridRanking;
            const filteredHistory = gr.history.filter(h => monthToNum(h.month) <= monthToNum(curLabel));
            const recentHistory = filteredHistory.slice(-6);
            const latestMonth = recentHistory[recentHistory.length - 1];
            const prevMonth = recentHistory.length >= 2 ? recentHistory[recentHistory.length - 2] : null;

            // ── PDF Grid P1: サマリーページ（全KW比較 + 各KW月別推移） ──
            const summaryDiv = document.createElement("div");
            summaryDiv.style.cssText = `width:${SLIDE_W}px;height:${SLIDE_H}px;background:#f0f2f5;display:flex;flex-direction:column;overflow:hidden;position:fixed;left:0;top:0;z-index:99999;font-family:'Noto Sans JP',sans-serif;`;

            // ヘッダー
            const header = document.createElement("div");
            header.style.cssText = `background:linear-gradient(135deg,#1a1a2e,#0f3460);color:#fff;padding:12px 9px;font-size:16px;font-weight:700;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;`;
            header.innerHTML = `<span>${shop.name} — 多地点順位計測 サマリー</span>`;
            summaryDiv.appendChild(header);

            const body = document.createElement("div");
            body.style.cssText = `flex:1;padding:16px 24px;display:flex;gap:24px;overflow:hidden;`;

            // 左: 全KW比較テーブル
            const leftCol = document.createElement("div");
            leftCol.style.cssText = `flex:0 0 480px;display:flex;flex-direction:column;`;
            if (latestMonth) {
              const th = `<tr>${["キーワード","平均順位","前月比","計測地点"].map((t,ti) => `<th style="background:#0f3460;color:#fff;padding:8px 12px;text-align:${ti===0?"left":"center"};font-size:15px;">${t}</th>`).join("")}</tr>`;
              const rows = latestMonth.snapshots.map((s, si) => {
                const ps = prevMonth?.snapshots.find(p => p.keyword === s.keyword);
                const diff = ps ? ps.avgRank - s.avgRank : 0;
                const dc = diff > 0 ? "#0a8f3c" : diff < 0 ? "#c0392b" : "#888";
                const ds = ps ? (diff > 0 ? `↑${diff.toFixed(1)}` : diff < 0 ? `↓${Math.abs(diff).toFixed(1)}` : "→") : "-";
                const rc = s.avgRank <= 3 ? "#15803d" : s.avgRank <= 10 ? "#1d4ed8" : s.avgRank <= 20 ? "#b45309" : "#999";
                return `<tr style="background:${si%2===0?"#fff":"#f8f9fb"}">
                  <td style="padding:8px 12px;font-size:15px;border-bottom:1px solid #eee;">${s.keyword}</td>
                  <td style="padding:8px 12px;text-align:center;font-size:15px;font-weight:800;color:${rc};border-bottom:1px solid #eee;">${s.avgRank}</td>
                  <td style="padding:8px 12px;text-align:center;font-size:15px;font-weight:700;color:${dc};border-bottom:1px solid #eee;">${ds}</td>
                  <td style="padding:8px 12px;text-align:center;font-size:15px;color:#888;border-bottom:1px solid #eee;">${s.gridSize}×${s.gridSize}</td>
                </tr>`;
              }).join("");
              leftCol.innerHTML = `<h3 style="font-size:16px;font-weight:700;color:#0f3460;margin:0 0 8px;">全キーワード比較（${latestMonth.month}）</h3>
                <div style="border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.04);">
                  <table style="width:100%;border-collapse:collapse;background:#fff;"><thead>${th}</thead><tbody>${rows}</tbody></table>
                </div>`;
            }
            body.appendChild(leftCol);

            // 右: 各KWの月別平均順位
            const rightCol = document.createElement("div");
            rightCol.style.cssText = `flex:1;display:flex;flex-direction:column;gap:10px;overflow:hidden;`;
            const trendMonthLabels = recentHistory.map(h => h.month.replace(/^\d{4}\//, "") + "月");
            gr.keywords.forEach(kw => {
              const data = recentHistory.map(h => {
                const s = h.snapshots.find(s => s.keyword === kw);
                return s ? s.avgRank : null;
              });
              const valid = data.filter((v): v is number => v !== null);
              const diffStr = valid.length >= 2 ? (() => {
                const d = valid[valid.length - 2] - valid[valid.length - 1];
                return d > 0 ? `<span style="color:#0a8f3c;font-weight:700;">↑${d.toFixed(1)}</span>` : d < 0 ? `<span style="color:#c0392b;font-weight:700;">↓${Math.abs(d).toFixed(1)}</span>` : `<span style="color:#888;">→</span>`;
              })() : `<span style="color:#888;">→</span>`;
              const thRow = trendMonthLabels.map((l, li) => `<th style="background:${li===trendMonthLabels.length-1?"#e94560":"#0f3460"};color:#fff;padding:5px 4px;text-align:center;font-weight:600;font-size:12px;white-space:nowrap;">${l}</th>`).join("") + `<th style="background:#0f3460;color:#fff;padding:5px 4px;text-align:center;font-weight:600;font-size:12px;">変動</th>`;
              const tdRow = data.map((v, vi) => {
                const c = v === null ? "#ddd" : v <= 3 ? "#15803d" : v <= 10 ? "#1d4ed8" : v <= 20 ? "#b45309" : "#999";
                return `<td style="padding:5px 4px;text-align:center;font-size:12px;font-weight:${v!==null&&v<=5?900:600};color:${c};border-bottom:1px solid #eee;">${v !== null ? v : "-"}</td>`;
              }).join("") + `<td style="padding:5px 4px;text-align:center;font-size:12px;border-bottom:1px solid #eee;">${diffStr}</td>`;
              const block = document.createElement("div");
              block.innerHTML = `<div style="font-size:13px;font-weight:700;color:#0f3460;margin-bottom:2px;">「${kw}」</div>
                <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:6px;overflow:hidden;"><thead><tr>${thRow}</tr></thead><tbody><tr>${tdRow}</tr></tbody></table>`;
              rightCol.appendChild(block);
            });
            body.appendChild(rightCol);
            summaryDiv.appendChild(body);
            document.body.appendChild(summaryDiv);
            await new Promise(r => setTimeout(r, 100));

            const summaryCanvas = await html2canvas(summaryDiv, {
              scale: 2, useCORS: true, logging: false, backgroundColor: "#f0f2f5",
              width: SLIDE_W, height: SLIDE_H,
            });
            if (pageIdx > 0) pdf.addPage();
            pdf.addImage(summaryCanvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, pdfW, pdfH);
            pageIdx++;
            summaryDiv.remove();

            // ── PDF Grid P2+: マップ左右2枚/ページ ──
            // アクティブKWのマップ領域をキャプチャ（これは既に描画済み）
            const activeSlide = document.querySelector<HTMLElement>(".grid-kw-slide:not(.grid-kw-hidden)");
            const mapCanvases: HTMLCanvasElement[] = [];

            for (let kwIdx = 0; kwIdx < gr.keywords.length; kwIdx++) {
              const kw = gr.keywords[kwIdx];
              // KWを切り替えてマップ描画
              setGridKwIdx(kwIdx);
              await new Promise(r => setTimeout(r, 100));
              // マップを再描画
              renderGridMapForKw(kw);
              await new Promise(r => setTimeout(r, 1500));
              // アクティブスライドのマップ領域をキャプチャ
              const currentActive = document.querySelector<HTMLElement>(".grid-kw-slide:not(.grid-kw-hidden)");
              if (currentActive) {
                const mapArea = currentActive.querySelector<HTMLElement>(".grid-kw-map-area");
                if (mapArea) {
                  const mc = await html2canvas(mapArea, {
                    scale: 2, useCORS: true, logging: false, backgroundColor: "#f0f2f5",
                  });
                  mapCanvases.push(mc);
                }
              }
            }

            // マップを左右2枚ずつPDFページに配置
            const halfW = pdfW / 2;
            for (let m = 0; m < mapCanvases.length; m += 2) {
              if (pageIdx > 0) pdf.addPage();
              // 左
              const leftImg = mapCanvases[m].toDataURL("image/jpeg", 0.92);
              const leftAspect = mapCanvases[m].height / mapCanvases[m].width;
              const leftImgH = Math.min(halfW * leftAspect, pdfH);
              const leftImgW = leftImgH / leftAspect;
              const leftX = (halfW - leftImgW) / 2;
              const leftY = (pdfH - leftImgH) / 2;
              pdf.addImage(leftImg, "JPEG", leftX, leftY, leftImgW, leftImgH);
              // 右
              if (m + 1 < mapCanvases.length) {
                const rightImg = mapCanvases[m + 1].toDataURL("image/jpeg", 0.92);
                const rightAspect = mapCanvases[m + 1].height / mapCanvases[m + 1].width;
                const rightImgH = Math.min(halfW * rightAspect, pdfH);
                const rightImgW = rightImgH / rightAspect;
                const rightX = halfW + (halfW - rightImgW) / 2;
                const rightY = (pdfH - rightImgH) / 2;
                pdf.addImage(rightImg, "JPEG", rightX, rightY, rightImgW, rightImgH);
              }
              pageIdx++;
            }

            // gridKwIdxを元に戻す
            setGridKwIdx(0);
          }
        } else {
          const canvas = await html2canvas(slide, {
            scale: 2, useCORS: true, logging: false, backgroundColor: "#f0f2f5",
          });
          const imgData = canvas.toDataURL("image/jpeg", 0.92);
          if (pageIdx > 0) pdf.addPage();
          pdf.addImage(imgData, "JPEG", 0, 0, pdfW, pdfH);
          pageIdx++;
        }
      }

      // DOM変更を元に戻す
      noPrintEls.forEach(el => { el.style.display = el.dataset.prevDisplay || ""; delete el.dataset.prevDisplay; });

      pdf.save(`${shop.name}_レポート_${curLabel.replace("/", "-")}.pdf`);
    } catch (err) {
      console.error("PDF generation error:", err);
      window.print();
    } finally {
      setPdfGenerating(false);
    }
  };

  // ── Page count ──
  // AIコメントのページ数を文字数ベースで計算（実際の分割ロジックと同期）
  const aiCommentPageCount = (() => {
    const ac = comments || [];
    if (ac.length === 0) return 1;
    let pages = 0;
    let ci = 0;
    while (ci < ac.length) {
      const limit = pages === 0 ? 750 : 850;
      let charCount = 0;
      let end = ci;
      while (end < ac.length) {
        const len = (ac[end] || "").replace(/<[^>]*>/g, "").length;
        if (end > ci && charCount + len > limit) break;
        charCount += len;
        end++;
      }
      pages++;
      ci = end;
    }
    return pages;
  })();
  let totalPages = 6 + aiCommentPageCount; // P1,P2(月次),P3-P5(グラフ),口コミ分析 + AIコメント(動的)
  if (hasReviews) totalPages += 2; // 口コミ件数推移, 月間増加数
  if (showKeywords) totalPages++;
  if (showRankingHistory) totalPages++;
  if (showGridRanking) totalPages += gridRanking!.keywords.length;
  if (langStats.length > 1) totalPages++; // 口コミ言語別分析
  if (showSearchQueries) {
    totalPages++;
    // 16件以上なら2ページ目も表示
    const sqHist = searchQueries?.history;
    const sqLatestKws = Array.isArray(sqHist) && sqHist.length > 0 ? (sqHist[sqHist.length - 1]?.keywords?.length || 0) : 0;
    if (sqLatestKws > 15) totalPages++;
  }

  function pn(slideNum: number) {
    return `${slideNum} / ${totalPages}`;
  }

  // ── Monthly table data ──
  const monthlyTableData = monthlyLabels.map((label, i) => ({
    label,
    searchMobile: charts.searchMobile[i], searchPC: charts.searchPC[i],
    searchTotal: charts.searchMobile[i] + charts.searchPC[i],
    mapMobile: charts.mapMobile[i], mapPC: charts.mapPC[i],
    mapTotal: charts.mapMobile[i] + charts.mapPC[i],
    calls: charts.calls[i], routes: charts.routes[i], websites: charts.websites[i],
    bookings: charts.bookings[i], foodMenus: charts.foodMenus[i],
    totalActions: charts.calls[i] + charts.routes[i] + charts.websites[i] + charts.bookings[i] + charts.foodMenus[i],
  }));

  // ── Page numbering tracker ──
  let pageNum = 1;

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
                  { key: "rankingHistory", label: "順位推移テーブル", hasData: hasRankingHistory },
                  { key: "gridRanking", label: "多地点順位", hasData: hasGridRanking },
                  { key: "searchQueries", label: "検索語句", hasData: hasSearchQueries },
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
                  {keywords.map(kw => (
                    <label key={kw.word} style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                      <input type="checkbox" checked={kwVisibility[kw.word] !== false}
                        onChange={() => toggleKeyword(kw.word)}
                        style={{ width: 14, height: 14, cursor: "pointer" }} />
                      <span style={{ color: "#fff", fontSize: 16 }}>{kw.word}</span>
                    </label>
                  ))}
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
              const allMonths = rankingHistory?.labels || [];
              const allKws = rankingHistory?.datasets?.map(d => d.word) || [];
              const [editMonth, setEditMonth] = [gridEditMonth, setGridEditMonth];
              const [editKw, setEditKw] = [gridEditKw, setGridEditKw];
              const selectedMonth = editMonth || allMonths[allMonths.length - 1] || "";
              const selectedKw = editKw || allKws[0] || "";
              // 現在選択中の月+KWのoverridesグリッドを取得
              const overrideData = gridRanking?.history.find(h => h.month === selectedMonth)?.snapshots.find(s => s.keyword === selectedKw);
              const gridCells = overrideData?.results || [];
              const gridRankColorModal = (rank: number) => {
                if (rank <= 0) return { bg: "rgba(156,163,175,0.3)", color: "#9ca3af" };
                if (rank <= 3) return { bg: "rgba(22,163,74,0.3)", color: "#16a34a" };
                if (rank <= 10) return { bg: "rgba(37,99,235,0.3)", color: "#2563eb" };
                if (rank <= 20) return { bg: "rgba(245,158,11,0.3)", color: "#f59e0b" };
                return { bg: "rgba(239,68,68,0.3)", color: "#ef4444" };
              };
              // 選択中月+KWのcenterRank（P7データから）
              const dsData = rankingHistory?.datasets?.find(d => d.word === selectedKw);
              const monthIdx = allMonths.indexOf(selectedMonth);
              const centerRank = dsData && monthIdx >= 0 ? (dsData.ranks[monthIdx] ?? 0) : 0;

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
                    中心順位: {centerRank > 0 ? `${centerRank}位` : "データなし"}
                  </span>
                </div>
                {/* 生成ボタン */}
                <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                  <button onClick={async () => {
                    if (centerRank <= 0) { alert("この月のキーワード順位データがありません"); return; }
                    setGridGenerating(true);
                    try {
                      await fetch("/api/report/grid-ranking-generate", {
                        method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ shopId, shopName: shop.name, keyword: selectedKw, month: selectedMonth, centerRank }),
                      });
                      window.location.reload();
                    } catch {} finally { setGridGenerating(false); }
                  }} disabled={gridGenerating}
                  style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: gridGenerating ? "#666" : "#0f3460", color: "#fff", fontSize: 16, fontWeight: 600, cursor: "pointer" }}>
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
                        const res = await fetch("/api/report/grid-ranking-generate", {
                          method: "POST", headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ shopName: shop.name, shopId, batch }),
                        });
                        const result = await res.json();
                        alert(`${result.count || 0}件生成（${result.skipped || 0}件は既存データ保持）`);
                        window.location.reload();
                      }
                    } catch {} finally { setGridGenerating(false); }
                  }} disabled={gridGenerating}
                  style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: gridGenerating ? "#666" : "#e94560", color: "#fff", fontSize: 16, fontWeight: 600, cursor: "pointer" }}>
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
                                      await fetch("/api/report/grid-ranking-generate", {
                                        method: "PUT", headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ shopName: shop.name, keyword: selectedKw, month: selectedMonth, row, col, newRank }),
                                      });
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
                    {centerRank > 0 ? "「この月を自動生成」でグリッドを作成してください" : "この月/KWのデータなし"}
                  </div>
                )}
              </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* 指定月データなしバナー */}
      {monthNotFound && (
        <div style={{ background: "#FEF3C7", border: "1px solid #F59E0B", borderRadius: 8, padding: "12px 20px", margin: "0 0 12px", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18 }}>⚠</span>
          <span style={{ fontSize: 16, color: "#92400E" }}>
            <strong>{targetMonth.replace(/(\d{4})\/(\d{1,2})/, "$1年$2月")}</strong>のデータがありません。最新月（{latestMonth.replace(/(\d{4})\/(\d{1,2})/, "$1年$2月")}）のデータを表示しています。レポート管理画面で「全店舗反映」を実行してください。
          </span>
        </div>
      )}

      {/* ════ P1: ヘッダー + KPI ════ */}
      <div style={slideStyle} className="slide">
        <div style={{ background: "linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%)", color: "#fff", padding: "28px 9px 20px", flexShrink: 0, position: "relative" }}>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900, letterSpacing: 1 }}>{shop.name}</h1>
          <div style={{ fontSize: 16, opacity: 0.7, marginTop: 2 }}>MEO対策 レポート報告</div>
          <div style={{ fontSize: 16, opacity: 0.5, marginTop: 6 }}>{shop.address}</div>
          <div style={{ position: "absolute", top: 28, right: 36, background: "rgba(255,255,255,.12)", padding: "7px 18px", borderRadius: 8, fontSize: 16, fontWeight: 600 }}>{shop.period.start} - {shop.period.end}</div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: "10px 9px", background: "#e8eaf0", flexShrink: 0 }}>
          {[{ lb: "対策開始日", vl: shop.startDate }, { lb: "レポート対象", vl: curLabel }, ...(shop.category ? [{ lb: "業種", vl: shop.category }] : []), { lb: "口コミ合計", vl: `${displayTotalReviews.toLocaleString()}件` }, { lb: "評価", vl: String(shop.rating) }].map((b, i) => (
            <div key={i} style={{ background: "#fff", borderRadius: 10, padding: "7px 14px", fontSize: 16, display: "flex", alignItems: "center", gap: 5, boxShadow: "0 1px 3px rgba(0,0,0,.05)" }}>
              <span style={{ color: "#888" }}>{b.lb}</span><span style={{ fontWeight: 700 }}>{b.vl}</span>
            </div>
          ))}
        </div>
        <div style={{ flex: 1, padding: "16px 9px 20px", display: "flex", flexDirection: "column", justifyContent: "stretch", overflow: "hidden" }}>
          <div style={{ ...stitleStyle, marginBottom: 14 }}>主要指標サマリー（{curLabel}）</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, flex: 1 }}>
            {kpis.map((kpi, i) => {
              const isLastKpi = i === kpis.length - 1;
              const mom = kpi.momValue != null ? pctChange(kpi.value, kpi.momValue) : null;
              const yoyC = kpi.yoyValue != null ? pctChange(kpi.value, kpi.yoyValue) : null;
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
                      <><span style={{ marginRight: 6 }}>モバイル: {i === 0 ? charts.searchMobile[charts.searchMobile.length-1]?.toLocaleString() : charts.mapMobile[charts.mapMobile.length-1]?.toLocaleString()}</span><span>PC: {i === 0 ? charts.searchPC[charts.searchPC.length-1]?.toLocaleString() : charts.mapPC[charts.mapPC.length-1]?.toLocaleString()}</span></>
                    ) : (
                      <span>&nbsp;</span>
                    )}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-start" }}>
                    {isLastKpi ? (<>
                      <span style={badgeStyle(kpi.value > 0, kpi.value === 0)}>
                        {kpi.value > 0 ? "▲" : kpi.value === 0 ? "→" : "▼"} {(displayTotalReviews - kpi.value).toLocaleString()}→{displayTotalReviews.toLocaleString()}件 前月比
                      </span>
                      {kpi.yoyValue != null ? (() => {
                        const yoyDelta = displayTotalReviews - kpi.yoyValue!;
                        return <span style={badgeStyle(yoyDelta >= 0)}>
                          {yoyDelta >= 0 ? "▲" : "▼"} {kpi.yoyValue!.toLocaleString()}→{displayTotalReviews.toLocaleString()}件 前年比
                        </span>;
                      })() : <span style={{ fontSize: 16, color: "#bbb" }}>前年比 なし</span>}
                    </>) : (<>
                      {mom && <span style={badgeStyle(mom.isUp, mom.isFlat)}>{arrow(mom)} {mom.text}（{kpi.momValue!.toLocaleString()}→{kpi.value.toLocaleString()}）前月比</span>}
                      {yoyC ? <span style={badgeStyle(yoyC.isUp, yoyC.isFlat)}>{arrow(yoyC)} {yoyC.text}（{kpi.yoyValue!.toLocaleString()}→{kpi.value.toLocaleString()}）前年比</span>
                        : <span style={{ fontSize: 16, color: "#bbb" }}>前年比 なし</span>}
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
        <div style={slideBarStyle}><span>{shop.name} — 月次推移データ</span><span style={{ fontSize: 16, opacity: 0.45, fontWeight: 400 }}>{pn(pageNum)}</span></div>
        <div style={slideBodyStyle}>
          <div style={stitleStyle}>月次推移データ（直近12ヶ月）</div>
          <div style={{ overflow: "hidden", borderRadius: 12, boxShadow: "0 1px 6px rgba(0,0,0,.04)", flex: 1, display: "flex", flexDirection: "column" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", fontSize: 16, flex: 1 }}>
              <thead><tr>
                {["月","検索モバイル","検索PC","検索合計","マップモバイル","マップPC","マップ合計","Web","ルート","通話",
                  ...(hasFoodMenus ? ["メニュー"] : []),
                  ...(hasBookings ? ["予約"] : []),
                  "合計"].map((h,i) => (
                  <th key={i} style={{ background: "#0f3460", color: "#fff", padding: "12px 10px", textAlign: "center", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {[...monthlyTableData].reverse().map((r, i) => {
                  const isLast = i === 0; // 新しい月が先頭
                  return (
                    <tr key={i} style={{ background: isLast ? "#cfffE3" : i % 2 === 1 ? "#eef1f6" : "#fff", fontWeight: isLast ? 600 : undefined }}>
                      <td style={{ padding: "10px 10px", textAlign: "center", borderBottom: "1px solid #ddd", color: "#222" }}>{r.label}</td>
                      <td style={{ padding: "10px 10px", textAlign: "center", borderBottom: "1px solid #ddd", color: "#222" }}>{r.searchMobile.toLocaleString()}</td>
                      <td style={{ padding: "10px 10px", textAlign: "center", borderBottom: "1px solid #ddd", color: "#222" }}>{r.searchPC.toLocaleString()}</td>
                      <td style={{ padding: "10px 10px", textAlign: "center", borderBottom: "1px solid #ddd", color: "#222" }}>{r.searchTotal.toLocaleString()}</td>
                      <td style={{ padding: "10px 10px", textAlign: "center", borderBottom: "1px solid #ddd", color: "#222" }}>{r.mapMobile.toLocaleString()}</td>
                      <td style={{ padding: "10px 10px", textAlign: "center", borderBottom: "1px solid #ddd", color: "#222" }}>{r.mapPC.toLocaleString()}</td>
                      <td style={{ padding: "10px 10px", textAlign: "center", borderBottom: "1px solid #ddd", color: "#222" }}>{r.mapTotal.toLocaleString()}</td>
                      <td style={{ padding: "10px 10px", textAlign: "center", borderBottom: "1px solid #ddd", color: "#222" }}>{r.websites.toLocaleString()}</td>
                      <td style={{ padding: "10px 10px", textAlign: "center", borderBottom: "1px solid #ddd", color: "#222" }}>{r.routes.toLocaleString()}</td>
                      <td style={{ padding: "10px 10px", textAlign: "center", borderBottom: "1px solid #ddd", color: "#222" }}>{r.calls.toLocaleString()}</td>
                      {hasFoodMenus && <td style={{ padding: "10px 10px", textAlign: "center", borderBottom: "1px solid #ddd", color: "#222" }}>{r.foodMenus.toLocaleString()}</td>}
                      {hasBookings && <td style={{ padding: "10px 10px", textAlign: "center", borderBottom: "1px solid #ddd", color: "#222" }}>{r.bookings.toLocaleString()}</td>}
                      <td style={{ padding: "10px 10px", textAlign: "center", borderBottom: "1px solid #ddd", fontWeight: 700, color: "#222" }}>{r.totalActions.toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ════ P3: Google検索数推移 ════ */}
      {(() => { pageNum = 3; return null; })()}
      <div style={slideStyle} className="slide">
        <div style={slideBarStyle}><span>{shop.name} — Google検索数推移</span><span style={{ fontSize: 16, opacity: 0.45, fontWeight: 400 }}>{pn(pageNum)}</span></div>
        <div style={slideBodyStyle}>
          <div style={{ width: "95%", margin: "0 auto" }}>
            <Bar data={{ labels: monthlyLabels, datasets: [
              { label: "モバイル", data: charts.searchMobile, backgroundColor: "rgba(79,195,247,.75)" },
              { label: "PC", data: charts.searchPC, backgroundColor: "rgba(2,136,209,.75)" },
            ]}} options={buildStackedOptions()} />
          </div>
          <table style={{ width: "95%", margin: "8px auto 0", borderCollapse: "collapse", fontSize: 16 }}>
            <tbody>
              <tr style={{ background: "#0f3460" }}>
                <td style={{ padding: "3px 4px", fontWeight: 600, color: "#fff", width: 60, whiteSpace: "nowrap" }}>月</td>
                {monthlyLabels.map((l, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center", color: "#fff", fontWeight: 600 }}>{l.split("/")[1]}月</td>)}
              </tr>
              <tr style={{ background: "#dce3ed" }}><td style={{ padding: "3px 4px", fontWeight: 600, color: "#666", whiteSpace: "nowrap" }}>モバイル</td>
                {charts.searchMobile.map((v, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center" }}>{v.toLocaleString()}</td>)}</tr>
              <tr style={{ background: "#eef1f6" }}><td style={{ padding: "3px 4px", fontWeight: 600, color: "#666", whiteSpace: "nowrap" }}>PC</td>
                {charts.searchPC.map((v, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center" }}>{v.toLocaleString()}</td>)}</tr>
              <tr style={{ background: "#c5d0e0" }}><td style={{ padding: "3px 4px", fontWeight: 700, color: "#333", whiteSpace: "nowrap" }}>合計</td>
                {charts.searchMobile.map((v, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center", fontWeight: 700 }}>{(v + charts.searchPC[i]).toLocaleString()}</td>)}</tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ════ P4: Googleマップ表示数推移 ════ */}
      {(() => { pageNum = 4; return null; })()}
      <div style={slideStyle} className="slide">
        <div style={slideBarStyle}><span>{shop.name} — Googleマップ表示数推移</span><span style={{ fontSize: 16, opacity: 0.45, fontWeight: 400 }}>{pn(pageNum)}</span></div>
        <div style={slideBodyStyle}>
          <div style={{ width: "95%", margin: "0 auto" }}>
            <Bar data={{ labels: monthlyLabels, datasets: [
              { label: "モバイル", data: charts.mapMobile, backgroundColor: "rgba(129,199,132,.75)" },
              { label: "PC", data: charts.mapPC, backgroundColor: "rgba(56,142,60,.75)" },
            ]}} options={buildStackedOptions()} />
          </div>
          <table style={{ width: "95%", margin: "8px auto 0", borderCollapse: "collapse", fontSize: 16 }}>
            <tbody>
              <tr style={{ background: "#0f3460" }}>
                <td style={{ padding: "3px 4px", fontWeight: 600, color: "#fff", width: 60, whiteSpace: "nowrap" }}>月</td>
                {monthlyLabels.map((l, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center", color: "#fff", fontWeight: 600 }}>{l.split("/")[1]}月</td>)}
              </tr>
              <tr style={{ background: "#dce3ed" }}><td style={{ padding: "3px 4px", fontWeight: 600, color: "#666", whiteSpace: "nowrap" }}>モバイル</td>
                {charts.mapMobile.map((v, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center" }}>{v.toLocaleString()}</td>)}</tr>
              <tr style={{ background: "#eef1f6" }}><td style={{ padding: "3px 4px", fontWeight: 600, color: "#666", whiteSpace: "nowrap" }}>PC</td>
                {charts.mapPC.map((v, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center" }}>{v.toLocaleString()}</td>)}</tr>
              <tr style={{ background: "#c5d0e0" }}><td style={{ padding: "3px 4px", fontWeight: 700, color: "#333", whiteSpace: "nowrap" }}>合計</td>
                {charts.mapMobile.map((v, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center", fontWeight: 700 }}>{(v + charts.mapPC[i]).toLocaleString()}</td>)}</tr>
            </tbody>
          </table>
          <div style={{ fontSize: 16, color: "#999", textAlign: "right", margin: "4px 16px 0", fontStyle: "italic" }}>※ 2025年11月以降、Google Business Profile APIの計測仕様変更により数値が大幅に変動する場合があります</div>
        </div>
      </div>

      {/* ════ P5: ユーザー反応数推移 ════ */}
      {(() => { pageNum = 5; return null; })()}
      <div style={slideStyle} className="slide">
        <div style={slideBarStyle}><span>{shop.name} — ユーザー反応数推移</span><span style={{ fontSize: 16, opacity: 0.45, fontWeight: 400 }}>{pn(pageNum)}</span></div>
        <div style={slideBodyStyle}>
          <div style={{ width: "95%", margin: "0 auto" }}>
            <Bar data={{ labels: monthlyLabels, datasets: [
              { label: "ウェブサイト", data: charts.websites, backgroundColor: "rgba(255,183,77,.75)" },
              { label: "ルート", data: charts.routes, backgroundColor: "rgba(186,104,200,.75)" },
              { label: "通話", data: charts.calls, backgroundColor: "rgba(229,115,115,.75)" },
              { label: "メニュー", data: charts.foodMenus, backgroundColor: "rgba(77,182,172,.75)" },
              { label: "予約", data: charts.bookings, backgroundColor: "rgba(121,134,203,.75)" },
            ]}} options={buildStackedOptions()} />
          </div>
          <table style={{ width: "95%", margin: "8px auto 0", borderCollapse: "collapse", fontSize: 16 }}>
            <tbody>
              <tr style={{ background: "#0f3460" }}>
                <td style={{ padding: "3px 4px", fontWeight: 600, color: "#fff", width: 60, whiteSpace: "nowrap" }}>月</td>
                {monthlyLabels.map((l, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center", color: "#fff", fontWeight: 600 }}>{l.split("/")[1]}月</td>)}
              </tr>
              <tr style={{ background: "#dce3ed" }}><td style={{ padding: "3px 4px", fontWeight: 600, color: "#666", whiteSpace: "nowrap" }}>Web</td>
                {charts.websites.map((v, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center" }}>{v.toLocaleString()}</td>)}</tr>
              <tr style={{ background: "#eef1f6" }}><td style={{ padding: "3px 4px", fontWeight: 600, color: "#666", whiteSpace: "nowrap" }}>ルート</td>
                {charts.routes.map((v, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center" }}>{v.toLocaleString()}</td>)}</tr>
              <tr style={{ background: "#dce3ed" }}><td style={{ padding: "3px 4px", fontWeight: 600, color: "#666", whiteSpace: "nowrap" }}>通話</td>
                {charts.calls.map((v, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center" }}>{v.toLocaleString()}</td>)}</tr>
              <tr style={{ background: "#eef1f6" }}><td style={{ padding: "3px 4px", fontWeight: 600, color: "#666", whiteSpace: "nowrap" }}>メニュー</td>
                {charts.foodMenus.map((v, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center" }}>{v.toLocaleString()}</td>)}</tr>
              <tr style={{ background: "#dce3ed" }}><td style={{ padding: "3px 4px", fontWeight: 600, color: "#666", whiteSpace: "nowrap" }}>予約</td>
                {charts.bookings.map((v, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center" }}>{v.toLocaleString()}</td>)}</tr>
              <tr style={{ background: "#c5d0e0" }}><td style={{ padding: "3px 4px", fontWeight: 700, color: "#333", whiteSpace: "nowrap" }}>合計</td>
                {charts.websites.map((v, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center", fontWeight: 700 }}>{(v + charts.routes[i] + charts.calls[i] + charts.foodMenus[i] + charts.bookings[i]).toLocaleString()}</td>)}</tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ════ P7: キーワード順位 (データある場合のみ) ════ */}
      {showKeywords && (() => { pageNum = 6; return (
        <div style={slideStyle} className="slide">
          <div style={slideBarStyle}><span>{shop.name} — キーワード順位変動</span><span style={{ fontSize: 16, opacity: 0.45, fontWeight: 400 }}>{pn(pageNum)}</span></div>
          <div style={slideBodyStyle}>
            <div style={stitleStyle}>キーワード順位変動（{curLabel}）</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, flex: 1 }}>
              {visibleKeywords.map((kw, i) => {
                const diff = kw.prevRank - kw.rank;
                const arrow = diff > 0 ? "↑" : diff < 0 ? "↓" : "→";
                const arrowColor = diff > 0 ? "#0a8f3c" : diff < 0 ? "#c0392b" : "#888";
                return (
                  <div key={i} style={{ background: "#fff", borderRadius: 12, padding: "24px 28px", boxShadow: "0 1px 6px rgba(0,0,0,.04)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>{kw.word}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 16, color: "#999" }}>前月{kw.prevRank}位</span>
                      <span style={{ fontSize: 22, color: arrowColor }}>{arrow}</span>
                      <span style={{ fontSize: 36, fontWeight: 900, color: "#e94560" }}>{kw.rank}</span>
                      <span style={{ fontSize: 16, color: "#666" }}>位</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ); })()}

      {/* ════ P7.5: キーワード順位推移テーブル ════ */}
      {showRankingHistory && (() => { pageNum++; return (
        <div style={slideStyle} className="slide">
          <div style={slideBarStyle}><span>{shop.name} — キーワード順位推移</span><span style={{ fontSize: 16, opacity: 0.45, fontWeight: 400 }}>{pn(pageNum)}</span></div>
          <div style={{ ...slideBodyStyle, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={stitleStyle}>キーワード順位推移（直近{rankingHistory.labels.length}ヶ月）</div>
            <div style={{ overflowX: "auto", borderRadius: 12, boxShadow: "0 1px 6px rgba(0,0,0,.04)", flex: 1, display: "flex", flexDirection: "column" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", flex: 1, minWidth: 700 }}>
                <thead>
                  <tr>
                    <th style={{ background: "#0f3460", color: "#fff", padding: "8px 6px", textAlign: "left", fontWeight: 600, whiteSpace: "nowrap", fontSize: 16, position: "sticky", left: 0 }}>キーワード</th>
                    {rankingHistory.labels.map((l, i) => (
                      <th key={i} style={{ background: i === rankingHistory.labels.length - 1 ? "#e94560" : "#0f3460", color: "#fff", padding: "8px 4px", textAlign: "center", fontWeight: 600, whiteSpace: "nowrap", fontSize: 16 }}>
                        {l}
                      </th>
                    ))}
                    <th style={{ background: "#0f3460", color: "#fff", padding: "8px 4px", textAlign: "center", fontWeight: 600, fontSize: 16 }}>変動</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRankingDatasets.map((ds, di) => {
                    const validRanks = ds.ranks.filter((r): r is number => r !== null);
                    const latest = validRanks.length > 0 ? validRanks[validRanks.length - 1] : null;
                    const prev = validRanks.length > 1 ? validRanks[validRanks.length - 2] : null;
                    const diff = latest !== null && prev !== null ? prev - latest : 0;
                    return (
                      <tr key={di} style={{ background: di % 2 === 0 ? "#fff" : "#f8f9fb" }}>
                        <td style={{ padding: "6px 6px", fontWeight: 700, color: "#333", whiteSpace: "nowrap", borderBottom: "1px solid #eee", fontSize: 16 }}>{ds.word}</td>
                        {ds.ranks.map((r, ri) => {
                          const isLatest = ri === rankingHistory.labels.length - 1;
                          return (
                            <td key={ri} style={{
                              padding: "6px 4px", textAlign: "center", borderBottom: "1px solid #eee", fontSize: 16,
                              fontWeight: r !== null && r <= 3 ? 900 : isLatest ? 700 : 400,
                              color: r === null ? "#ddd" : r <= 3 ? "#0a8f3c" : r <= 5 ? "#0f3460" : r <= 10 ? "#555" : "#999",
                              background: isLatest ? "#fff8f0" : undefined,
                            }}>
                              {r ?? "-"}
                            </td>
                          );
                        })}
                        <td style={{
                          padding: "6px 4px", textAlign: "center", borderBottom: "1px solid #eee", fontSize: 16, fontWeight: 700,
                          color: diff > 0 ? "#0a8f3c" : diff < 0 ? "#c0392b" : "#888",
                        }}>
                          {diff > 0 ? `↑${diff}` : diff < 0 ? `↓${Math.abs(diff)}` : "→"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ); })()}

      {/* ════ 多地点順位計測（画面:1ページタブ切替 / PDF:全KW展開 2KW/ページ） ════ */}
      {showGridRanking && (() => {
        const gr = gridRanking!;
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
        const gridPageBase = pageNum + 1;

        // キーワードを2つずつペアにグループ化（PDF時に1ページ2KW表示用）
        const kwPairs: string[][] = [];
        for (let i = 0; i < gr.keywords.length; i += 2) {
          kwPairs.push(gr.keywords.slice(i, i + 2));
        }

        return kwPairs.map((pair, pairI) => (
          <div key={`grid-pair-${pairI}`} className="grid-kw-pair">
            {pair.map((loopKw, kwInPair) => {
              pageNum++;
              const kwI = pairI * 2 + kwInPair;
              const isActive = kwI === gridKwIdx;
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
                  <span style={{ fontSize: 16, opacity: 0.45, fontWeight: 400 }}>{pn(pageNum)}</span>
                </div>
                <div style={{ ...slideBodyStyle, padding: "20px 9px", gap: 12 }} className="grid-kw-body">
                  {/* KWタブ（画面のみ、全スライドに配置するが表示は1つだけ） */}
                  <div className="no-print" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 16, fontWeight: 700, color: "#0f3460" }}>KW:</span>
                    {gr.keywords.map((kw, i) => (
                      <button key={kw} onClick={() => setGridKwIdx(i)}
                        style={{ padding: "5px 14px", borderRadius: 20, fontSize: 16, fontWeight: 600, border: "none", cursor: "pointer",
                          background: i === gridKwIdx ? "#0f3460" : "#e8edf3",
                          color: i === gridKwIdx ? "#fff" : "#555" }}>
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
                    <div style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }} className="grid-kw-map-area">
                      {snapshot ? (
                        <>
                          <div ref={el => { gridMapRefs.current[loopKw] = el; }} className="grid-map-container" style={{ width: 440, height: 400, borderRadius: 12, overflow: "hidden", boxShadow: "0 2px 12px rgba(0,0,0,.15)", background: "#e8edf5" }} />
                          <div className="grid-kw-legend" style={{ display: "flex", gap: 10, fontSize: 16, color: "#555", marginTop: 2 }}>
                            <span style={{ display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 10, height: 10, borderRadius: "50%", background: "#16A34A", display: "inline-block" }} />1-3位</span>
                            <span style={{ display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 10, height: 10, borderRadius: "50%", background: "#2563EB", display: "inline-block" }} />4-10位</span>
                            <span style={{ display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 10, height: 10, borderRadius: "50%", background: "#F59E0B", display: "inline-block" }} />11-20位</span>
                            <span style={{ display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 10, height: 10, borderRadius: "50%", background: "#EF4444", display: "inline-block" }} />21位~</span>
                            <span style={{ display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 10, height: 10, borderRadius: "50%", background: "#6B7280", display: "inline-block" }} />圏外</span>
                          </div>
                          <div className="grid-kw-avg" style={{ fontSize: 16, color: "#555", textAlign: "center" }}>
                            平均順位: <span style={{ fontSize: 22, fontWeight: 900, color: "#e94560" }}>{snapshot.avgRank}</span>位
                            {prevSnapshot && (() => {
                              const diff = prevSnapshot.avgRank - snapshot.avgRank;
                              return diff !== 0 ? (
                                <span style={{ marginLeft: 8, fontSize: 16, fontWeight: 700, color: diff > 0 ? "#0a8f3c" : "#c0392b" }}>
                                  {diff > 0 ? `↑${diff.toFixed(1)}` : `↓${Math.abs(diff).toFixed(1)}`}
                                </span>
                              ) : null;
                            })()}
                          </div>
                        </>
                      ) : (
                        <div style={{ padding: 40, textAlign: "center" }}>
                          <div style={{ color: "#999", fontSize: 16, marginBottom: 12 }}>この月のデータなし</div>
                          {(() => {
                            const kwData = keywords.find(k => k.word === loopKw);
                            const centerRank = kwData?.rank || 0;
                            return centerRank > 0 ? (
                              <button className="no-print" onClick={async () => {
                                setGridGenerating(true);
                                try {
                                  await fetch("/api/report/grid-ranking-generate", {
                                    method: "POST", headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ shopId: shopId, shopName: shop.name, keyword: loopKw, month: monthData?.month || curLabel, centerRank }),
                                  });
                                  window.location.reload();
                                } catch {} finally { setGridGenerating(false); }
                              }} disabled={gridGenerating}
                              style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: gridGenerating ? "#999" : "#0f3460", color: "#fff", fontSize: 16, fontWeight: 600, cursor: gridGenerating ? "wait" : "pointer" }}>
                                {gridGenerating ? "生成中..." : `「${loopKw}」${centerRank}位からグリッド自動生成`}
                              </button>
                            ) : <div style={{ color: "#bbb", fontSize: 16 }}>キーワード順位データがありません</div>;
                          })()}
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
                                  padding: "12px 6px", textAlign: "center", fontSize: 16, fontWeight: v !== null && v <= 5 ? 900 : 600,
                                  color: v === null ? "#ddd" : v <= 3 ? "#15803d" : v <= 10 ? "#1d4ed8" : v <= 20 ? "#b45309" : "#999",
                                  background: i === activeMonthI ? "#fff8f0" : undefined, borderBottom: "1px solid #eee",
                                }}>
                                  {v !== null ? v : "-"}
                                </td>
                              ))}
                              {(() => {
                                const valid = trendData.filter((v): v is number => v !== null);
                                if (valid.length < 2) return <td style={{ padding: "12px 6px", textAlign: "center", color: "#888", borderBottom: "1px solid #eee" }}>→</td>;
                                const diff = valid[valid.length - 2] - valid[valid.length - 1];
                                return (
                                  <td style={{ padding: "12px 6px", textAlign: "center", fontSize: 16, fontWeight: 700, borderBottom: "1px solid #eee",
                                    color: diff > 0 ? "#0a8f3c" : diff < 0 ? "#c0392b" : "#888" }}>
                                    {diff > 0 ? `↑${diff.toFixed(1)}` : diff < 0 ? `↓${Math.abs(diff).toFixed(1)}` : "→"}
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
                                  <th style={{ background: "#0f3460", color: "#fff", padding: "8px 12px", textAlign: "left", fontSize: 16 }}>キーワード</th>
                                  <th style={{ background: "#0f3460", color: "#fff", padding: "8px 12px", textAlign: "center", fontSize: 16 }}>平均順位</th>
                                  <th style={{ background: "#0f3460", color: "#fff", padding: "8px 12px", textAlign: "center", fontSize: 16 }}>前月比</th>
                                  <th style={{ background: "#0f3460", color: "#fff", padding: "8px 12px", textAlign: "center", fontSize: 16 }}>計測地点</th>
                                </tr>
                              </thead>
                              <tbody>
                                {monthData.snapshots.map((s, si) => {
                                  const ps = prevMonthData?.snapshots.find(p => p.keyword === s.keyword);
                                  const diff = ps ? ps.avgRank - s.avgRank : 0;
                                  return (
                                    <tr key={si} style={{ background: s.keyword === loopKw ? "#fff8f0" : si % 2 === 0 ? "#fff" : "#f8f9fb" }}>
                                      <td style={{ padding: "8px 12px", fontWeight: s.keyword === loopKw ? 700 : 500, fontSize: 16, borderBottom: "1px solid #eee" }}>{s.keyword}</td>
                                      <td style={{ padding: "8px 12px", textAlign: "center", fontSize: 16, fontWeight: 800, borderBottom: "1px solid #eee",
                                        color: s.avgRank <= 3 ? "#15803d" : s.avgRank <= 10 ? "#1d4ed8" : s.avgRank <= 20 ? "#b45309" : "#999" }}>
                                        {s.avgRank}
                                      </td>
                                      <td style={{ padding: "8px 12px", textAlign: "center", fontSize: 16, fontWeight: 700, borderBottom: "1px solid #eee",
                                        color: diff > 0 ? "#0a8f3c" : diff < 0 ? "#c0392b" : "#888" }}>
                                        {ps ? (diff > 0 ? `↑${diff.toFixed(1)}` : diff < 0 ? `↓${Math.abs(diff).toFixed(1)}` : "→") : "-"}
                                      </td>
                                      <td style={{ padding: "8px 12px", textAlign: "center", fontSize: 16, color: "#888", borderBottom: "1px solid #eee" }}>
                                        {s.gridSize}×{s.gridSize}
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
        ));
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
        const yoyTotalDiff = yoyTotalCount !== null ? totalCount - yoyTotalCount : null;
        const hasYoy = sqYoy !== null;
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
        const PER_PAGE = 15;
        const page1 = currentKeywords.slice(0, PER_PAGE);
        const page2 = currentKeywords.slice(PER_PAGE, PER_PAGE * 2);
        const thStyle = (w?: number, groupStart?: boolean): React.CSSProperties => ({ background: "#0f3460", color: "#fff", padding: "6px 4px", textAlign: "center", fontWeight: 600, fontSize: 16, whiteSpace: "nowrap", ...(w ? { width: w } : {}), ...(groupStart ? { borderLeft: "2px solid rgba(255,255,255,0.3)" } : {}) });
        const renderSqTable = (rows: typeof currentKeywords, startIdx: number) => (
          <div style={{ overflow: "hidden", borderRadius: 12, boxShadow: "0 1px 6px rgba(0,0,0,.04)", flex: 1, display: "flex", flexDirection: "column" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", flex: 1 }}>
              <thead>
                <tr>
                  <th style={thStyle(40)}>順位</th>
                  <th style={{ ...thStyle(), textAlign: "left", padding: "10px 12px" }}>検索語句</th>
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
                  const diffStyle = (d: number | null): React.CSSProperties => ({ padding: "4px 2px", textAlign: "center", fontSize: 16, fontWeight: 600, color: d === null ? "#ccc" : d > 0 ? "#0a8f3c" : d < 0 ? "#c0392b" : "#888" });
                  const fmtDiff = (d: number | null) => d === null ? "-" : d > 0 ? `+${d.toLocaleString()}` : d === 0 ? "→" : d.toLocaleString();
                  return (
                    <tr key={`${sqCurrent?.month}-${rank}`} style={{ background: ri % 2 === 0 ? "#fff" : "#f8f9fb", borderBottom: "1px solid #eee" }}>
                      <td style={{ padding: "4px 4px", textAlign: "center", fontSize: 16, fontWeight: 700, color: rank < 3 ? "#e94560" : rank < 10 ? "#0f3460" : "#888" }}>{rank + 1}</td>
                      <td style={{ padding: "4px 6px", fontSize: 16, color: "#333" }}>{kw.word}</td>
                      <td style={{ padding: "4px 4px", textAlign: "center", fontSize: 16, fontWeight: 700, color: "#0f3460" }}>{kw.count.toLocaleString()}</td>
                      {hasPrev && <td style={{ padding: "4px 4px", textAlign: "center", fontSize: 16, color: "#888", borderLeft: "2px solid #e8edf3" }}>{prev !== undefined ? prev.toLocaleString() : "-"}</td>}
                      {hasPrev && <td style={{ ...diffStyle(prevDiff), padding: "4px 2px" }}>{fmtDiff(prevDiff)}</td>}
                      {hasPrev2 && <td style={{ padding: "4px 4px", textAlign: "center", fontSize: 16, color: "#888", borderLeft: "2px solid #e8edf3" }}>{prev2 !== undefined ? prev2.toLocaleString() : "-"}</td>}
                      {hasPrev2 && <td style={{ ...diffStyle(prev2Diff), padding: "4px 2px" }}>{fmtDiff(prev2Diff)}</td>}
                      {hasYoy && <td style={{ padding: "4px 4px", textAlign: "center", fontSize: 16, color: "#888", borderLeft: "2px solid #e8edf3" }}>{yoyVal !== undefined ? yoyVal.toLocaleString() : "-"}</td>}
                      {hasYoy && <td style={{ ...diffStyle(yoyDiff), padding: "4px 2px" }}>{fmtDiff(yoyDiff)}</td>}
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
          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12, padding: "6px 16px 2px", fontSize: 16 }}>
            <span style={{ color: "#555", fontWeight: 500 }}>総検索数: <strong style={{ color: "#0f3460", fontSize: 16 }}>{totalCount.toLocaleString()}</strong></span>
            {totalDiff !== null && (
              <span style={{ fontSize: 16, fontWeight: 600, color: totalDiff > 0 ? "#0a8f3c" : totalDiff < 0 ? "#c0392b" : "#888" }}>
                前月比: {totalDiff > 0 ? `+${totalDiff.toLocaleString()}` : totalDiff === 0 ? "→" : totalDiff.toLocaleString()}
              </span>
            )}
            {yoyTotalDiff !== null && (
              <span style={{ fontSize: 16, fontWeight: 600, color: yoyTotalDiff > 0 ? "#0a8f3c" : yoyTotalDiff < 0 ? "#c0392b" : "#888" }}>
                前年比: {yoyTotalDiff > 0 ? `+${yoyTotalDiff.toLocaleString()}` : yoyTotalDiff === 0 ? "→" : yoyTotalDiff.toLocaleString()}
              </span>
            )}
          </div>
        );
        return (<>
        {/* 検索語句 ページ1 (1-15位) */}
        <div style={slideStyle} className="slide">
          <div style={slideBarStyle}>
            <span>{shop.name} — 検索語句</span>
            {sqNavBar}
            <span style={{ fontSize: 16, opacity: 0.45, fontWeight: 400 }}>{pn(pageNum)}</span>
          </div>
          <div style={{ ...slideBodyStyle, padding: "10px 9px", display: "flex", flexDirection: "column" }}>
            <div style={stitleStyle}>検索語句ランキング（{sqCurrent?.month || ""}）1〜{Math.min(PER_PAGE, currentKeywords.length)}位</div>
            {sqSummary}
            {renderSqTable(page1, 0)}
          </div>
        </div>
        {/* 検索語句 ページ2 (16-30位) */}
        {page2.length > 0 && (() => { pageNum++; return (
        <div style={slideStyle} className="slide">
          <div style={slideBarStyle}>
            <span>{shop.name} — 検索語句</span>
            {sqNavBar}
            <span style={{ fontSize: 16, opacity: 0.45, fontWeight: 400 }}>{pn(pageNum)}</span>
          </div>
          <div style={{ ...slideBodyStyle, display: "flex", flexDirection: "column" }}>
            <div style={stitleStyle}>検索語句ランキング（{sqCurrent?.month || ""}）{PER_PAGE + 1}〜{Math.min(PER_PAGE * 2, currentKeywords.length)}位</div>
            {renderSqTable(page2, PER_PAGE)}
          </div>
        </div>
        ); })()}
        </>);
      })()}

      {/* ════ P8: 口コミ件数推移 ════ */}
      {(() => { pageNum++; return null; })()}
      {hasReviews && (
        <div style={slideStyle} className="slide">
          <div style={slideBarStyle}><span>{shop.name} — 口コミ件数推移</span><span style={{ fontSize: 16, opacity: 0.45, fontWeight: 400 }}>{pn(pageNum)}</span></div>
          <div style={{ ...slideBodyStyle, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: "95%", maxHeight: 600 }}>
              <Line data={{ labels: reviewLabels, datasets: [{
                label: "口コミ件数", data: reviewCounts,
                borderColor: "#fbc02d", backgroundColor: "rgba(251,192,45,.15)",
                fill: true, tension: 0.3, pointRadius: 4, pointBackgroundColor: "#fbc02d", borderWidth: 2,
              }]}} options={{ ...lineOptions, scales: { ...lineOptions.scales, y: { ...lineOptions.scales.y, ticks: { ...lineOptions.scales.y.ticks, stepSize: 1, callback: (v: any) => Number.isInteger(Number(v)) ? Number(v).toLocaleString() : "" } } } }} />
            </div>
            <table style={{ width: "95%", margin: "8px auto 0", borderCollapse: "collapse", fontSize: 16 }}>
              <tbody>
                <tr style={{ background: "#f8f9fa" }}>
                  <td style={{ padding: "3px 4px", fontWeight: 600, color: "#666", width: 60, whiteSpace: "nowrap" }}>月</td>
                  {reviewLabels.map((l, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center", color: "#888" }}>{l.split("/")[1]}月</td>)}
                </tr>
                <tr>
                  <td style={{ padding: "3px 4px", fontWeight: 700, color: "#333" }}>件数</td>
                  {reviewCounts.map((v, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center", fontWeight: 700 }}>{v.toLocaleString()}</td>)}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ════ P9: 月間口コミ増加数 ════ */}
      {(() => { pageNum++; return null; })()}
      {hasReviews && (
        <div style={slideStyle} className="slide">
          <div style={slideBarStyle}><span>{shop.name} — 月間口コミ増加数</span><span style={{ fontSize: 16, opacity: 0.45, fontWeight: 400 }}>{pn(pageNum)}</span></div>
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
            <table style={{ width: "95%", margin: "8px auto 0", borderCollapse: "collapse", fontSize: 16 }}>
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
          </div>
        </div>
      )}

      {/* ════ P10: 口コミ分析 ════ */}
      {(() => { pageNum++; return null; })()}
      <div style={slideStyle} className="slide">
        <div style={slideBarStyle}><span>{shop.name} — AIによる口コミ分析</span><span style={{ fontSize: 16, opacity: 0.45, fontWeight: 400 }}>{pn(pageNum)}</span></div>
        <div style={slideBodyStyle}>
          <div style={stitleStyle}>口コミ分析（直近1年）</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "auto 1fr", gap: 16, flex: 1 }}>
            <div style={{ background: "#fff", borderRadius: 12, padding: "24px 28px", boxShadow: "0 1px 6px rgba(0,0,0,.04)", display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: "#27ae60", marginBottom: 14 }}>ポジティブワード（推定）</h3>
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
              <p style={{ fontSize: 16, color: "#aaa", marginTop: 8, margin: "8px 0 0" }}>※ クリックで該当する口コミを表示します</p>
            </div>
            <div style={{ background: "#fff", borderRadius: 12, padding: "24px 28px", boxShadow: "0 1px 6px rgba(0,0,0,.04)", display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: "#c0392b", marginBottom: 14 }}>ネガティブワード（推定）</h3>
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
              <p style={{ fontSize: 16, color: "#aaa", marginTop: 8, margin: "8px 0 0" }}>※ クリックで該当する口コミを表示します</p>
            </div>
            <div style={{ background: "#fff", borderRadius: 12, padding: "24px 28px", boxShadow: "0 1px 6px rgba(0,0,0,.04)", gridColumn: "1/-1", display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>口コミ総評</h3>
              <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 32, color: "#fbc02d" }}>{"★".repeat(Math.round(shop.rating))}{"☆".repeat(5 - Math.round(shop.rating))}</div>
                  <span style={{ fontSize: 56, fontWeight: 900, color: "#0f3460" }}>{shop.rating}</span>
                  <span style={{ fontSize: 16, color: "#888", marginLeft: 8 }}>/ 5.0（{displayTotalReviews.toLocaleString()}件）</span>
                </div>
              </div>
              <p style={{ fontSize: 16, lineHeight: 1.9, color: "#444", margin: 0 }} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(reviewAnalysis.summary, { ALLOWED_TAGS: ["strong", "em", "br"] }) }} />
            </div>
          </div>
        </div>
      </div>

      {/* ════ AIコメント: 動的ページ分割（表示月と分析対象月が一致する場合のみ表示） ════ */}
      {(() => {
        // 分析対象月と表示月の一致チェック
        const analysisMonth = trimmedData.analysisTargetMonth;
        const displayMonth = monthlyLabels[monthlyLabels.length - 1] || curLabel;
        if (analysisMonth && analysisMonth !== displayMonth) {
          pageNum++;
          return (
            <div style={slideStyle} className="slide">
              <div style={slideBarStyle}><span>{shop.name} — AIによるコメント</span><span style={{ fontSize: 16, opacity: 0.45, fontWeight: 400 }}>{pn(pageNum)}</span></div>
              <div style={slideBodyStyle}>
                <div style={stitleStyle}>AIによるコメント</div>
                <div style={{ background: "#f8f9fa", border: "1px solid #dee2e6", borderRadius: 12, padding: "40px 32px", textAlign: "center" }}>
                  <p style={{ fontSize: 16, color: "#666", marginBottom: 8 }}>この月（{displayMonth}）のAI総評はまだ生成されていません。</p>
                  <p style={{ fontSize: 16, color: "#999" }}>最新の分析は {analysisMonth} のデータに基づいています。</p>
                </div>
              </div>
            </div>
          );
        }
        // コメントを文字数ベースでページ分割（はみ出し防止）
        const allComments = comments || [];
        const commentPages: { start: number; end: number }[] = [];
        const CHARS_FIRST_PAGE = 750; // 最初のページ（ヘッダー分少ない）
        const CHARS_PER_PAGE = 850;   // 2ページ目以降
        {
          let ci = 0;
          while (ci < allComments.length) {
            const limit = commentPages.length === 0 ? CHARS_FIRST_PAGE : CHARS_PER_PAGE;
            let charCount = 0;
            let end = ci;
            while (end < allComments.length) {
              const len = (allComments[end] || "").replace(/<[^>]*>/g, "").length;
              if (end > ci && charCount + len > limit) break; // 次のコメントを追加すると超過 → 手前で切る（ただし最低1件は入れる）
              charCount += len;
              end++;
            }
            commentPages.push({ start: ci, end });
            ci = end;
          }
        }
        if (commentPages.length === 0) commentPages.push({ start: 0, end: 0 });

        return commentPages.map((page, pageIdx) => {
          pageNum++;
          const isFirst = pageIdx === 0;
          const isLast = pageIdx === commentPages.length - 1;
          const pageLabel = commentPages.length > 1 ? `（${pageIdx + 1}/${commentPages.length}）` : "";

          return (
      <div key={`ai-comment-${pageIdx}`} style={slideStyle} className="slide">
        <div style={slideBarStyle}><span>{shop.name} — AIによるコメント{pageLabel}</span><span style={{ fontSize: 16, opacity: 0.45, fontWeight: 400 }}>{pn(pageNum)}</span></div>
        <div style={slideBodyStyle}>
          <div style={stitleStyle}>{isFirst ? "AIによるコメント" : "AIによるコメント（続き）"}</div>
          <div style={{ background: "linear-gradient(135deg,#f0f4ff,#fff)", border: "2px solid #0f3460", borderRadius: 14, padding: "16px 20px", flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", wordBreak: "break-word" }}>
            {isFirst && <h3 style={{ fontSize: 16, fontWeight: 700, color: "#0f3460", marginBottom: 16 }}>{curLabel} 総評</h3>}
            <div style={{ margin: 0 }}>
              {allComments.slice(page.start, page.end).map((c, i) => {
                const globalIdx = page.start + i;
                let fixedComment = c;
                if (shop.rating > 0) {
                  fixedComment = fixedComment.replace(/\d\.\d(\s*\/\s*5\.0)/g, `${shop.rating}$1`);
                }
                fixedComment = fixedComment.replace(/([^（(])([①②③④⑤⑥⑦⑧⑨⑩])/g, "$1<br>$2");
                fixedComment = fixedComment.replace(/(.)\s*(\(\d+\))/g, "$1<br>$2");
                return (
                <p key={globalIdx} style={{ fontSize: 17, lineHeight: 2, color: "#444", margin: "0 0 16px 0" }}>
                  <span style={{ fontWeight: 700, color: "#0f3460", marginRight: 8 }}>{"①②③④⑤⑥⑦⑧⑨⑩"[globalIdx] || `${globalIdx + 1}.`}</span>
                  <span dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(fixedComment, { ALLOWED_TAGS: ["strong", "em", "br"] }) }} />
                </p>
                );
              })}
            </div>
            {/* メモ欄（最終ページのみ） */}
            {isLast && (
            <div style={{ marginTop: "auto", borderTop: "1px solid #dde", paddingTop: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 16, fontWeight: 600, color: "#0f3460" }}>メモ（担当者用）</span>
                <div style={{ display: "flex", gap: 6 }}>
                  {!memoEditing ? (
                    <button onClick={() => setMemoEditing(true)} style={{ fontSize: 16, padding: "3px 10px", borderRadius: 6, border: "1px solid #ccd", background: "#fff", cursor: "pointer", color: "#555" }}>
                      {memo ? "編集" : "追加"}
                    </button>
                  ) : (
                    <>
                      <button onClick={saveMemo} disabled={memoLoading} style={{ fontSize: 16, padding: "3px 10px", borderRadius: 6, border: "none", background: memoLoading ? "#999" : "#0f3460", color: "#fff", cursor: memoLoading ? "wait" : "pointer" }}>{memoLoading ? "保存中..." : "保存"}</button>
                      <button onClick={() => setMemoEditing(false)} style={{ fontSize: 16, padding: "3px 10px", borderRadius: 6, border: "1px solid #ccd", background: "#fff", cursor: "pointer", color: "#555" }}>キャンセル</button>
                    </>
                  )}
                  {memoSaved && <span style={{ fontSize: 16, color: "#0a8f3c" }}>保存しました</span>}
                </div>
              </div>
              {memoEditing ? (
                <textarea value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="この店舗への所感やメモを記入..."
                  style={{ width: "100%", minHeight: 60, padding: "8px 10px", fontSize: 16, lineHeight: 1.6, border: "1px solid #ccd", borderRadius: 8, resize: "vertical", fontFamily: "inherit" }} />
              ) : memo ? (
                <p style={{ fontSize: 16, lineHeight: 1.8, color: "#444", margin: 0, whiteSpace: "pre-wrap" }}>{memo}</p>
              ) : (
                <p style={{ fontSize: 16, color: "#aaa", margin: 0, fontStyle: "italic" }}>メモなし</p>
              )}
            </div>
            )}
          </div>
        </div>
      </div>
          );
        });
      })()}

      {/* ════ 口コミ言語別分析 ════ */}
      {langStats.length > 1 && (() => { pageNum++; return (
        <div style={slideStyle} className="slide">
          <div style={slideBarStyle}><span>{shop.name} — 口コミ言語別分析</span><span style={{ fontSize: 16, opacity: 0.45, fontWeight: 400 }}>{pn(pageNum)}</span></div>
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
              <p style={{ color: "#999", textAlign: "center", padding: 20 }}>該当する口コミが見つかりませんでした。口コミデータの同期が完了していない可能性があります。</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
