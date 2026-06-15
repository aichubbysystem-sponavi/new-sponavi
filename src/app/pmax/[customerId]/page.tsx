"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
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

// ==============================
// 型定義
// ==============================
type SummaryData = {
  impressions: number;
  clicks: number;
  costMicros: number;
  conversions: number;
  interactionRate: number;
};

type CampaignRow = {
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

type MonthlyData = { campaigns: Record<string, CampaignRow[]> };
type DailyData = { campaigns: Record<string, CampaignRow[]> };

type GbpRow = {
  month: string;
  shopName: string;
  totalVisits: number;
  phone: number;
  directions: number;
  website: number;
  menuClicks: number;
  saveShare: number;
};

// ==============================
// 定数 (MEOレポート準拠)
// ==============================
const SLIDE_W = 1123;
const SLIDE_H = 794;

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

const chartColors = [
  "rgba(79,195,247,.75)",
  "rgba(129,199,132,.75)",
  "rgba(255,183,77,.75)",
  "rgba(186,104,200,.75)",
  "rgba(231,115,115,.75)",
  "rgba(77,182,172,.75)",
  "rgba(121,134,203,.75)",
  "rgba(255,213,79,.75)",
];

const chartBorderColors = [
  "rgba(2,136,209,1)",
  "rgba(56,142,60,1)",
  "rgba(245,124,0,1)",
  "rgba(123,31,162,1)",
  "rgba(211,47,47,1)",
  "rgba(0,137,123,1)",
  "rgba(57,73,171,1)",
  "rgba(251,192,45,1)",
];

// ==============================
// スタイル定数
// ==============================
const slideStyle: React.CSSProperties = {
  width: SLIDE_W,
  minHeight: SLIDE_H,
  margin: "20px auto",
  background: "#f0f2f5",
  borderRadius: 8,
  overflow: "hidden",
  boxShadow: "0 8px 40px rgba(0,0,0,.4)",
  display: "flex",
  flexDirection: "column",
  pageBreakAfter: "always",
  pageBreakInside: "avoid",
};

const slideBarStyle: React.CSSProperties = {
  background: "linear-gradient(135deg,#1a1a2e,#0f3460)",
  color: "#fff",
  padding: "12px 36px",
  fontSize: 16,
  fontWeight: 700,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  flexShrink: 0,
  letterSpacing: 0.5,
};

const slideBodyStyle: React.CSSProperties = {
  flex: 1,
  padding: "28px 36px",
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  overflow: "hidden",
};

const stitleStyle: React.CSSProperties = {
  fontSize: 17,
  fontWeight: 700,
  color: "#0f3460",
  borderLeft: "4px solid #e94560",
  paddingLeft: 12,
  marginBottom: 16,
};

// ==============================
// ユーティリティ
// ==============================
const formatCost = (micros: number) => `¥${Math.round(micros / 1_000_000).toLocaleString()}`;
const formatCpc = (micros: number) => `¥${Math.round(micros / 1_000_000).toLocaleString()}`;
const formatCtr = (ctr: number) => `${(ctr * 100).toFixed(2)}%`;
const formatMonth = (m: string) => {
  if (!m) return "";
  const d = new Date(m);
  return `${d.getFullYear()}/${d.getMonth() + 1}`;
};
const formatMonthShort = (m: string) => {
  if (!m) return "";
  const d = new Date(m);
  return `${d.getMonth() + 1}月`;
};
const formatDate = (d: string) => {
  if (!d) return "";
  return d.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$2/$3");
};

function getDateRange(monthsBack: number) {
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - monthsBack);
  start.setDate(1);
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  return { startDate: fmt(start), endDate: fmt(end) };
}

function getCurrentMonthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  return { startDate: fmt(start), endDate: fmt(end) };
}

function getPrevMonthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 0);
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  return { startDate: fmt(start), endDate: fmt(end) };
}

// 前月比バッジ
function MomBadge({ current, previous }: { current: number; previous: number }) {
  if (previous === 0 && current === 0) return <span style={badgeStyle(false, true)}>→ 0.0% 前月比</span>;
  if (previous === 0) return <span style={badgeStyle(true)}>▲ NEW 前月比</span>;
  const pct = ((current - previous) / previous) * 100;
  const isUp = pct > 0;
  const isFlat = Math.abs(pct) < 0.5;
  const arrow = isFlat ? "→" : isUp ? "▲" : "▼";
  const text = `${arrow} ${isFlat ? "0.0" : (isUp ? "+" : "") + pct.toFixed(1)}%（${previous.toLocaleString()}→${current.toLocaleString()}）前月比`;
  return <span style={badgeStyle(isUp, isFlat)}>{text}</span>;
}

function badgeStyle(isUp: boolean, isFlat?: boolean): React.CSSProperties {
  return {
    display: "inline-block",
    padding: "2px 7px",
    borderRadius: 16,
    fontSize: 11,
    fontWeight: 600,
    background: isFlat ? "#f0f0f0" : isUp ? "#e6f9ee" : "#fde8e8",
    color: isFlat ? "#888" : isUp ? "#0a8f3c" : "#c0392b",
  };
}

// ==============================
// メインコンポーネント
// ==============================
export default function PmaxReportPage() {
  const { customerId } = useParams<{ customerId: string }>();
  const router = useRouter();

  const [accountName, setAccountName] = useState("");
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [prevSummary, setPrevSummary] = useState<SummaryData | null>(null);
  const [monthlyData, setMonthlyData] = useState<MonthlyData | null>(null);
  const [dailyData, setDailyData] = useState<DailyData | null>(null);
  const [gbpCurrent, setGbpCurrent] = useState<GbpRow | null>(null);
  const [gbpPrev, setGbpPrev] = useState<GbpRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!customerId) return;

    const { startDate: mStart, endDate: mEnd } = getDateRange(12);
    const { startDate: cStart, endDate: cEnd } = getCurrentMonthRange();
    const { startDate: pStart, endDate: pEnd } = getPrevMonthRange();
    const { startDate: dStart, endDate: dEnd } = getCurrentMonthRange();

    setLoading(true);
    setError("");

    const now = new Date();
    const curMonth = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}`;
    const prevMonth = `${now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()}/${String(now.getMonth() === 0 ? 12 : now.getMonth()).padStart(2, "0")}`;

    Promise.all([
      fetch(`/api/pmax/accounts`).then((r) => r.json()),
      fetch(`/api/pmax/summary?customerId=${customerId}&startDate=${cStart}&endDate=${cEnd}`).then((r) => r.json()),
      fetch(`/api/pmax/summary?customerId=${customerId}&startDate=${pStart}&endDate=${pEnd}`).then((r) => r.json()),
      fetch(`/api/pmax/monthly?customerId=${customerId}&startDate=${mStart}&endDate=${mEnd}`).then((r) => r.json()),
      fetch(`/api/pmax/daily?customerId=${customerId}&startDate=${dStart}&endDate=${dEnd}`).then((r) => r.json()),
    ])
      .then(async ([accountsRes, summaryRes, prevSummaryRes, monthlyRes, dailyRes]) => {
        const acct = (accountsRes.accounts || []).find((a: any) => a.customerId === customerId);
        const name = acct?.name || customerId;
        setAccountName(name);
        if (summaryRes.error) throw new Error(summaryRes.error);
        setSummary(summaryRes);
        setPrevSummary(prevSummaryRes.error ? null : prevSummaryRes);
        setMonthlyData(monthlyRes?.campaigns ? monthlyRes : null);
        setDailyData(dailyRes?.campaigns ? dailyRes : null);

        // GBPデータ取得（エラーでも広告データは表示する）
        try {
          const gbpRes = await fetch(`/api/pmax/gbp?shopName=${encodeURIComponent(name)}`).then(r => r.json());
          if (gbpRes.data && gbpRes.data.length > 0) {
            const curRow = gbpRes.data.find((r: GbpRow) => r.month === curMonth);
            const prevRow = gbpRes.data.find((r: GbpRow) => r.month === prevMonth);
            if (curRow) setGbpCurrent(curRow);
            if (prevRow) setGbpPrev(prevRow);
          }
        } catch (e) {
          console.warn("GBPデータ取得失敗（広告データは表示）:", e);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [customerId]);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#1a1a2e" }}>
        <div style={{ textAlign: "center", color: "#fff" }}>
          <div style={{ width: 40, height: 40, border: "3px solid rgba(255,255,255,.3)", borderTopColor: "#e94560", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto" }} />
          <p style={{ marginTop: 16, fontSize: 14, opacity: 0.7 }}>レポートデータを取得中...</p>
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
          <button onClick={() => router.push("/pmax")} style={{ marginTop: 16, padding: "8px 20px", background: "#0f3460", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14 }}>
            戻る
          </button>
        </div>
      </div>
    );
  }

  const now = new Date();
  const currentMonth = `${now.getFullYear()}/${now.getMonth() + 1}`;
  const periodStart = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/01`;
  const periodEnd = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()}`;

  const totalPages = 2 + (monthlyData ? Object.keys(monthlyData.campaigns).length : 0) + (dailyData ? Object.keys(dailyData.campaigns).length : 0);
  let pageNum = 0;

  return (
    <div style={{ background: "#1a1a2e", minHeight: "100vh", paddingBottom: 40 }}>
      {/* トップバー */}
      <div className="no-print" style={{ background: "rgba(0,0,0,0.3)", padding: "12px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100, backdropFilter: "blur(10px)" }}>
        <button onClick={() => router.push("/pmax")} style={{ color: "rgba(255,255,255,0.8)", background: "none", border: "none", cursor: "pointer", fontSize: 14 }}>
          ← アカウント一覧に戻る
        </button>
        <div style={{ display: "flex", gap: 12 }}>
          <span style={{ fontSize: 12, color: "#4fc3f7", background: "rgba(79,195,247,0.15)", padding: "4px 12px", borderRadius: 20, border: "1px solid rgba(79,195,247,0.3)" }}>
            P-MAX広告レポート
          </span>
        </div>
      </div>

      {/* ===== P1: サマリー ===== */}
      {summary && (() => {
        pageNum++;
        const kpis = [
          { label: "総表示回数", value: summary.impressions, prev: prevSummary?.impressions || 0, format: (v: number) => v.toLocaleString() },
          { label: "総クリック", value: summary.clicks, prev: prevSummary?.clicks || 0, format: (v: number) => v.toLocaleString() },
          { label: "総広告費", value: summary.costMicros, prev: prevSummary?.costMicros || 0, format: (v: number) => formatCost(v) },
          { label: "合計来店数", value: gbpCurrent?.totalVisits || 0, prev: gbpPrev?.totalVisits || 0, format: (v: number) => v.toLocaleString(), gbp: true },
          { label: "電話", value: gbpCurrent?.phone || 0, prev: gbpPrev?.phone || 0, format: (v: number) => v.toLocaleString(), gbp: true },
          { label: "経路案内", value: gbpCurrent?.directions || 0, prev: gbpPrev?.directions || 0, format: (v: number) => v.toLocaleString(), gbp: true },
          { label: "メニュークリック", value: gbpCurrent?.menuClicks || 0, prev: gbpPrev?.menuClicks || 0, format: (v: number) => v.toLocaleString(), gbp: true },
          { label: "予約", value: gbpCurrent?.website || 0, prev: gbpPrev?.website || 0, format: (v: number) => v.toLocaleString(), gbp: true },
          { label: "保存・共有", value: gbpCurrent?.saveShare || 0, prev: gbpPrev?.saveShare || 0, format: (v: number) => v.toLocaleString(), gbp: true },
        ];

        return (
          <div style={slideStyle}>
            {/* ヘッダー */}
            <div style={{ background: "linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%)", color: "#fff", padding: "28px 36px 20px", flexShrink: 0, position: "relative" }}>
              <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900, letterSpacing: 1 }}>{accountName}</h1>
              <div style={{ fontSize: 13, opacity: 0.7, marginTop: 2 }}>P-MAX広告 レポート報告</div>
              <div style={{ position: "absolute", top: 28, right: 36, background: "rgba(255,255,255,.12)", padding: "7px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
                {periodStart} - {periodEnd}
              </div>
            </div>

            {/* 情報バー */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: "10px 36px", background: "#e8eaf0", flexShrink: 0 }}>
              <div style={{ background: "#fff", borderRadius: 10, padding: "7px 14px", fontSize: 12, display: "flex", alignItems: "center", gap: 5, boxShadow: "0 1px 3px rgba(0,0,0,.05)" }}>
                <span style={{ color: "#888" }}>レポート対象</span>
                <span style={{ fontWeight: 700 }}>{currentMonth}</span>
              </div>
              <div style={{ background: "#fff", borderRadius: 10, padding: "7px 14px", fontSize: 12, display: "flex", alignItems: "center", gap: 5, boxShadow: "0 1px 3px rgba(0,0,0,.05)" }}>
                <span style={{ color: "#888" }}>広告タイプ</span>
                <span style={{ fontWeight: 700 }}>P-MAX</span>
              </div>
              <div style={{ background: "#fff", borderRadius: 10, padding: "7px 14px", fontSize: 12, display: "flex", alignItems: "center", gap: 5, boxShadow: "0 1px 3px rgba(0,0,0,.05)" }}>
                <span style={{ color: "#888" }}>アカウントID</span>
                <span style={{ fontWeight: 700 }}>{customerId.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3")}</span>
              </div>
            </div>

            {/* KPIカード */}
            <div style={{ flex: 1, padding: "20px 36px", overflow: "hidden" }}>
              <div style={stitleStyle}>主要指標サマリー（{currentMonth}）</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
                {kpis.map((kpi, i) => (
                  <div key={kpi.label} style={{ background: "#fff", borderRadius: 12, padding: "14px 16px", position: "relative", overflow: "hidden", boxShadow: "0 1px 6px rgba(0,0,0,.04)", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                    <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: 3, background: kpiTopColors[i % 8] }} />
                    <div style={{ fontSize: 12, color: "#888", fontWeight: 500 }}>{kpi.label}</div>
                    <div style={{ fontSize: 26, fontWeight: 900, lineHeight: 1.1, margin: "4px 0" }}>
                      {kpi.format(kpi.value)}
                    </div>
                    <MomBadge current={kpi.label === "総広告費" ? Math.round(kpi.value / 1_000_000) : kpi.value} previous={kpi.label === "総広告費" ? Math.round(kpi.prev / 1_000_000) : kpi.prev} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ===== P2: 棒グラフ（広告指標推移） ===== */}
      {monthlyData && (() => {
        pageNum++;
        const campaignNames = Object.keys(monthlyData.campaigns);
        const allMonths = Array.from(new Set(Object.values(monthlyData.campaigns).flat().map(r => r.month).filter(Boolean))).sort() as string[];

        // 表示回数の積み上げ棒グラフデータ
        const datasets = campaignNames.map((name, i) => {
          const rows = monthlyData.campaigns[name];
          const monthMap = new Map(rows.map(r => [r.month, r.impressions]));
          return {
            label: name,
            data: allMonths.map(m => monthMap.get(m) || 0),
            backgroundColor: chartColors[i % chartColors.length],
            borderColor: chartBorderColors[i % chartBorderColors.length],
            borderWidth: 1,
          };
        });

        // 月別合計
        const monthTotals = allMonths.map((_, mi) => datasets.reduce((s, ds) => s + (ds.data[mi] || 0), 0));

        return (
          <div style={slideStyle}>
            <div style={slideBarStyle}>
              <span>{accountName} — 広告表示回数推移</span>
              <span>{pageNum} / {totalPages}</span>
            </div>
            <div style={slideBodyStyle}>
              <div style={{ height: 350 }}>
                <Bar
                  data={{ labels: allMonths.map(formatMonthShort), datasets }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                      legend: { position: "top", labels: { font: { size: 11 } } },
                      tooltip: {
                        mode: "index",
                        intersect: false,
                        callbacks: { afterBody: (items) => "合計: " + items.reduce((s, i) => s + (i.raw as number), 0).toLocaleString() },
                      },
                    },
                    scales: {
                      x: { stacked: true, grid: { display: false } },
                      y: { stacked: true, beginAtZero: true, grid: { color: "#f0f0f0" }, ticks: { callback: (v) => Number(v).toLocaleString() } },
                    },
                  }}
                />
              </div>
              {/* テーブル */}
              <table style={{ width: "95%", margin: "8px auto 0", borderCollapse: "collapse", fontSize: 11 }}>
                <tbody>
                  <tr style={{ background: "#f8f9fa" }}>
                    <td style={{ padding: "3px 4px", fontWeight: 600, color: "#666", width: 70 }}>月</td>
                    {allMonths.map(m => <td key={m} style={{ textAlign: "center", padding: "3px 4px", fontWeight: 600, color: "#666" }}>{formatMonthShort(m)}</td>)}
                  </tr>
                  {campaignNames.map((name, i) => (
                    <tr key={name} style={{ background: i % 2 === 0 ? "#fff" : "#f8f9fb" }}>
                      <td style={{ padding: "3px 4px", fontWeight: 600, color: "#666", fontSize: 10, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 70 }}>{name}</td>
                      {allMonths.map(m => {
                        const row = monthlyData.campaigns[name].find(r => r.month === m);
                        return <td key={m} style={{ textAlign: "center", padding: "3px 4px" }}>{(row?.impressions || 0).toLocaleString()}</td>;
                      })}
                    </tr>
                  ))}
                  <tr style={{ background: "#e8eaf0", fontWeight: 700 }}>
                    <td style={{ padding: "3px 4px", color: "#333" }}>合計</td>
                    {monthTotals.map((t, i) => <td key={i} style={{ textAlign: "center", padding: "3px 4px", color: "#333" }}>{t.toLocaleString()}</td>)}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* ===== P3: 言語別月次推移 ===== */}
      {monthlyData && Object.entries(monthlyData.campaigns).map(([campaignName, rows]) => {
        pageNum++;
        const sortedRows = [...rows].sort((a, b) => (a.month || "").localeCompare(b.month || ""));

        const impressionsData = {
          labels: sortedRows.map(r => formatMonthShort(r.month || "")),
          datasets: [
            {
              label: "表示回数",
              data: sortedRows.map(r => r.impressions),
              backgroundColor: "rgba(79,195,247,.75)",
              borderColor: "rgba(2,136,209,1)",
              borderWidth: 1,
            },
          ],
        };

        return (
          <div key={campaignName} style={slideStyle}>
            <div style={slideBarStyle}>
              <span>{accountName} — {campaignName} 月次推移</span>
              <span>{pageNum} / {totalPages}</span>
            </div>
            <div style={slideBodyStyle}>
              <div style={{ height: 280 }}>
                <Bar
                  data={impressionsData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                      x: { grid: { display: false } },
                      y: { beginAtZero: true, grid: { color: "#f0f0f0" }, ticks: { callback: (v) => Number(v).toLocaleString() } },
                    },
                  }}
                />
              </div>
              {/* データテーブル */}
              <table style={{ width: "95%", margin: "12px auto 0", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr>
                    <th style={{ background: "#0f3460", color: "#fff", padding: "6px 8px", fontWeight: 600 }}>月</th>
                    {sortedRows.map((r, i) => (
                      <th key={i} style={{ background: i === sortedRows.length - 1 ? "#e94560" : "#0f3460", color: "#fff", padding: "6px 4px", fontWeight: 600, textAlign: "center" }}>
                        {formatMonthShort(r.month || "")}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ padding: "4px 8px", fontWeight: 600, color: "#666", background: "#f8f9fa" }}>表示回数</td>
                    {sortedRows.map((r, i) => <td key={i} style={{ textAlign: "center", padding: "4px", background: i === sortedRows.length - 1 ? "#fff8f0" : undefined }}>{r.impressions.toLocaleString()}</td>)}
                  </tr>
                  <tr style={{ background: "#f8f9fb" }}>
                    <td style={{ padding: "4px 8px", fontWeight: 600, color: "#666" }}>クリック数</td>
                    {sortedRows.map((r, i) => <td key={i} style={{ textAlign: "center", padding: "4px", background: i === sortedRows.length - 1 ? "#fff8f0" : undefined }}>{r.clicks.toLocaleString()}</td>)}
                  </tr>
                  <tr>
                    <td style={{ padding: "4px 8px", fontWeight: 600, color: "#666", background: "#f8f9fa" }}>クリック率</td>
                    {sortedRows.map((r, i) => <td key={i} style={{ textAlign: "center", padding: "4px", background: i === sortedRows.length - 1 ? "#fff8f0" : undefined }}>{formatCtr(r.ctr)}</td>)}
                  </tr>
                  <tr style={{ background: "#f8f9fb" }}>
                    <td style={{ padding: "4px 8px", fontWeight: 600, color: "#666" }}>平均CPC</td>
                    {sortedRows.map((r, i) => <td key={i} style={{ textAlign: "center", padding: "4px", background: i === sortedRows.length - 1 ? "#fff8f0" : undefined }}>{formatCpc(r.averageCpc)}</td>)}
                  </tr>
                  <tr>
                    <td style={{ padding: "4px 8px", fontWeight: 600, color: "#666", background: "#f8f9fa" }}>広告費</td>
                    {sortedRows.map((r, i) => <td key={i} style={{ textAlign: "center", padding: "4px", fontWeight: 700, background: i === sortedRows.length - 1 ? "#fff8f0" : undefined }}>{formatCost(r.costMicros)}</td>)}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {/* ===== P4: 言語別日次データ ===== */}
      {dailyData && Object.entries(dailyData.campaigns).map(([campaignName, rows]) => {
        pageNum++;
        const sortedRows = [...rows].sort((a, b) => (a.date || "").localeCompare(b.date || ""));

        return (
          <div key={`daily-${campaignName}`} style={{ ...slideStyle, minHeight: "auto" }}>
            <div style={slideBarStyle}>
              <span>{accountName} — {campaignName} 日次データ</span>
              <span>{pageNum} / {totalPages}</span>
            </div>
            <div style={{ ...slideBodyStyle, padding: "16px 24px" }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr>
                      <th style={{ background: "#0f3460", color: "#fff", padding: "6px 8px", fontWeight: 600, position: "sticky", left: 0, zIndex: 1 }}>日付</th>
                      <th style={{ background: "#0f3460", color: "#fff", padding: "6px 8px", fontWeight: 600, textAlign: "center" }}>表示回数</th>
                      <th style={{ background: "#0f3460", color: "#fff", padding: "6px 8px", fontWeight: 600, textAlign: "center" }}>クリック数</th>
                      <th style={{ background: "#0f3460", color: "#fff", padding: "6px 8px", fontWeight: 600, textAlign: "center" }}>クリック率</th>
                      <th style={{ background: "#0f3460", color: "#fff", padding: "6px 8px", fontWeight: 600, textAlign: "center" }}>平均CPC</th>
                      <th style={{ background: "#0f3460", color: "#fff", padding: "6px 8px", fontWeight: 600, textAlign: "center" }}>広告費</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map((r, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#f8f9fb" }}>
                        <td style={{ padding: "4px 8px", fontWeight: 600, color: "#666" }}>{formatDate(r.date || "")}</td>
                        <td style={{ textAlign: "center", padding: "4px 8px" }}>{r.impressions.toLocaleString()}</td>
                        <td style={{ textAlign: "center", padding: "4px 8px" }}>{r.clicks.toLocaleString()}</td>
                        <td style={{ textAlign: "center", padding: "4px 8px" }}>{formatCtr(r.ctr)}</td>
                        <td style={{ textAlign: "center", padding: "4px 8px" }}>{formatCpc(r.averageCpc)}</td>
                        <td style={{ textAlign: "center", padding: "4px 8px", fontWeight: 700 }}>{formatCost(r.costMicros)}</td>
                      </tr>
                    ))}
                    {/* 合計行 */}
                    <tr style={{ background: "#e8eaf0", fontWeight: 700 }}>
                      <td style={{ padding: "6px 8px", color: "#333" }}>合計</td>
                      <td style={{ textAlign: "center", padding: "6px 8px", color: "#333" }}>{sortedRows.reduce((s, r) => s + r.impressions, 0).toLocaleString()}</td>
                      <td style={{ textAlign: "center", padding: "6px 8px", color: "#333" }}>{sortedRows.reduce((s, r) => s + r.clicks, 0).toLocaleString()}</td>
                      <td style={{ textAlign: "center", padding: "6px 8px", color: "#333" }}>
                        {formatCtr(sortedRows.reduce((s, r) => s + r.clicks, 0) / Math.max(sortedRows.reduce((s, r) => s + r.impressions, 0), 1))}
                      </td>
                      <td style={{ textAlign: "center", padding: "6px 8px", color: "#333" }}>
                        {formatCpc(sortedRows.reduce((s, r) => s + r.costMicros, 0) / Math.max(sortedRows.reduce((s, r) => s + r.clicks, 0), 1))}
                      </td>
                      <td style={{ textAlign: "center", padding: "6px 8px", color: "#333" }}>{formatCost(sortedRows.reduce((s, r) => s + r.costMicros, 0))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
