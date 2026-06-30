"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

// ── 型定義 ──
type CampaignRow = {
  language: string;
  campaignName: string;
  campaignId: string;
  month?: string;
  date?: string;
  impressions: number;
  clicks: number;
  ctr: number;
  averageCpc: number;
  costMicros: number;
};

type GbpRow = {
  month: string;
  shopName: string;
  totalImpressions: number;
  totalVisits: number;
  phone: number;
  directions: number;
  website: number;
  menuClicks: number;
  saveShare: number;
};

// ── 定数 ──
const SLIDE_W = 1123;
const SLIDE_H = 794;

const chartColors = [
  "rgba(79,195,247,.75)", "rgba(129,199,132,.75)", "rgba(255,183,77,.75)",
  "rgba(186,104,200,.75)", "rgba(231,115,115,.75)", "rgba(77,182,172,.75)",
];
const chartBorderColors = [
  "rgba(2,136,209,1)", "rgba(56,142,60,1)", "rgba(245,124,0,1)",
  "rgba(123,31,162,1)", "rgba(211,47,47,1)", "rgba(0,137,123,1)",
];
const kpiTopColors = [
  "linear-gradient(90deg,#4fc3f7,#0288d1)", "linear-gradient(90deg,#81c784,#388e3c)",
  "linear-gradient(90deg,#ffb74d,#f57c00)", "linear-gradient(90deg,#ba68c8,#7b1fa2)",
  "linear-gradient(90deg,#e57373,#d32f2f)", "linear-gradient(90deg,#4db6ac,#00897b)",
  "linear-gradient(90deg,#90a4ae,#546e7a)", "linear-gradient(90deg,#fff176,#f9a825)",
  "linear-gradient(90deg,#f48fb1,#c2185b)", "linear-gradient(90deg,#a1887f,#5d4037)",
];

// ── スタイル ──
const slideStyle: React.CSSProperties = {
  width: SLIDE_W, minHeight: SLIDE_H, margin: "20px auto", background: "#f0f2f5",
  borderRadius: 8, overflow: "hidden", boxShadow: "0 8px 40px rgba(0,0,0,.4)",
  display: "flex", flexDirection: "column", pageBreakAfter: "always", pageBreakInside: "avoid",
};
const slideBarStyle: React.CSSProperties = {
  background: "linear-gradient(135deg,#1a1a2e,#0f3460)", color: "#fff",
  padding: "12px 36px", fontSize: 16, fontWeight: 700, display: "flex",
  justifyContent: "space-between", alignItems: "center", flexShrink: 0,
};
const slideBodyStyle: React.CSSProperties = {
  flex: 1, padding: "28px 36px", display: "flex", flexDirection: "column",
  justifyContent: "center", overflow: "hidden",
};
const stitleStyle: React.CSSProperties = {
  fontSize: 17, fontWeight: 700, color: "#0f3460",
  borderLeft: "4px solid #e94560", paddingLeft: 12, marginBottom: 16,
};

// ── ユーティリティ ──
const formatCost = (micros: number) => `¥${Math.round(micros / 1_000_000).toLocaleString()}`;
const formatCpc = (micros: number) => `¥${(micros / 1_000_000).toFixed(1)}`;
const formatCtr = (ctr: number) => `${(ctr * 100).toFixed(2)}%`;
const formatMonthShort = (m: string) => { if (!m) return ""; const d = new Date(m); return `${d.getMonth() + 1}月`; };
const formatDate = (d: string) => d ? d.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$2/$3") : "";
const formatNum = (n: number) => n.toLocaleString();

function getDateRange(year: number, month: number, monthsBack: number) {
  // 対象月の末日を終了日にする
  const end = new Date(year, month, 0); // month is 1-based, so this gives last day of target month
  const start = new Date(year, month - 1 - monthsBack, 1);
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  return { startDate: fmt(start), endDate: fmt(end) };
}

// ── 比較バッジコンポーネント ──
function ComparisonBadge({ current, previous, label, format }: { current: number; previous: number; label: string; format?: (v: number) => string }) {
  const fmt = format || ((v: number) => v.toLocaleString());
  if (previous === 0 && current === 0) {
    return <div style={{ fontSize: 11, color: "#888", lineHeight: 1.5 }}>→ 0.0%（{fmt(previous)}→{fmt(current)}）{label}</div>;
  }
  if (previous === 0) {
    return <div style={{ fontSize: 11, color: "#0a8f3c", lineHeight: 1.5 }}>▲ NEW {label}</div>;
  }
  const pct = ((current - previous) / previous) * 100;
  const isUp = pct > 0;
  const isFlat = Math.abs(pct) < 0.5;
  const arrow = isFlat ? "→" : isUp ? "▲" : "▼";
  const color = isFlat ? "#888" : isUp ? "#0a8f3c" : "#c0392b";
  return (
    <div style={{ fontSize: 11, color, lineHeight: 1.5 }}>
      {arrow} {isFlat ? "0.0" : (isUp ? "+" : "") + pct.toFixed(1)}%（{fmt(previous)}→{fmt(current)}）{label}
    </div>
  );
}

// ── メインコンポーネント ──
export default function PmaxStoreDetailPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#1a1a2e" }}>
        <div style={{ textAlign: "center", color: "#fff" }}>
          <div style={{ width: 40, height: 40, border: "3px solid rgba(255,255,255,.3)", borderTopColor: "#e94560", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto" }} />
          <p style={{ marginTop: 16, fontSize: 14, opacity: 0.7 }}>読み込み中...</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
      </div>
    }>
      <StoreDetailContent />
    </Suspense>
  );
}

function StoreDetailContent() {
  const searchParams = useSearchParams();
  const shopName = searchParams.get("name") || "";
  const paramYear = searchParams.get("year");
  const paramMonth = searchParams.get("month");
  const router = useRouter();

  const [monthly, setMonthly] = useState<CampaignRow[]>([]);
  const [daily, setDaily] = useState<CampaignRow[]>([]);
  const [gbpRows, setGbpRows] = useState<GbpRow[]>([]);
  const [summaryText, setSummaryText] = useState("");
  const [summaryRequested, setSummaryRequested] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // URLパラメータの年月を優先、なければ現在月
  const [now] = useState(() => new Date());
  const targetYear = paramYear ? Number(paramYear) : now.getFullYear();
  const targetMonthNum = paramMonth ? Number(paramMonth) : now.getMonth() + 1;

  useEffect(() => {
    if (!shopName) { setLoading(false); setError("店舗名が指定されていません"); return; }
    (async () => {
      setLoading(true); setError("");
      try {
        const token = (await supabase.auth.getSession()).data.session?.access_token;
        const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
        const { startDate, endDate } = getDateRange(targetYear, targetMonthNum, 13);
        const [adsRes, gbpRes] = await Promise.all([
          fetch(`/api/pmax/store-detail?shopName=${encodeURIComponent(shopName)}&startDate=${startDate}&endDate=${endDate}`, { headers }),
          fetch(`/api/pmax/gbp?shopName=${encodeURIComponent(shopName)}`, { headers }),
        ]);
        if (!adsRes.ok) {
          const text = await adsRes.text().catch(() => "");
          throw new Error(`広告データ取得失敗 (${adsRes.status})${text ? ": " + text.slice(0, 100) : ""}`);
        }
        const adsData = await adsRes.json();
        if (adsData.error) throw new Error(adsData.error);
        setMonthly(adsData.monthly || []);
        setDaily(adsData.daily || []);
        if (gbpRes.ok) {
          const gbpData = await gbpRes.json();
          setGbpRows(gbpData.data || []);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "取得に失敗しました");
      } finally { setLoading(false); }
    })();
  }, [shopName, targetYear, targetMonthNum]);

  // KPIデータが揃ったらAI文章を1回だけ生成（C2修正: summaryRequestedで制御）
  useEffect(() => {
    if (monthly.length === 0 || summaryRequested) return;
    setSummaryRequested(true);
    (async () => {
      try {
        const token = (await supabase.auth.getSession()).data.session?.access_token;
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token) headers.Authorization = `Bearer ${token}`;

        const curKey = `${targetYear}-${String(targetMonthNum).padStart(2, "0")}`;
        const prevD = new Date(targetYear, targetMonthNum - 2, 1);
        const prevKey = `${prevD.getFullYear()}-${String(prevD.getMonth() + 1).padStart(2, "0")}`;

        const sumMonth = (key: string) => {
          const rows = monthly.filter(r => (r.month || "").startsWith(key));
          const imp = rows.reduce((s, r) => s + r.impressions, 0);
          const clk = rows.reduce((s, r) => s + r.clicks, 0);
          const cost = rows.reduce((s, r) => s + r.costMicros, 0);
          return { imp, clk, cost, ctr: imp > 0 ? clk / imp : 0, cpc: clk > 0 ? cost / clk : 0 };
        };
        const cur = sumMonth(curKey);
        const prev = sumMonth(prevKey);

        const gbpCurKey = `${targetYear}/${String(targetMonthNum).padStart(2, "0")}`;
        const gbpPrevKey = `${prevD.getFullYear()}/${String(prevD.getMonth() + 1).padStart(2, "0")}`;
        const gbpCur = gbpRows.find(r => r.month === gbpCurKey);
        const gbpPrv = gbpRows.find(r => r.month === gbpPrevKey);

        const body = {
          currentMonth: `${targetYear}年${targetMonthNum}月`,
          impressions: { current: cur.imp, prev: prev.imp },
          clicks: { current: cur.clk, prev: prev.clk },
          cost: { current: cur.cost, prev: prev.cost },
          ctr: { current: cur.ctr, prev: prev.ctr },
          totalVisits: { current: gbpCur?.totalVisits ?? 0, prev: gbpPrv?.totalVisits ?? 0 },
          phone: { current: gbpCur?.phone ?? 0, prev: gbpPrv?.phone ?? 0 },
          directions: { current: gbpCur?.directions ?? 0, prev: gbpPrv?.directions ?? 0 },
          menuClicks: { current: gbpCur?.menuClicks ?? 0, prev: gbpPrv?.menuClicks ?? 0 },
          website: { current: gbpCur?.website ?? 0, prev: gbpPrv?.website ?? 0 },
          saveShare: { current: gbpCur?.saveShare ?? 0, prev: gbpPrv?.saveShare ?? 0 },
        };

        const res = await fetch("/api/pmax/summary-text", { method: "POST", headers, body: JSON.stringify(body) });
        if (res.ok) {
          const data = await res.json();
          if (data.text) setSummaryText(data.text);
        }
      } catch {
        // 文章生成失敗は無視（レポート表示には影響しない）
      }
    })();
  }, [monthly, gbpRows, summaryRequested, targetYear, targetMonthNum]);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#1a1a2e" }}>
        <div style={{ textAlign: "center", color: "#fff" }}>
          <div style={{ width: 40, height: 40, border: "3px solid rgba(255,255,255,.3)", borderTopColor: "#e94560", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto" }} />
          <p style={{ marginTop: 16, fontSize: 14, opacity: 0.7 }}>店舗データを取得中...</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#1a1a2e", padding: 24 }}>
        <div style={{ background: "#fff", borderRadius: 12, padding: 32, maxWidth: 500, width: "100%" }}>
          <h2 style={{ color: "#c0392b", fontSize: 18, fontWeight: 700, marginBottom: 8 }}>エラー</h2>
          <p style={{ color: "#666", fontSize: 14 }}>{error}</p>
          <button onClick={() => router.push("/pmax")} style={{ marginTop: 16, padding: "8px 20px", background: "#0f3460", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14 }}>戻る</button>
        </div>
      </div>
    );
  }

  // ── データ集計（URLパラメータの年月を使用） ──
  const currentMonthKey = `${targetYear}-${String(targetMonthNum).padStart(2, "0")}`;
  const prevMonthDate = new Date(targetYear, targetMonthNum - 2, 1);
  const prevMonthKey = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, "0")}`;
  const lastYearMonthKey = `${targetYear - 1}-${String(targetMonthNum).padStart(2, "0")}`;

  const currentMonth = `${targetYear}/${targetMonthNum}`;
  const periodStart = `${targetYear}/${String(targetMonthNum).padStart(2, "0")}/01`;
  const periodEnd = `${targetYear}/${String(targetMonthNum).padStart(2, "0")}/${new Date(targetYear, targetMonthNum, 0).getDate()}`;

  // 言語でグループ化（monthly+daily両方から抽出）
  const languages = Array.from(new Set([...monthly.map(r => r.language), ...daily.map(r => r.language)])).sort();
  const monthlyByLang: Record<string, CampaignRow[]> = {};
  const dailyByLang: Record<string, CampaignRow[]> = {};
  for (const lang of languages) {
    monthlyByLang[lang] = monthly.filter(r => r.language === lang).sort((a, b) => (a.month || "").localeCompare(b.month || ""));
    // 日次: 対象月を優先、なければ最新月にフォールバック
    const langDaily = daily.filter(r => r.language === lang).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    const targetMonthDaily = langDaily.filter(r => (r.date || "").startsWith(currentMonthKey));
    if (targetMonthDaily.length > 0) {
      dailyByLang[lang] = targetMonthDaily;
    } else if (langDaily.length > 0) {
      // 最新月のデータのみ取得
      const latestDate = langDaily[langDaily.length - 1].date || "";
      const latestMonthKey = latestDate.slice(0, 7); // "YYYY-MM"
      dailyByLang[lang] = langDaily.filter(r => (r.date || "").startsWith(latestMonthKey));
    } else {
      dailyByLang[lang] = [];
    }
  }

  // 広告データ: 月別合計（全言語）
  function getAdsMonthTotal(monthKey: string) {
    const rows = monthly.filter(r => (r.month || "").startsWith(monthKey));
    return {
      impressions: rows.reduce((s, r) => s + r.impressions, 0),
      clicks: rows.reduce((s, r) => s + r.clicks, 0),
      costMicros: rows.reduce((s, r) => s + r.costMicros, 0),
      ctr: 0, averageCpc: 0,
    };
  }
  const adsCurrent = getAdsMonthTotal(currentMonthKey);
  adsCurrent.ctr = adsCurrent.impressions > 0 ? adsCurrent.clicks / adsCurrent.impressions : 0;
  adsCurrent.averageCpc = adsCurrent.clicks > 0 ? adsCurrent.costMicros / adsCurrent.clicks : 0;
  const adsPrev = getAdsMonthTotal(prevMonthKey);
  adsPrev.ctr = adsPrev.impressions > 0 ? adsPrev.clicks / adsPrev.impressions : 0;
  adsPrev.averageCpc = adsPrev.clicks > 0 ? adsPrev.costMicros / adsPrev.clicks : 0;
  const adsLastYear = getAdsMonthTotal(lastYearMonthKey);
  const hasYearData = adsLastYear.impressions > 0 || adsLastYear.clicks > 0 || adsLastYear.costMicros > 0;

  // GBPデータ
  const gbpCurrentKey = `${targetYear}/${String(targetMonthNum).padStart(2, "0")}`;
  const gbpPrevKey = `${prevMonthDate.getFullYear()}/${String(prevMonthDate.getMonth() + 1).padStart(2, "0")}`;
  const gbpLastYearKey = `${targetYear - 1}/${String(targetMonthNum).padStart(2, "0")}`;
  const gbpCurrent = gbpRows.find(r => r.month === gbpCurrentKey);
  const gbpPrev = gbpRows.find(r => r.month === gbpPrevKey);
  const gbpLastYear = gbpRows.find(r => r.month === gbpLastYearKey);
  const hasGbpYearData = !!gbpLastYear;

  const prevMonthLabel = `${prevMonthDate.getMonth() + 1}月`;
  const currentMonthLabel = `${targetMonthNum}月`;

  // ページ数計算: P1(KPI) + 言語別(月次+日次) + 最終ページ(まとめ、表示時のみ)
  const hasSummary = summaryText.length > 0;
  const totalPages = 1 + languages.length + (hasSummary ? 1 : 0);

  // KPIカード
  const kpiCards = [
    { label: "総表示回数", value: adsCurrent.impressions, format: formatNum, prev: adsPrev.impressions, lastYear: hasYearData ? adsLastYear.impressions : null },
    { label: "総クリック", value: adsCurrent.clicks, format: formatNum, prev: adsPrev.clicks, lastYear: hasYearData ? adsLastYear.clicks : null },
    { label: "総広告費", value: adsCurrent.costMicros, format: formatCost, prev: adsPrev.costMicros, lastYear: hasYearData ? adsLastYear.costMicros : null },
    { label: "合計来店数", value: gbpCurrent?.totalVisits ?? 0, format: formatNum, prev: gbpPrev?.totalVisits ?? 0, lastYear: hasGbpYearData ? (gbpLastYear?.totalVisits ?? 0) : null },
    { label: "電話", value: gbpCurrent?.phone ?? 0, format: formatNum, prev: gbpPrev?.phone ?? 0, lastYear: hasGbpYearData ? (gbpLastYear?.phone ?? 0) : null },
    { label: "経路案内", value: gbpCurrent?.directions ?? 0, format: formatNum, prev: gbpPrev?.directions ?? 0, lastYear: hasGbpYearData ? (gbpLastYear?.directions ?? 0) : null },
    { label: "メニュークリック", value: gbpCurrent?.menuClicks ?? 0, format: formatNum, prev: gbpPrev?.menuClicks ?? 0, lastYear: hasGbpYearData ? (gbpLastYear?.menuClicks ?? 0) : null },
    { label: "予約", value: 0, format: formatNum, prev: 0, lastYear: null },
    { label: "WEBサイト", value: gbpCurrent?.website ?? 0, format: formatNum, prev: gbpPrev?.website ?? 0, lastYear: hasGbpYearData ? (gbpLastYear?.website ?? 0) : null },
    { label: "保存・共有", value: gbpCurrent?.saveShare ?? 0, format: formatNum, prev: gbpPrev?.saveShare ?? 0, lastYear: hasGbpYearData ? (gbpLastYear?.saveShare ?? 0) : null },
  ];

  return (
    <div style={{ background: "#1a1a2e", minHeight: "100vh", paddingBottom: 40 }}>
      {/* トップバー */}
      <div className="no-print" style={{ background: "rgba(0,0,0,0.3)", padding: "12px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100, backdropFilter: "blur(10px)" }}>
        <button onClick={() => router.push("/pmax")} style={{ color: "rgba(255,255,255,0.8)", background: "none", border: "none", cursor: "pointer", fontSize: 14 }}>← 店舗一覧に戻る</button>
        <span style={{ fontSize: 12, color: "#4fc3f7", background: "rgba(79,195,247,0.15)", padding: "4px 12px", borderRadius: 20, border: "1px solid rgba(79,195,247,0.3)" }}>P-MAX広告レポート</span>
      </div>

      {/* ===== P1: KPIサマリー ===== */}
      <div style={slideStyle}>
        <div style={{ background: "linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%)", color: "#fff", padding: "28px 36px 20px", flexShrink: 0, position: "relative" }}>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900, letterSpacing: 1 }}>{shopName}</h1>
          <div style={{ fontSize: 13, opacity: 0.7, marginTop: 2 }}>P-MAX広告 レポート報告</div>
          <div style={{ position: "absolute", top: 28, right: 36, background: "rgba(255,255,255,.12)", padding: "7px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600 }}>{periodStart} - {periodEnd}</div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: "10px 36px", background: "#e8eaf0", flexShrink: 0 }}>
          {[{ label: "レポート対象", value: currentMonth }, { label: "広告タイプ", value: "P-MAX" }, { label: "言語数", value: String(languages.length) }].map((tag) => (
            <div key={tag.label} style={{ background: "#fff", borderRadius: 10, padding: "7px 14px", fontSize: 12, display: "flex", alignItems: "center", gap: 5, boxShadow: "0 1px 3px rgba(0,0,0,.05)" }}>
              <span style={{ color: "#888" }}>{tag.label}</span>
              <span style={{ fontWeight: 700 }}>{tag.value}</span>
            </div>
          ))}
        </div>
        <div style={{ flex: 1, padding: "20px 36px", overflow: "hidden" }}>
          <div style={stitleStyle}>主要指標サマリー（{currentMonth}）</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 14 }}>
            {kpiCards.slice(0, 3).map((kpi, i) => <KpiCard key={kpi.label} kpi={kpi} colorIdx={i} />)}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 14 }}>
            {kpiCards.slice(3, 6).map((kpi, i) => <KpiCard key={kpi.label} kpi={kpi} colorIdx={i + 3} />)}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 14 }}>
            {kpiCards.slice(6, 10).map((kpi, i) => <KpiCard key={kpi.label} kpi={kpi} colorIdx={i + 6} />)}
          </div>
        </div>
      </div>

      {/* ===== 言語別: 月次+日次統合ページ ===== */}
      {languages.map((lang, langIdx) => {
        const mRows = monthlyByLang[lang];
        const dRows = dailyByLang[lang];
        const thisPageNum = 2 + langIdx; // P1=1, 言語=2〜

        return (
          <div key={lang} style={{ ...slideStyle, minHeight: "auto" }}>
            <div style={slideBarStyle}>
              <span>{shopName} — {lang}</span>
              <span>{thisPageNum} / {totalPages}</span>
            </div>
            <div style={{ ...slideBodyStyle, overflow: "visible" }}>
              {/* 月次セクション */}
              <div style={stitleStyle}>月次推移</div>
              {mRows.length > 1 && (
                <div style={{ height: 200, marginBottom: 12 }}>
                  <Bar
                    data={{
                      labels: mRows.map(r => formatMonthShort(r.month || "")),
                      datasets: [{ label: "表示回数", data: mRows.map(r => r.impressions), backgroundColor: chartColors[langIdx % chartColors.length], borderColor: chartBorderColors[langIdx % chartBorderColors.length], borderWidth: 1 }],
                    }}
                    options={{
                      responsive: true, maintainAspectRatio: false,
                      plugins: { legend: { display: false } },
                      scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: "#f0f0f0" }, ticks: { callback: (v) => Number(v).toLocaleString() } } },
                    }}
                  />
                </div>
              )}
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ background: "#0f3460", color: "#fff", padding: "8px 10px", fontWeight: 600 }}>月</th>
                    {mRows.map((r, i) => (
                      <th key={i} style={{ background: i === mRows.length - 1 ? "#e94560" : "#0f3460", color: "#fff", padding: "8px 6px", fontWeight: 600, textAlign: "center" }}>
                        {formatMonthShort(r.month || "")}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(["impressions", "clicks", "ctr", "averageCpc", "costMicros"] as const).map((field, ri) => (
                    <tr key={field} style={{ background: ri % 2 === 0 ? "#f8f9fa" : "#f8f9fb" }}>
                      <td style={{ padding: "6px 10px", fontWeight: 600, color: "#666" }}>
                        {{ impressions: "表示回数", clicks: "クリック数", ctr: "クリック率", averageCpc: "平均クリック単価", costMicros: "広告費" }[field]}
                      </td>
                      {mRows.map((r, i) => (
                        <td key={i} style={{ textAlign: "center", padding: "6px", fontWeight: field === "costMicros" ? 700 : undefined, background: i === mRows.length - 1 ? "#fff8f0" : undefined }}>
                          {field === "impressions" ? r.impressions.toLocaleString()
                            : field === "clicks" ? r.clicks.toLocaleString()
                            : field === "ctr" ? formatCtr(r.ctr)
                            : field === "averageCpc" ? formatCpc(r.averageCpc)
                            : formatCost(r.costMicros)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* 日次セクション（スクロール可能） */}
              {dRows.length > 0 && (
                <>
                  <div style={{ ...stitleStyle, marginTop: 24, marginBottom: 10 }}>日次データ{dRows[0]?.date ? `（${new Date(dRows[0].date).getMonth() + 1}月）` : ""}</div>
                  <div style={{ overflowY: "auto", maxHeight: 280, border: "1px solid #e0e0e0", borderRadius: 8 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <thead>
                        <tr>
                          {["日付", "表示回数", "クリック数", "クリック率", "平均クリック単価", "広告費"].map((h, i) => (
                            <th key={h} style={{ background: "#0f3460", color: "#fff", padding: "8px 12px", fontWeight: 600, textAlign: i === 0 ? "left" : "center", position: "sticky", top: 0, zIndex: 1 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {dRows.map((r, i) => (
                          <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#f8f9fb" }}>
                            <td style={{ padding: "6px 12px", fontWeight: 600, color: "#666", whiteSpace: "nowrap" }}>{formatDate(r.date || "")}</td>
                            <td style={{ textAlign: "center", padding: "6px 12px" }}>{r.impressions.toLocaleString()}</td>
                            <td style={{ textAlign: "center", padding: "6px 12px" }}>{r.clicks.toLocaleString()}</td>
                            <td style={{ textAlign: "center", padding: "6px 12px" }}>{formatCtr(r.ctr)}</td>
                            <td style={{ textAlign: "center", padding: "6px 12px" }}>{formatCpc(r.averageCpc)}</td>
                            <td style={{ textAlign: "center", padding: "6px 12px", fontWeight: 700 }}>{formatCost(r.costMicros)}</td>
                          </tr>
                        ))}
                        <tr style={{ background: "#e8eaf0", fontWeight: 700 }}>
                          <td style={{ padding: "8px 12px" }}>合計</td>
                          <td style={{ textAlign: "center", padding: "8px 12px" }}>{dRows.reduce((s, r) => s + r.impressions, 0).toLocaleString()}</td>
                          <td style={{ textAlign: "center", padding: "8px 12px" }}>{dRows.reduce((s, r) => s + r.clicks, 0).toLocaleString()}</td>
                          <td style={{ textAlign: "center", padding: "8px 12px" }}>{formatCtr(dRows.reduce((s, r) => s + r.clicks, 0) / Math.max(dRows.reduce((s, r) => s + r.impressions, 0), 1))}</td>
                          <td style={{ textAlign: "center", padding: "8px 12px" }}>{formatCpc(dRows.reduce((s, r) => s + r.costMicros, 0) / Math.max(dRows.reduce((s, r) => s + r.clicks, 0), 1))}</td>
                          <td style={{ textAlign: "center", padding: "8px 12px" }}>{formatCost(dRows.reduce((s, r) => s + r.costMicros, 0))}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })}

      {/* ===== 最終ページ: まとめ ===== */}
      {hasSummary && (
          <div style={slideStyle}>
            <div style={slideBarStyle}>
              <span>{shopName} — まとめ</span>
              <span>{totalPages} / {totalPages}</span>
            </div>
            <div style={{ ...slideBodyStyle, justifyContent: "flex-start", paddingTop: 36 }}>
              <div style={stitleStyle}>まとめ</div>
              <div style={{ background: "#fff", borderRadius: 12, padding: "24px 28px", fontSize: 15, lineHeight: 1.8, color: "#333", whiteSpace: "pre-wrap" }}>
                {summaryText}
              </div>
            </div>
          </div>
      )}
    </div>
  );
}

// ── KPIカードコンポーネント ──
function KpiCard({ kpi, colorIdx }: {
  kpi: { label: string; value: number; format: (v: number) => string; prev: number; lastYear: number | null };
  colorIdx: number;
}) {
  return (
    <div style={{ background: "#fff", borderRadius: 12, padding: "14px 16px", position: "relative", overflow: "hidden", boxShadow: "0 1px 6px rgba(0,0,0,.04)" }}>
      <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: 3, background: kpiTopColors[colorIdx % kpiTopColors.length] }} />
      <div style={{ fontSize: 12, color: "#888", fontWeight: 500 }}>{kpi.label}</div>
      <div style={{ fontSize: 24, fontWeight: 900, lineHeight: 1.1, margin: "4px 0 6px" }}>{kpi.format(kpi.value)}</div>
      <ComparisonBadge current={kpi.value} previous={kpi.prev} label="前月比" format={kpi.format} />
      {kpi.lastYear !== null && <ComparisonBadge current={kpi.value} previous={kpi.lastYear} label="前年比" format={kpi.format} />}
    </div>
  );
}
