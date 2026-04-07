"use client";

import Link from "next/link";
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
import type { ReportData } from "@/lib/report-data";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

// ── Constants ──

const SLIDE_W = 1123;
const SLIDE_H = 794;

const kpiColors = [
  { bg: "linear-gradient(135deg, #4fc3f7 0%, #0288d1 100%)" },
  { bg: "linear-gradient(135deg, #81c784 0%, #388e3c 100%)" },
  { bg: "linear-gradient(135deg, #ffb74d 0%, #f57c00 100%)" },
  { bg: "linear-gradient(135deg, #ba68c8 0%, #7b1fa2 100%)" },
  { bg: "linear-gradient(135deg, #e57373 0%, #d32f2f 100%)" },
  { bg: "linear-gradient(135deg, #4db6ac 0%, #00897b 100%)" },
  { bg: "linear-gradient(135deg, #7986cb 0%, #3949ab 100%)" },
  { bg: "linear-gradient(135deg, #ffd54f 0%, #fbc02d 100%)" },
];

const slideStyle: React.CSSProperties = {
  width: SLIDE_W,
  height: SLIDE_H,
  margin: "20px auto",
  background: "#f0f2f5",
  borderRadius: 8,
  overflow: "hidden",
  boxShadow: "0 8px 40px rgba(0,0,0,.4)",
  display: "flex",
  flexDirection: "column",
  position: "relative",
  pageBreakAfter: "always",
  pageBreakInside: "avoid",
};

const headerBarStyle: React.CSSProperties = {
  background: "linear-gradient(135deg, #1a1a2e 0%, #0f3460 100%)",
  color: "#fff",
  padding: "18px 36px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  flexShrink: 0,
};

const slideBodyStyle: React.CSSProperties = {
  flex: 1,
  padding: "20px 36px",
  overflow: "hidden",
};

// ── Helpers ──

function pctChange(cur: number, prev: number): { text: string; color: string } {
  if (prev === 0 && cur === 0) return { text: "±0.0%", color: "#666" };
  if (prev === 0) return { text: "+∞", color: "#388e3c" };
  const pct = ((cur - prev) / prev) * 100;
  const sign = pct >= 0 ? "+" : "";
  const color = pct >= 0 ? "#388e3c" : "#d32f2f";
  return { text: `${sign}${pct.toFixed(1)}%`, color };
}

function buildStackedOptions(titleText: string) {
  return {
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      title: {
        display: false,
      },
      legend: {
        position: "top" as const,
        labels: {
          font: { family: "Noto Sans JP", size: 11 },
        },
      },
      tooltip: {
        mode: "index" as const,
        intersect: false,
        callbacks: {
          afterBody: (items: any[]) => {
            let total = 0;
            items.forEach((i: any) => (total += i.parsed.y));
            return "合計: " + total.toLocaleString();
          },
        },
      },
    },
    scales: {
      x: { stacked: true, grid: { display: false } },
      y: {
        stacked: true,
        beginAtZero: true,
        grid: { color: "#f0f0f0" },
        ticks: {
          callback: (v: any) => Number(v).toLocaleString(),
        },
      },
    },
  };
}

// ── Component ──

export default function ReportClient({
  data,
  shopId,
}: {
  data: ReportData;
  shopId: string;
}) {
  const { shop, kpis, monthlyLabels, charts, keywords, reviewLabels, reviewCounts, reviewDelta, reviewAnalysis, comments } = data;

  const hasKeywords = keywords.length > 0;

  // Build monthly table data
  const monthlyTableData = monthlyLabels.map((label, i) => ({
    label,
    searchMobile: charts.searchMobile[i],
    searchPC: charts.searchPC[i],
    searchTotal: charts.searchMobile[i] + charts.searchPC[i],
    mapMobile: charts.mapMobile[i],
    mapPC: charts.mapPC[i],
    mapTotal: charts.mapMobile[i] + charts.mapPC[i],
    calls: charts.calls[i],
    routes: charts.routes[i],
    websites: charts.websites[i],
    bookings: charts.bookings[i],
    foodMenus: charts.foodMenus[i],
    totalActions:
      charts.calls[i] +
      charts.routes[i] +
      charts.websites[i] +
      charts.bookings[i] +
      charts.foodMenus[i],
  }));

  // MoM / YoY comparison
  const curIdx = monthlyLabels.length - 1;
  const prevIdx = curIdx - 1;
  const yoyIdx = curIdx - 12 >= 0 ? curIdx - 12 : -1;

  function comparisonRow(label: string, curVal: number, prevVal: number) {
    const ch = pctChange(curVal, prevVal);
    return { label, curVal, prevVal, ...ch };
  }

  const momRows = prevIdx >= 0
    ? [
        comparisonRow("Google検索(モバイル)", charts.searchMobile[curIdx], charts.searchMobile[prevIdx]),
        comparisonRow("Google検索(PC)", charts.searchPC[curIdx], charts.searchPC[prevIdx]),
        comparisonRow("Googleマップ(モバイル)", charts.mapMobile[curIdx], charts.mapMobile[prevIdx]),
        comparisonRow("Googleマップ(PC)", charts.mapPC[curIdx], charts.mapPC[prevIdx]),
        comparisonRow("通話クリック", charts.calls[curIdx], charts.calls[prevIdx]),
        comparisonRow("ルート検索", charts.routes[curIdx], charts.routes[prevIdx]),
        comparisonRow("ウェブサイト", charts.websites[curIdx], charts.websites[prevIdx]),
        comparisonRow("予約", charts.bookings[curIdx], charts.bookings[prevIdx]),
        comparisonRow("メニュー閲覧", charts.foodMenus[curIdx], charts.foodMenus[prevIdx]),
      ]
    : [];

  const yoyRows = yoyIdx >= 0
    ? [
        comparisonRow("Google検索(モバイル)", charts.searchMobile[curIdx], charts.searchMobile[yoyIdx]),
        comparisonRow("Google検索(PC)", charts.searchPC[curIdx], charts.searchPC[yoyIdx]),
        comparisonRow("Googleマップ(モバイル)", charts.mapMobile[curIdx], charts.mapMobile[yoyIdx]),
        comparisonRow("Googleマップ(PC)", charts.mapPC[curIdx], charts.mapPC[yoyIdx]),
        comparisonRow("通話クリック", charts.calls[curIdx], charts.calls[yoyIdx]),
        comparisonRow("ルート検索", charts.routes[curIdx], charts.routes[yoyIdx]),
        comparisonRow("ウェブサイト", charts.websites[curIdx], charts.websites[yoyIdx]),
        comparisonRow("予約", charts.bookings[curIdx], charts.bookings[yoyIdx]),
        comparisonRow("メニュー閲覧", charts.foodMenus[curIdx], charts.foodMenus[yoyIdx]),
      ]
    : [];

  // Chart data
  const searchChartData = {
    labels: monthlyLabels,
    datasets: [
      {
        label: "モバイル",
        data: charts.searchMobile,
        backgroundColor: "rgba(33,150,243,0.7)",
      },
      {
        label: "PC",
        data: charts.searchPC,
        backgroundColor: "rgba(255,152,0,0.7)",
      },
    ],
  };

  const mapChartData = {
    labels: monthlyLabels,
    datasets: [
      {
        label: "モバイル",
        data: charts.mapMobile,
        backgroundColor: "rgba(76,175,80,0.7)",
      },
      {
        label: "PC",
        data: charts.mapPC,
        backgroundColor: "rgba(156,39,176,0.7)",
      },
    ],
  };

  const actionChartData = {
    labels: monthlyLabels,
    datasets: [
      {
        label: "ウェブサイト",
        data: charts.websites,
        backgroundColor: "rgba(33,150,243,0.7)",
      },
      {
        label: "ルート検索",
        data: charts.routes,
        backgroundColor: "rgba(76,175,80,0.7)",
      },
      {
        label: "通話",
        data: charts.calls,
        backgroundColor: "rgba(255,152,0,0.7)",
      },
      {
        label: "メニュー",
        data: charts.foodMenus,
        backgroundColor: "rgba(156,39,176,0.7)",
      },
      {
        label: "予約",
        data: charts.bookings,
        backgroundColor: "rgba(233,69,96,0.7)",
      },
    ],
  };

  const reviewLineData = {
    labels: reviewLabels,
    datasets: [
      {
        label: "累計口コミ数",
        data: reviewCounts,
        borderColor: "#e94560",
        backgroundColor: "rgba(233,69,96,0.1)",
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: "#e94560",
      },
    ],
  };

  const reviewDeltaData = {
    labels: reviewLabels.slice(1),
    datasets: [
      {
        label: "月間増加数",
        data: reviewDelta.slice(1),
        backgroundColor: (reviewDelta.slice(1) as number[]).map((v) =>
          v >= 20 ? "rgba(76,175,80,0.8)" : v >= 15 ? "rgba(255,152,0,0.8)" : "rgba(233,69,96,0.8)"
        ),
        borderRadius: 4,
      },
    ],
  };

  const reviewLineOptions = {
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      legend: {
        position: "top" as const,
        labels: { font: { family: "Noto Sans JP", size: 11 } },
      },
    },
    scales: {
      y: {
        beginAtZero: false,
        grid: { color: "#f0f0f0" },
        ticks: { callback: (v: any) => Number(v).toLocaleString() },
      },
      x: { grid: { display: false } },
    },
  };

  const reviewDeltaOptions = {
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        callbacks: {
          label: (ctx: any) => `増加数: ${ctx.parsed.y}件`,
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        grid: { color: "#f0f0f0" },
        ticks: { stepSize: 5 },
      },
      x: { grid: { display: false } },
    },
  };

  return (
    <div style={{ fontFamily: "'Noto Sans JP', sans-serif" }}>
      {/* Top bar */}
      <div
        className="no-print"
        style={{
          background: "rgba(0,0,0,0.3)",
          padding: "12px 32px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "sticky",
          top: 0,
          zIndex: 100,
          backdropFilter: "blur(10px)",
        }}
      >
        <Link
          href="/report"
          style={{
            color: "rgba(255,255,255,0.8)",
            textDecoration: "none",
            fontSize: 14,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          ← レポート一覧に戻る
        </Link>
        <button
          onClick={() => window.print()}
          style={{
            background: "linear-gradient(135deg, #e94560 0%, #c73050 100%)",
            color: "#fff",
            border: "none",
            padding: "10px 24px",
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            letterSpacing: "0.05em",
          }}
        >
          PDFダウンロード
        </button>
      </div>

      {/* ────── P1: Header + KPI ────── */}
      <div style={slideStyle} className="slide">
        <div
          style={{
            background: "linear-gradient(135deg, #1a1a2e 0%, #0f3460 100%)",
            color: "#fff",
            padding: "28px 36px 20px",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: 11, letterSpacing: "0.15em", color: "rgba(255,255,255,0.5)", marginBottom: 4 }}>
                SPOTLIGHT NAVIGATOR MEO REPORT
              </div>
              <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900, letterSpacing: "0.02em" }}>
                {shop.name}
              </h1>
              <p style={{ margin: "6px 0 0", fontSize: 12, color: "rgba(255,255,255,0.6)" }}>
                {shop.address}
              </p>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>対象期間</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>
                {shop.period.start} - {shop.period.end}
              </div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>
                MEO対策開始: {shop.startDate} / 口コミ {shop.totalReviews.toLocaleString()}件 / ★{shop.rating}
              </div>
            </div>
          </div>
        </div>

        <div style={{ ...slideBodyStyle, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "#1a1a2e", margin: "0 0 20px", textAlign: "center" }}>
            主要KPI サマリー
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
            {kpis.map((kpi, i) => {
              const ch = pctChange(kpi.value, kpi.prevValue);
              return (
                <div
                  key={i}
                  style={{
                    background: kpiColors[i].bg,
                    borderRadius: 12,
                    padding: "18px 16px",
                    color: "#fff",
                    position: "relative",
                    overflow: "hidden",
                  }}
                >
                  <div style={{ position: "absolute", top: -20, right: -20, width: 80, height: 80, borderRadius: "50%", background: "rgba(255,255,255,0.1)" }} />
                  <div style={{ fontSize: 11, fontWeight: 500, opacity: 0.9, marginBottom: 6 }}>{kpi.label}</div>
                  <div style={{ fontSize: 28, fontWeight: 900, lineHeight: 1.1 }}>
                    {kpi.value.toLocaleString()}
                    <span style={{ fontSize: 12, fontWeight: 400, marginLeft: 4 }}>{kpi.unit}</span>
                  </div>
                  <div style={{ fontSize: 11, marginTop: 6, opacity: 0.85 }}>
                    前月: {kpi.prevValue.toLocaleString()}
                    <span
                      style={{
                        marginLeft: 8,
                        padding: "2px 6px",
                        borderRadius: 4,
                        background: "rgba(255,255,255,0.2)",
                        fontSize: 10,
                        fontWeight: 700,
                      }}
                    >
                      {ch.text}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div
          style={{
            background: "#1a1a2e",
            color: "rgba(255,255,255,0.3)",
            textAlign: "center",
            padding: "8px",
            fontSize: 10,
            flexShrink: 0,
          }}
        >
          株式会社Chubby - SPOTLIGHT NAVIGATOR
        </div>
      </div>

      {/* ────── P2: MoM & YoY ────── */}
      <div style={slideStyle} className="slide">
        <div style={headerBarStyle}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>前月比 / 前年比 比較</h2>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>{shop.period.start} - {shop.period.end}</span>
        </div>
        <div style={{ ...slideBodyStyle, display: "flex", gap: 24, overflow: "hidden" }}>
          {/* MoM */}
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#1a1a2e", margin: "0 0 12px", textAlign: "center" }}>
              前月比（MoM）
            </h3>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#0f3460", color: "#fff" }}>
                  <th style={{ padding: "8px 10px", textAlign: "left" }}>指標</th>
                  <th style={{ padding: "8px 10px", textAlign: "right" }}>前月</th>
                  <th style={{ padding: "8px 10px", textAlign: "right" }}>当月</th>
                  <th style={{ padding: "8px 10px", textAlign: "right" }}>増減</th>
                </tr>
              </thead>
              <tbody>
                {momRows.map((r, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#f8f9fa", borderBottom: "1px solid #e8e8e8" }}>
                    <td style={{ padding: "7px 10px", fontWeight: 500 }}>{r.label}</td>
                    <td style={{ padding: "7px 10px", textAlign: "right" }}>{r.prevVal.toLocaleString()}</td>
                    <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 700 }}>{r.curVal.toLocaleString()}</td>
                    <td style={{ padding: "7px 10px", textAlign: "right", color: r.color, fontWeight: 700 }}>{r.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* YoY */}
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#1a1a2e", margin: "0 0 12px", textAlign: "center" }}>
              前年比（YoY）
            </h3>
            {yoyRows.length > 0 ? (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#0f3460", color: "#fff" }}>
                    <th style={{ padding: "8px 10px", textAlign: "left" }}>指標</th>
                    <th style={{ padding: "8px 10px", textAlign: "right" }}>前年同月</th>
                    <th style={{ padding: "8px 10px", textAlign: "right" }}>当月</th>
                    <th style={{ padding: "8px 10px", textAlign: "right" }}>増減</th>
                  </tr>
                </thead>
                <tbody>
                  {yoyRows.map((r, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#f8f9fa", borderBottom: "1px solid #e8e8e8" }}>
                      <td style={{ padding: "7px 10px", fontWeight: 500 }}>{r.label}</td>
                      <td style={{ padding: "7px 10px", textAlign: "right" }}>{r.prevVal.toLocaleString()}</td>
                      <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 700 }}>{r.curVal.toLocaleString()}</td>
                      <td style={{ padding: "7px 10px", textAlign: "right", color: r.color, fontWeight: 700 }}>{r.text}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ textAlign: "center", color: "#999", marginTop: 60, fontSize: 14 }}>
                前年データなし（12ヶ月分のデータが必要です）
              </div>
            )}
          </div>
        </div>
        <div style={{ background: "#1a1a2e", color: "rgba(255,255,255,0.3)", textAlign: "center", padding: "8px", fontSize: 10, flexShrink: 0 }}>
          株式会社Chubby - SPOTLIGHT NAVIGATOR
        </div>
      </div>

      {/* ────── P3: Monthly Table ────── */}
      <div style={slideStyle} className="slide">
        <div style={headerBarStyle}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>月次データ一覧</h2>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>過去12ヶ月</span>
        </div>
        <div style={{ ...slideBodyStyle, padding: "16px 20px", overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.5, lineHeight: 1.3 }}>
            <thead>
              <tr style={{ background: "#0f3460", color: "#fff" }}>
                <th style={{ padding: "7px 6px", textAlign: "center", whiteSpace: "nowrap" }}>月</th>
                <th style={{ padding: "7px 6px", textAlign: "right", whiteSpace: "nowrap" }}>検索(M)</th>
                <th style={{ padding: "7px 6px", textAlign: "right", whiteSpace: "nowrap" }}>検索(PC)</th>
                <th style={{ padding: "7px 6px", textAlign: "right", whiteSpace: "nowrap" }}>検索合計</th>
                <th style={{ padding: "7px 6px", textAlign: "right", whiteSpace: "nowrap" }}>MAP(M)</th>
                <th style={{ padding: "7px 6px", textAlign: "right", whiteSpace: "nowrap" }}>MAP(PC)</th>
                <th style={{ padding: "7px 6px", textAlign: "right", whiteSpace: "nowrap" }}>MAP合計</th>
                <th style={{ padding: "7px 6px", textAlign: "right", whiteSpace: "nowrap" }}>通話</th>
                <th style={{ padding: "7px 6px", textAlign: "right", whiteSpace: "nowrap" }}>ルート</th>
                <th style={{ padding: "7px 6px", textAlign: "right", whiteSpace: "nowrap" }}>Web</th>
                <th style={{ padding: "7px 6px", textAlign: "right", whiteSpace: "nowrap" }}>予約</th>
                <th style={{ padding: "7px 6px", textAlign: "right", whiteSpace: "nowrap" }}>メニュー</th>
                <th style={{ padding: "7px 6px", textAlign: "right", whiteSpace: "nowrap", background: "#1a1a2e" }}>合計</th>
              </tr>
            </thead>
            <tbody>
              {monthlyTableData.map((row, i) => (
                <tr
                  key={i}
                  style={{
                    background: i === monthlyTableData.length - 1 ? "#e3f2fd" : i % 2 === 0 ? "#fff" : "#f8f9fa",
                    fontWeight: i === monthlyTableData.length - 1 ? 700 : 400,
                    borderBottom: "1px solid #e8e8e8",
                  }}
                >
                  <td style={{ padding: "6px", textAlign: "center", whiteSpace: "nowrap" }}>{row.label}</td>
                  <td style={{ padding: "6px", textAlign: "right" }}>{row.searchMobile.toLocaleString()}</td>
                  <td style={{ padding: "6px", textAlign: "right" }}>{row.searchPC.toLocaleString()}</td>
                  <td style={{ padding: "6px", textAlign: "right", fontWeight: 600 }}>{row.searchTotal.toLocaleString()}</td>
                  <td style={{ padding: "6px", textAlign: "right" }}>{row.mapMobile.toLocaleString()}</td>
                  <td style={{ padding: "6px", textAlign: "right" }}>{row.mapPC.toLocaleString()}</td>
                  <td style={{ padding: "6px", textAlign: "right", fontWeight: 600 }}>{row.mapTotal.toLocaleString()}</td>
                  <td style={{ padding: "6px", textAlign: "right" }}>{row.calls.toLocaleString()}</td>
                  <td style={{ padding: "6px", textAlign: "right" }}>{row.routes.toLocaleString()}</td>
                  <td style={{ padding: "6px", textAlign: "right" }}>{row.websites.toLocaleString()}</td>
                  <td style={{ padding: "6px", textAlign: "right" }}>{row.bookings.toLocaleString()}</td>
                  <td style={{ padding: "6px", textAlign: "right" }}>{row.foodMenus.toLocaleString()}</td>
                  <td style={{ padding: "6px", textAlign: "right", fontWeight: 700, background: i === monthlyTableData.length - 1 ? "#bbdefb" : "rgba(15,52,96,0.05)" }}>
                    {row.totalActions.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ background: "#1a1a2e", color: "rgba(255,255,255,0.3)", textAlign: "center", padding: "8px", fontSize: 10, flexShrink: 0 }}>
          株式会社Chubby - SPOTLIGHT NAVIGATOR
        </div>
      </div>

      {/* ────── P4: Search Impressions ────── */}
      <div style={slideStyle} className="slide">
        <div style={headerBarStyle}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Google検索 表示回数</h2>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>モバイル / PC</span>
        </div>
        <div style={{ ...slideBodyStyle, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: "95%", maxHeight: 580 }}>
            <Bar data={searchChartData} options={buildStackedOptions("Google検索 表示回数")} />
          </div>
        </div>
        <div style={{ background: "#1a1a2e", color: "rgba(255,255,255,0.3)", textAlign: "center", padding: "8px", fontSize: 10, flexShrink: 0 }}>
          株式会社Chubby - SPOTLIGHT NAVIGATOR
        </div>
      </div>

      {/* ────── P5: Maps Impressions ────── */}
      <div style={slideStyle} className="slide">
        <div style={headerBarStyle}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Googleマップ 表示回数</h2>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>モバイル / PC</span>
        </div>
        <div style={{ ...slideBodyStyle, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: "95%", maxHeight: 580 }}>
            <Bar data={mapChartData} options={buildStackedOptions("Googleマップ 表示回数")} />
          </div>
        </div>
        <div style={{ background: "#1a1a2e", color: "rgba(255,255,255,0.3)", textAlign: "center", padding: "8px", fontSize: 10, flexShrink: 0 }}>
          株式会社Chubby - SPOTLIGHT NAVIGATOR
        </div>
      </div>

      {/* ────── P6: User Actions ────── */}
      <div style={slideStyle} className="slide">
        <div style={headerBarStyle}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>ユーザーアクション推移</h2>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>Web / ルート / 通話 / メニュー / 予約</span>
        </div>
        <div style={{ ...slideBodyStyle, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: "95%", maxHeight: 580 }}>
            <Bar data={actionChartData} options={buildStackedOptions("ユーザーアクション")} />
          </div>
        </div>
        <div style={{ background: "#1a1a2e", color: "rgba(255,255,255,0.3)", textAlign: "center", padding: "8px", fontSize: 10, flexShrink: 0 }}>
          株式会社Chubby - SPOTLIGHT NAVIGATOR
        </div>
      </div>

      {/* ────── P7: Keywords (skip if no data) ────── */}
      {hasKeywords && (
        <div style={slideStyle} className="slide">
          <div style={headerBarStyle}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>キーワード順位</h2>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>主要キーワード推移</span>
          </div>
          <div style={{ ...slideBodyStyle, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20, width: "100%" }}>
              {keywords.map((kw, i) => {
                const diff = kw.prevRank - kw.rank;
                const arrow = diff > 0 ? "↑" : diff < 0 ? "↓" : "→";
                const arrowColor = diff > 0 ? "#388e3c" : diff < 0 ? "#d32f2f" : "#666";
                return (
                  <div
                    key={i}
                    style={{
                      background: "#fff",
                      borderRadius: 12,
                      padding: 24,
                      textAlign: "center",
                      boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a2e", marginBottom: 12 }}>
                      {kw.word}
                    </div>
                    <div style={{ fontSize: 48, fontWeight: 900, color: "#0f3460", lineHeight: 1 }}>
                      {kw.rank}
                      <span style={{ fontSize: 16, fontWeight: 400, color: "#999" }}>位</span>
                    </div>
                    <div style={{ marginTop: 10, fontSize: 13, color: arrowColor, fontWeight: 700 }}>
                      {arrow} {Math.abs(diff)}ランク{diff > 0 ? "UP" : diff < 0 ? "DOWN" : ""}
                    </div>
                    <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>前月: {kw.prevRank}位</div>
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ background: "#1a1a2e", color: "rgba(255,255,255,0.3)", textAlign: "center", padding: "8px", fontSize: 10, flexShrink: 0 }}>
            株式会社Chubby - SPOTLIGHT NAVIGATOR
          </div>
        </div>
      )}

      {/* ────── P8: Review Count Trend ────── */}
      <div style={slideStyle} className="slide">
        <div style={headerBarStyle}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>口コミ件数推移</h2>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>累計口コミ数</span>
        </div>
        <div style={{ ...slideBodyStyle, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: "95%", maxHeight: 580 }}>
            <Line data={reviewLineData} options={reviewLineOptions} />
          </div>
        </div>
        <div style={{ background: "#1a1a2e", color: "rgba(255,255,255,0.3)", textAlign: "center", padding: "8px", fontSize: 10, flexShrink: 0 }}>
          株式会社Chubby - SPOTLIGHT NAVIGATOR
        </div>
      </div>

      {/* ────── P9: Monthly Review Increase ────── */}
      <div style={slideStyle} className="slide">
        <div style={headerBarStyle}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>月間口コミ増加数</h2>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>
            <span style={{ color: "rgba(76,175,80,0.9)" }}>■</span> 20件以上&nbsp;
            <span style={{ color: "rgba(255,152,0,0.9)" }}>■</span> 15-19件&nbsp;
            <span style={{ color: "rgba(233,69,96,0.9)" }}>■</span> 15件未満
          </span>
        </div>
        <div style={{ ...slideBodyStyle, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: "95%", maxHeight: 580 }}>
            <Bar data={reviewDeltaData} options={reviewDeltaOptions} />
          </div>
        </div>
        <div style={{ background: "#1a1a2e", color: "rgba(255,255,255,0.3)", textAlign: "center", padding: "8px", fontSize: 10, flexShrink: 0 }}>
          株式会社Chubby - SPOTLIGHT NAVIGATOR
        </div>
      </div>

      {/* ────── P10: Review Analysis ────── */}
      <div style={slideStyle} className="slide">
        <div style={headerBarStyle}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>口コミ分析</h2>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>ポジティブ / ネガティブ要素</span>
        </div>
        <div style={{ ...slideBodyStyle, display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", gap: 24, flex: 1 }}>
            {/* Positive */}
            <div
              style={{
                flex: 1,
                background: "#fff",
                borderRadius: 12,
                padding: 24,
                boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
                borderTop: "4px solid #4caf50",
              }}
            >
              <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700, color: "#388e3c" }}>
                ポジティブワード
              </h3>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {reviewAnalysis.positiveWords.map((w, i) => (
                  <span
                    key={i}
                    style={{
                      display: "inline-block",
                      background: "#e8f5e9",
                      color: "#2e7d32",
                      padding: "8px 16px",
                      borderRadius: 20,
                      fontSize: 13,
                      fontWeight: 500,
                    }}
                  >
                    {w}
                  </span>
                ))}
              </div>
            </div>

            {/* Negative */}
            <div
              style={{
                flex: 1,
                background: "#fff",
                borderRadius: 12,
                padding: 24,
                boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
                borderTop: "4px solid #f44336",
              }}
            >
              <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700, color: "#c62828" }}>
                ネガティブワード
              </h3>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {reviewAnalysis.negativeWords.map((w, i) => (
                  <span
                    key={i}
                    style={{
                      display: "inline-block",
                      background: "#ffebee",
                      color: "#c62828",
                      padding: "8px 16px",
                      borderRadius: 20,
                      fontSize: 13,
                      fontWeight: 500,
                    }}
                  >
                    {w}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Summary */}
          <div
            style={{
              background: "#fff",
              borderRadius: 12,
              padding: 24,
              boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
              borderLeft: "4px solid #0f3460",
            }}
          >
            <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700, color: "#1a1a2e" }}>
              総合分析
            </h3>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.8, color: "#333" }}>
              {reviewAnalysis.summary}
            </p>
          </div>
        </div>
        <div style={{ background: "#1a1a2e", color: "rgba(255,255,255,0.3)", textAlign: "center", padding: "8px", fontSize: 10, flexShrink: 0 }}>
          株式会社Chubby - SPOTLIGHT NAVIGATOR
        </div>
      </div>

      {/* ────── P11: Staff Comments ────── */}
      <div style={slideStyle} className="slide">
        <div style={headerBarStyle}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>担当者コメント</h2>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>今月の所感と来月の施策</span>
        </div>
        <div style={{ ...slideBodyStyle, display: "flex", flexDirection: "column", justifyContent: "center", gap: 16, padding: "28px 48px" }}>
          {comments.map((comment, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                gap: 16,
                alignItems: "flex-start",
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  background: "linear-gradient(135deg, #0f3460, #1a1a2e)",
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {i + 1}
              </div>
              <div
                style={{
                  flex: 1,
                  background: "#fff",
                  borderRadius: 10,
                  padding: "14px 20px",
                  fontSize: 13,
                  lineHeight: 1.8,
                  color: "#333",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
                }}
              >
                {comment}
              </div>
            </div>
          ))}
        </div>
        <div style={{ background: "#1a1a2e", color: "rgba(255,255,255,0.3)", textAlign: "center", padding: "8px", fontSize: 10, flexShrink: 0 }}>
          株式会社Chubby - SPOTLIGHT NAVIGATOR
        </div>
      </div>
    </div>
  );
}
