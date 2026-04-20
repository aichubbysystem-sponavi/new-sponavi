"use client";

import { useState, useEffect } from "react";
import DOMPurify from "isomorphic-dompurify";
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
  padding: "12px 36px", fontSize: 14, fontWeight: 700,
  display: "flex", justifyContent: "space-between", alignItems: "center",
  flexShrink: 0, letterSpacing: 0.5,
};

const slideBodyStyle: React.CSSProperties = {
  flex: 1, padding: "28px 36px", display: "flex", flexDirection: "column",
  justifyContent: "center", overflow: "hidden",
};

const stitleStyle: React.CSSProperties = {
  fontSize: 17, fontWeight: 700, color: "#0f3460",
  borderLeft: "4px solid #e94560", paddingLeft: 12, marginBottom: 16,
};

const footerStyle: React.CSSProperties = {
  background: "#1a1a2e", color: "rgba(255,255,255,0.3)", textAlign: "center",
  padding: 8, fontSize: 10, flexShrink: 0,
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

function pctChange(cur: number, prev: number): { pct: number; text: string; isUp: boolean } {
  if (prev === 0 && cur === 0) return { pct: 0, text: "±0.0%", isUp: true };
  if (prev === 0) return { pct: 999, text: "+∞", isUp: true };
  const pct = ((cur - prev) / prev) * 100;
  return { pct, text: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`, isUp: pct >= 0 };
}

function buildStackedOptions() {
  return {
    responsive: true, maintainAspectRatio: true,
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

// ── Component ──

export default function ReportClient({
  data, shopId, dataSource = "mock",
}: {
  data: ReportData; shopId: string; dataSource?: "spreadsheet" | "mock";
}) {
  const { shop, kpis, monthlyLabels, charts, keywords, rankingHistory, reviewLabels, reviewCounts, reviewDelta, reviewAnalysis, comments, searchQueries } = data;
  const hasKeywords = keywords.length > 0;
  const hasRankingHistory = rankingHistory && rankingHistory.labels.length > 0;
  const hasReviews = reviewCounts.length > 0;
  const hasSearchQueries = searchQueries && searchQueries.latest.length > 0;
  const curLabel = monthlyLabels[monthlyLabels.length - 1] || "";
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [memo, setMemo] = useState("");
  const [memoSaved, setMemoSaved] = useState(false);
  const [memoEditing, setMemoEditing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // セクション表示ON/OFF（店舗ごとにlocalStorage保存）
  const visKey = `report-visibility-${shopId}`;
  const [sectionVisibility, setSectionVisibility] = useState<Record<string, boolean>>({
    keywords: true,       // キーワード順位変動
    rankingHistory: true, // 順位推移テーブル
    searchQueries: true,  // 検索語句
  });

  useEffect(() => {
    try {
      const saved = localStorage.getItem(visKey);
      if (saved) setSectionVisibility(JSON.parse(saved));
    } catch {}
  }, [visKey]);

  const toggleSection = (key: string) => {
    setSectionVisibility(prev => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem(visKey, JSON.stringify(next));
      return next;
    });
  };

  const showKeywords = sectionVisibility.keywords !== false && hasKeywords;
  const showRankingHistory = sectionVisibility.rankingHistory !== false && hasRankingHistory;
  const showSearchQueries = sectionVisibility.searchQueries !== false && hasSearchQueries;

  // メモをlocalStorageから読み込み
  const memoKey = `report-memo-${shopId}-${data.monthlyLabels[data.monthlyLabels.length - 1] || ""}`;
  useEffect(() => {
    const saved = localStorage.getItem(memoKey);
    if (saved) setMemo(saved);
  }, [memoKey]);

  const saveMemo = () => {
    localStorage.setItem(memoKey, memo);
    setMemoSaved(true);
    setMemoEditing(false);
    setTimeout(() => setMemoSaved(false), 2000);
  };

  const handlePdfDownload = async () => {
    setPdfGenerating(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const { jsPDF } = await import("jspdf");
      const slides = document.querySelectorAll(".slide");
      if (slides.length === 0) { setPdfGenerating(false); return; }

      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pdfW = 297;
      const pdfH = 210;

      for (let i = 0; i < slides.length; i++) {
        const canvas = await html2canvas(slides[i] as HTMLElement, {
          scale: 2,
          useCORS: true,
          logging: false,
          backgroundColor: "#f0f2f5",
        });
        const imgData = canvas.toDataURL("image/jpeg", 0.92);
        if (i > 0) pdf.addPage();
        pdf.addImage(imgData, "JPEG", 0, 0, pdfW, pdfH);
      }

      pdf.save(`${shop.name}_レポート_${curLabel.replace("/", "-")}.pdf`);
    } catch (err) {
      console.error("PDF generation error:", err);
      window.print(); // フォールバック
    } finally {
      setPdfGenerating(false);
    }
  };

  // ── Page count ──
  let totalPages = 10; // P1-P6, P8-P11
  if (showKeywords) totalPages++;
  if (showRankingHistory) totalPages++;
  if (showSearchQueries) totalPages++;

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

  // ── Comparison rows ──
  const curIdx = monthlyLabels.length - 1;
  const prevIdx = curIdx - 1;
  const yoyIdx = curIdx - 12 >= 0 ? curIdx - 12 : -1;

  function cmpRow(label: string, cur: number, prev: number) {
    const c = pctChange(cur, prev);
    return { label, cur, prev, ...c };
  }

  const cmpMetrics = [
    { label: "Google検索合計", cur: (i: number) => charts.searchMobile[i] + charts.searchPC[i] },
    { label: "Googleマップ合計", cur: (i: number) => charts.mapMobile[i] + charts.mapPC[i] },
    { label: "ウェブサイト", cur: (i: number) => charts.websites[i] },
    { label: "ルート", cur: (i: number) => charts.routes[i] },
    { label: "通話", cur: (i: number) => charts.calls[i] },
    { label: "メニュークリック", cur: (i: number) => charts.foodMenus[i] },
    { label: "予約", cur: (i: number) => charts.bookings[i] },
  ];

  const momRows = prevIdx >= 0 ? cmpMetrics.map(m => cmpRow(m.label, m.cur(curIdx), m.cur(prevIdx))) : [];
  const yoyRows = yoyIdx >= 0 ? cmpMetrics.map(m => cmpRow(m.label, m.cur(curIdx), m.cur(yoyIdx))) : [];

  // ── Page numbering tracker ──
  let pageNum = 1;

  return (
    <div style={{ fontFamily: "'Noto Sans JP', sans-serif", background: "#1a1a2e" }}>
      {/* Top bar (no-print) */}
      <div className="no-print" style={{ background: "rgba(0,0,0,0.3)", padding: "12px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100, backdropFilter: "blur(10px)" }}>
        <Link href="/report" style={{ color: "rgba(255,255,255,0.8)", textDecoration: "none", fontSize: 14 }}>← レポート一覧に戻る</Link>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {dataSource === "mock" && <span style={{ fontSize: 11, color: "#ffd54f", background: "rgba(255,213,79,0.15)", padding: "4px 12px", borderRadius: 20, border: "1px solid rgba(255,213,79,0.3)" }}>デモデータ</span>}
          <button onClick={() => setShowSettings(!showSettings)} style={{ background: "rgba(255,255,255,0.15)", color: "#fff", border: "1px solid rgba(255,255,255,0.3)", padding: "10px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            表示設定
          </button>
          <button onClick={handlePdfDownload} disabled={pdfGenerating} style={{ background: pdfGenerating ? "#999" : "linear-gradient(135deg,#e94560,#c73050)", color: "#fff", border: "none", padding: "10px 24px", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: pdfGenerating ? "wait" : "pointer" }}>
            {pdfGenerating ? "PDF生成中..." : "PDFダウンロード"}
          </button>
        </div>
      </div>

      {/* 表示設定パネル */}
      {showSettings && (
        <div className="no-print" style={{ background: "#1a1a2e", padding: "16px 32px", display: "flex", alignItems: "center", gap: 24, borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
          <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 12, fontWeight: 600 }}>表示ON/OFF:</span>
          {[
            { key: "keywords", label: "キーワード順位", hasData: hasKeywords },
            { key: "rankingHistory", label: "順位推移テーブル", hasData: hasRankingHistory },
            { key: "searchQueries", label: "検索語句", hasData: hasSearchQueries },
          ].map(item => (
            <label key={item.key} style={{ display: "flex", alignItems: "center", gap: 6, cursor: item.hasData ? "pointer" : "not-allowed", opacity: item.hasData ? 1 : 0.4 }}>
              <input type="checkbox" checked={sectionVisibility[item.key] !== false && item.hasData} disabled={!item.hasData}
                onChange={() => toggleSection(item.key)}
                style={{ width: 16, height: 16, cursor: item.hasData ? "pointer" : "not-allowed" }} />
              <span style={{ color: "#fff", fontSize: 13 }}>{item.label}</span>
              {!item.hasData && <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 10 }}>（データなし）</span>}
            </label>
          ))}
        </div>
      )}

      {/* ════ P1: ヘッダー + KPI ════ */}
      <div style={slideStyle} className="slide">
        <div style={{ background: "linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%)", color: "#fff", padding: "28px 36px 20px", flexShrink: 0, position: "relative" }}>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900, letterSpacing: 1 }}>{shop.name}</h1>
          <div style={{ fontSize: 13, opacity: 0.7, marginTop: 2 }}>MEO対策 レポート報告</div>
          <div style={{ fontSize: 12, opacity: 0.5, marginTop: 6 }}>{shop.address}</div>
          <div style={{ position: "absolute", top: 28, right: 36, background: "rgba(255,255,255,.12)", padding: "7px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600 }}>{shop.period.start} - {shop.period.end}</div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: "10px 36px", background: "#e8eaf0", flexShrink: 0 }}>
          {[{ lb: "対策開始日", vl: shop.startDate }, { lb: "レポート対象", vl: curLabel }, { lb: "口コミ合計", vl: `${shop.totalReviews.toLocaleString()}件` }, { lb: "評価", vl: String(shop.rating) }].map((b, i) => (
            <div key={i} style={{ background: "#fff", borderRadius: 10, padding: "7px 14px", fontSize: 12, display: "flex", alignItems: "center", gap: 5, boxShadow: "0 1px 3px rgba(0,0,0,.05)" }}>
              <span style={{ color: "#888" }}>{b.lb}</span><span style={{ fontWeight: 700 }}>{b.vl}</span>
            </div>
          ))}
        </div>
        <div style={{ flex: 1, padding: "16px 36px 20px", display: "flex", flexDirection: "column", justifyContent: "stretch", overflow: "hidden" }}>
          <div style={{ ...stitleStyle, marginBottom: 14 }}>主要指標サマリー（{curLabel}）</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, flex: 1 }}>
            {kpis.map((kpi, i) => {
              const isLastKpi = i === kpis.length - 1; // 口コミ増減カード
              const c = pctChange(kpi.value, kpi.prevValue);
              return (
                <div key={i} style={{ background: "#fff", borderRadius: 12, padding: "20px 20px", position: "relative", overflow: "hidden", boxShadow: "0 1px 6px rgba(0,0,0,.04)", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                  <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: 3, background: kpiTopColors[i] }} />
                  <div style={{ fontSize: 11, color: "#888", fontWeight: 500 }}>{kpi.label}</div>
                  <div style={{ fontSize: 28, fontWeight: 900, lineHeight: 1.1, margin: "4px 0" }}>
                    {isLastKpi ? `${kpi.value >= 0 ? "+" : ""}${kpi.value.toLocaleString()}件` : kpi.value.toLocaleString()}
                  </div>
                  <div style={{ fontSize: 11, color: "#aaa" }}>
                    {isLastKpi ? (
                      <span>累計: {shop.totalReviews.toLocaleString()}件（評価 {shop.rating}）</span>
                    ) : kpi.label.includes("検索") || kpi.label.includes("マップ") ? (
                      <><span style={{ marginRight: 6 }}>モバイル: {i === 0 ? charts.searchMobile[charts.searchMobile.length-1]?.toLocaleString() : charts.mapMobile[charts.mapMobile.length-1]?.toLocaleString()}</span><span>PC: {i === 0 ? charts.searchPC[charts.searchPC.length-1]?.toLocaleString() : charts.mapPC[charts.mapPC.length-1]?.toLocaleString()}</span></>
                    ) : (
                      <span>&nbsp;</span>
                    )}
                  </div>
                  <span style={{ display: "inline-block", marginTop: 6, padding: "3px 8px", borderRadius: 16, fontSize: 10, fontWeight: 600, background: isLastKpi ? (kpi.value >= 0 ? "#e6f9ee" : "#fde8e8") : (c.isUp ? "#e6f9ee" : "#fde8e8"), color: isLastKpi ? (kpi.value >= 0 ? "#0a8f3c" : "#c0392b") : (c.isUp ? "#0a8f3c" : "#c0392b"), alignSelf: "flex-start" }}>
                    {isLastKpi
                      ? `${kpi.value >= 0 ? "▲" : "▼"} ${(shop.totalReviews - kpi.value).toLocaleString()}→${shop.totalReviews.toLocaleString()}件`
                      : `${c.isUp ? "▲" : "▼"} ${c.text}（${kpi.prevValue.toLocaleString()}→${kpi.value.toLocaleString()}）`
                    }
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ════ P2: 前月比・前年比 ════ */}
      {(() => { pageNum = 2; return null; })()}
      <div style={slideStyle} className="slide">
        <div style={slideBarStyle}><span>{shop.name} — 前月比・前年比</span><span style={{ fontSize: 11, opacity: 0.45, fontWeight: 400 }}>{pn(pageNum)}</span></div>
        <div style={slideBodyStyle}>
          <div style={stitleStyle}>前月比・前年比</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, flex: 1 }}>
            <div style={{ background: "#fff", borderRadius: 12, padding: "28px 32px", boxShadow: "0 1px 6px rgba(0,0,0,.04)", display: "flex", flexDirection: "column" }}>
              <h4 style={{ fontSize: 16, fontWeight: 600, color: "#555", marginBottom: 18 }}>前月比（{prevIdx >= 0 ? monthlyLabels[prevIdx] : "—"} → {curLabel}）</h4>
              {momRows.map((r, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 0, fontSize: 14, flex: 1 }}>
                  <span style={{ color: "#444" }}>{r.label}</span>
                  <span style={{ display: "inline-block", padding: "3px 8px", borderRadius: 16, fontSize: 10, fontWeight: 600, background: r.isUp ? "#e6f9ee" : "#fde8e8", color: r.isUp ? "#0a8f3c" : "#c0392b" }}>
                    {r.isUp ? "▲" : "▼"} {r.prev.toLocaleString()}→{r.cur.toLocaleString()}（{r.text}）
                  </span>
                </div>
              ))}
            </div>
            <div style={{ background: "#fff", borderRadius: 12, padding: "28px 32px", boxShadow: "0 1px 6px rgba(0,0,0,.04)", display: "flex", flexDirection: "column" }}>
              <h4 style={{ fontSize: 16, fontWeight: 600, color: "#555", marginBottom: 18 }}>前年比（{yoyIdx >= 0 ? monthlyLabels[yoyIdx] : "—"} → {curLabel}）</h4>
              {yoyRows.length > 0 ? yoyRows.map((r, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 0, fontSize: 14, flex: 1 }}>
                  <span style={{ color: "#444" }}>{r.label}</span>
                  <span style={{ display: "inline-block", padding: "3px 8px", borderRadius: 16, fontSize: 10, fontWeight: 600, background: r.isUp ? "#e6f9ee" : "#fde8e8", color: r.isUp ? "#0a8f3c" : "#c0392b" }}>
                    {r.isUp ? "▲" : "▼"} {r.prev.toLocaleString()}→{r.cur.toLocaleString()}（{r.text}）
                  </span>
                </div>
              )) : <div style={{ textAlign: "center", color: "#999", marginTop: 40, fontSize: 14 }}>前年データなし（12ヶ月分のデータが必要です）</div>}
            </div>
          </div>
        </div>
      </div>

      {/* ════ P3: 月次テーブル ════ */}
      {(() => { pageNum = 3; return null; })()}
      <div style={slideStyle} className="slide">
        <div style={slideBarStyle}><span>{shop.name} — 月次推移データ</span><span style={{ fontSize: 11, opacity: 0.45, fontWeight: 400 }}>{pn(pageNum)}</span></div>
        <div style={slideBodyStyle}>
          <div style={stitleStyle}>月次推移データ（直近12ヶ月）</div>
          <div style={{ overflow: "hidden", borderRadius: 12, boxShadow: "0 1px 6px rgba(0,0,0,.04)", flex: 1, display: "flex", flexDirection: "column" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", fontSize: 13, flex: 1 }}>
              <thead><tr>
                {["月","検索モバイル","検索PC","検索合計","マップモバイル","マップPC","マップ合計","Web","ルート","通話","メニュー","予約","合計"].map((h,i) => (
                  <th key={i} style={{ background: "#0f3460", color: "#fff", padding: "12px 10px", textAlign: "center", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {monthlyTableData.map((r, i) => {
                  const isLast = i === monthlyTableData.length - 1;
                  return (
                    <tr key={i} style={{ background: isLast ? "#f0f4ff" : undefined, fontWeight: isLast ? 600 : undefined }}>
                      <td style={{ padding: "10px 10px", textAlign: "center", borderBottom: "1px solid #f0f0f0" }}>{r.label}</td>
                      <td style={{ padding: "10px 10px", textAlign: "center", borderBottom: "1px solid #f0f0f0" }}>{r.searchMobile.toLocaleString()}</td>
                      <td style={{ padding: "10px 10px", textAlign: "center", borderBottom: "1px solid #f0f0f0" }}>{r.searchPC.toLocaleString()}</td>
                      <td style={{ padding: "10px 10px", textAlign: "center", borderBottom: "1px solid #f0f0f0" }}>{r.searchTotal.toLocaleString()}</td>
                      <td style={{ padding: "10px 10px", textAlign: "center", borderBottom: "1px solid #f0f0f0" }}>{r.mapMobile.toLocaleString()}</td>
                      <td style={{ padding: "10px 10px", textAlign: "center", borderBottom: "1px solid #f0f0f0" }}>{r.mapPC.toLocaleString()}</td>
                      <td style={{ padding: "10px 10px", textAlign: "center", borderBottom: "1px solid #f0f0f0" }}>{r.mapTotal.toLocaleString()}</td>
                      <td style={{ padding: "10px 10px", textAlign: "center", borderBottom: "1px solid #f0f0f0" }}>{r.websites.toLocaleString()}</td>
                      <td style={{ padding: "10px 10px", textAlign: "center", borderBottom: "1px solid #f0f0f0" }}>{r.routes.toLocaleString()}</td>
                      <td style={{ padding: "10px 10px", textAlign: "center", borderBottom: "1px solid #f0f0f0" }}>{r.calls.toLocaleString()}</td>
                      <td style={{ padding: "10px 10px", textAlign: "center", borderBottom: "1px solid #f0f0f0" }}>{r.foodMenus.toLocaleString()}</td>
                      <td style={{ padding: "10px 10px", textAlign: "center", borderBottom: "1px solid #f0f0f0" }}>{r.bookings.toLocaleString()}</td>
                      <td style={{ padding: "10px 10px", textAlign: "center", borderBottom: "1px solid #f0f0f0", fontWeight: 700 }}>{r.totalActions.toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ════ P4: Google検索数推移 ════ */}
      {(() => { pageNum = 4; return null; })()}
      <div style={slideStyle} className="slide">
        <div style={slideBarStyle}><span>{shop.name} — Google検索数推移</span><span style={{ fontSize: 11, opacity: 0.45, fontWeight: 400 }}>{pn(pageNum)}</span></div>
        <div style={slideBodyStyle}>
          <div style={{ width: "95%", margin: "0 auto" }}>
            <Bar data={{ labels: monthlyLabels, datasets: [
              { label: "モバイル", data: charts.searchMobile, backgroundColor: "rgba(79,195,247,.75)" },
              { label: "PC", data: charts.searchPC, backgroundColor: "rgba(2,136,209,.75)" },
            ]}} options={buildStackedOptions()} />
          </div>
          <table style={{ width: "95%", margin: "8px auto 0", borderCollapse: "collapse", fontSize: 9 }}>
            <tbody>
              <tr style={{ background: "#f8f9fa" }}>
                <td style={{ padding: "3px 4px", fontWeight: 600, color: "#666", width: 60 }}>月</td>
                {monthlyLabels.map((l, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center", color: "#888" }}>{l.replace(/^\d{4}\//, "")}</td>)}
              </tr>
              <tr><td style={{ padding: "3px 4px", fontWeight: 600, color: "#666" }}>モバイル</td>
                {charts.searchMobile.map((v, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center" }}>{v.toLocaleString()}</td>)}</tr>
              <tr style={{ background: "#f8f9fa" }}><td style={{ padding: "3px 4px", fontWeight: 600, color: "#666" }}>PC</td>
                {charts.searchPC.map((v, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center" }}>{v.toLocaleString()}</td>)}</tr>
              <tr><td style={{ padding: "3px 4px", fontWeight: 700, color: "#333" }}>合計</td>
                {charts.searchMobile.map((v, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center", fontWeight: 700 }}>{(v + charts.searchPC[i]).toLocaleString()}</td>)}</tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ════ P5: Googleマップ表示数推移 ════ */}
      {(() => { pageNum = 5; return null; })()}
      <div style={slideStyle} className="slide">
        <div style={slideBarStyle}><span>{shop.name} — Googleマップ表示数推移</span><span style={{ fontSize: 11, opacity: 0.45, fontWeight: 400 }}>{pn(pageNum)}</span></div>
        <div style={slideBodyStyle}>
          <div style={{ width: "95%", margin: "0 auto" }}>
            <Bar data={{ labels: monthlyLabels, datasets: [
              { label: "モバイル", data: charts.mapMobile, backgroundColor: "rgba(129,199,132,.75)" },
              { label: "PC", data: charts.mapPC, backgroundColor: "rgba(56,142,60,.75)" },
            ]}} options={buildStackedOptions()} />
          </div>
          <table style={{ width: "95%", margin: "8px auto 0", borderCollapse: "collapse", fontSize: 9 }}>
            <tbody>
              <tr style={{ background: "#f8f9fa" }}>
                <td style={{ padding: "3px 4px", fontWeight: 600, color: "#666", width: 60 }}>月</td>
                {monthlyLabels.map((l, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center", color: "#888" }}>{l.replace(/^\d{4}\//, "")}</td>)}
              </tr>
              <tr><td style={{ padding: "3px 4px", fontWeight: 600, color: "#666" }}>モバイル</td>
                {charts.mapMobile.map((v, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center" }}>{v.toLocaleString()}</td>)}</tr>
              <tr style={{ background: "#f8f9fa" }}><td style={{ padding: "3px 4px", fontWeight: 600, color: "#666" }}>PC</td>
                {charts.mapPC.map((v, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center" }}>{v.toLocaleString()}</td>)}</tr>
              <tr><td style={{ padding: "3px 4px", fontWeight: 700, color: "#333" }}>合計</td>
                {charts.mapMobile.map((v, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center", fontWeight: 700 }}>{(v + charts.mapPC[i]).toLocaleString()}</td>)}</tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ════ P6: ユーザー反応数推移 ════ */}
      {(() => { pageNum = 6; return null; })()}
      <div style={slideStyle} className="slide">
        <div style={slideBarStyle}><span>{shop.name} — ユーザー反応数推移</span><span style={{ fontSize: 11, opacity: 0.45, fontWeight: 400 }}>{pn(pageNum)}</span></div>
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
          <table style={{ width: "95%", margin: "8px auto 0", borderCollapse: "collapse", fontSize: 9 }}>
            <tbody>
              <tr style={{ background: "#f8f9fa" }}>
                <td style={{ padding: "3px 4px", fontWeight: 600, color: "#666", width: 60 }}>月</td>
                {monthlyLabels.map((l, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center", color: "#888" }}>{l.replace(/^\d{4}\//, "")}</td>)}
              </tr>
              <tr><td style={{ padding: "3px 4px", fontWeight: 600, color: "#666" }}>Web</td>
                {charts.websites.map((v, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center" }}>{v.toLocaleString()}</td>)}</tr>
              <tr style={{ background: "#f8f9fa" }}><td style={{ padding: "3px 4px", fontWeight: 600, color: "#666" }}>ルート</td>
                {charts.routes.map((v, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center" }}>{v.toLocaleString()}</td>)}</tr>
              <tr><td style={{ padding: "3px 4px", fontWeight: 600, color: "#666" }}>通話</td>
                {charts.calls.map((v, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center" }}>{v.toLocaleString()}</td>)}</tr>
              <tr style={{ background: "#f8f9fa" }}><td style={{ padding: "3px 4px", fontWeight: 600, color: "#666" }}>メニュー</td>
                {charts.foodMenus.map((v, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center" }}>{v.toLocaleString()}</td>)}</tr>
              <tr><td style={{ padding: "3px 4px", fontWeight: 600, color: "#666" }}>予約</td>
                {charts.bookings.map((v, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center" }}>{v.toLocaleString()}</td>)}</tr>
              <tr style={{ background: "#e8eaf6" }}><td style={{ padding: "3px 4px", fontWeight: 700, color: "#333" }}>合計</td>
                {charts.websites.map((v, i) => <td key={i} style={{ padding: "3px 2px", textAlign: "center", fontWeight: 700 }}>{(v + charts.routes[i] + charts.calls[i] + charts.foodMenus[i] + charts.bookings[i]).toLocaleString()}</td>)}</tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ════ P7: キーワード順位 (データある場合のみ) ════ */}
      {showKeywords && (() => { pageNum = 7; return (
        <div style={slideStyle} className="slide">
          <div style={slideBarStyle}><span>{shop.name} — キーワード順位変動</span><span style={{ fontSize: 11, opacity: 0.45, fontWeight: 400 }}>{pn(pageNum)}</span></div>
          <div style={slideBodyStyle}>
            <div style={stitleStyle}>キーワード順位変動</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, flex: 1 }}>
              {keywords.map((kw, i) => {
                const diff = kw.prevRank - kw.rank;
                const arrow = diff > 0 ? "↑" : diff < 0 ? "↓" : "→";
                const arrowColor = diff > 0 ? "#0a8f3c" : diff < 0 ? "#c0392b" : "#888";
                return (
                  <div key={i} style={{ background: "#fff", borderRadius: 12, padding: "24px 28px", boxShadow: "0 1px 6px rgba(0,0,0,.04)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>{kw.word}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 13, color: "#999" }}>前月{kw.prevRank}位</span>
                      <span style={{ fontSize: 22, color: arrowColor }}>{arrow}</span>
                      <span style={{ fontSize: 36, fontWeight: 900, color: "#e94560" }}>{kw.rank}</span>
                      <span style={{ fontSize: 14, color: "#666" }}>位</span>
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
          <div style={slideBarStyle}><span>{shop.name} — キーワード順位推移</span><span style={{ fontSize: 11, opacity: 0.45, fontWeight: 400 }}>{pn(pageNum)}</span></div>
          <div style={{ ...slideBodyStyle, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={stitleStyle}>キーワード順位推移（直近{rankingHistory.labels.length}ヶ月）</div>
            <div style={{ overflow: "hidden", borderRadius: 12, boxShadow: "0 1px 6px rgba(0,0,0,.04)", flex: 1, display: "flex", flexDirection: "column" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", flex: 1 }}>
                <thead>
                  <tr>
                    <th style={{ background: "#0f3460", color: "#fff", padding: "12px 12px", textAlign: "left", fontWeight: 600, whiteSpace: "nowrap", fontSize: 12, position: "sticky", left: 0 }}>キーワード</th>
                    {rankingHistory.labels.map((l, i) => (
                      <th key={i} style={{ background: i === rankingHistory.labels.length - 1 ? "#e94560" : "#0f3460", color: "#fff", padding: "12px 8px", textAlign: "center", fontWeight: 600, whiteSpace: "nowrap", fontSize: 12 }}>
                        {l.replace(/^\d{4}\//, "")}月
                      </th>
                    ))}
                    <th style={{ background: "#0f3460", color: "#fff", padding: "12px 8px", textAlign: "center", fontWeight: 600, fontSize: 11 }}>変動</th>
                  </tr>
                </thead>
                <tbody>
                  {rankingHistory.datasets.map((ds, di) => {
                    const validRanks = ds.ranks.filter((r): r is number => r !== null);
                    const latest = validRanks.length > 0 ? validRanks[validRanks.length - 1] : null;
                    const prev = validRanks.length > 1 ? validRanks[validRanks.length - 2] : null;
                    const diff = latest !== null && prev !== null ? prev - latest : 0;
                    return (
                      <tr key={di} style={{ background: di % 2 === 0 ? "#fff" : "#f8f9fb" }}>
                        <td style={{ padding: "10px 12px", fontWeight: 700, color: "#333", whiteSpace: "nowrap", borderBottom: "1px solid #eee", fontSize: 13 }}>{ds.word}</td>
                        {ds.ranks.map((r, ri) => {
                          const isLatest = ri === rankingHistory.labels.length - 1;
                          return (
                            <td key={ri} style={{
                              padding: "10px 8px", textAlign: "center", borderBottom: "1px solid #eee", fontSize: 15,
                              fontWeight: r !== null && r <= 3 ? 900 : isLatest ? 700 : 400,
                              color: r === null ? "#ddd" : r <= 3 ? "#0a8f3c" : r <= 5 ? "#0f3460" : r <= 10 ? "#555" : "#999",
                              background: isLatest ? "#fff8f0" : undefined,
                            }}>
                              {r ?? "-"}
                            </td>
                          );
                        })}
                        <td style={{
                          padding: "10px 8px", textAlign: "center", borderBottom: "1px solid #eee", fontSize: 13, fontWeight: 700,
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

      {/* ════ 検索語句 ════ */}
      {showSearchQueries && (() => { pageNum++;
        // 最新月と前月の比較データを作成
        const sqLatest = searchQueries.history[searchQueries.history.length - 1];
        const sqPrev = searchQueries.history.length >= 2 ? searchQueries.history[searchQueries.history.length - 2] : null;
        const prevMap = new Map(sqPrev?.keywords.map(k => [k.word, k.count]) || []);
        return (
        <div style={slideStyle} className="slide">
          <div style={slideBarStyle}><span>{shop.name} — 検索語句</span><span style={{ fontSize: 11, opacity: 0.45, fontWeight: 400 }}>{pn(pageNum)}</span></div>
          <div style={{ ...slideBodyStyle, display: "flex", flexDirection: "column" }}>
            <div style={stitleStyle}>検索語句ランキング（{searchQueries.latestMonth}）</div>
            <div style={{ overflow: "hidden", borderRadius: 12, boxShadow: "0 1px 6px rgba(0,0,0,.04)", flex: 1, display: "flex", flexDirection: "column" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", flex: 1 }}>
                <thead>
                  <tr>
                    <th style={{ background: "#0f3460", color: "#fff", padding: "10px 8px", textAlign: "center", fontWeight: 600, fontSize: 11, width: 40 }}>順位</th>
                    <th style={{ background: "#0f3460", color: "#fff", padding: "10px 12px", textAlign: "left", fontWeight: 600, fontSize: 11 }}>検索語句</th>
                    <th style={{ background: "#0f3460", color: "#fff", padding: "10px 8px", textAlign: "center", fontWeight: 600, fontSize: 11, width: 70 }}>検索数</th>
                    {sqPrev && <th style={{ background: "#0f3460", color: "#fff", padding: "10px 8px", textAlign: "center", fontWeight: 600, fontSize: 11, width: 70 }}>前月</th>}
                    {sqPrev && <th style={{ background: "#0f3460", color: "#fff", padding: "10px 8px", textAlign: "center", fontWeight: 600, fontSize: 11, width: 60 }}>変動</th>}
                  </tr>
                </thead>
                <tbody>
                  {searchQueries.latest.slice(0, 30).map((kw, i) => {
                    const prev = prevMap.get(kw.word);
                    const diff = prev !== undefined ? kw.count - prev : null;
                    return (
                      <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#f8f9fb", borderBottom: "1px solid #eee" }}>
                        <td style={{ padding: "7px 8px", textAlign: "center", fontSize: 13, fontWeight: 700, color: i < 3 ? "#e94560" : i < 10 ? "#0f3460" : "#888" }}>{i + 1}</td>
                        <td style={{ padding: "7px 12px", fontSize: 13, color: "#333" }}>{kw.word}</td>
                        <td style={{ padding: "7px 8px", textAlign: "center", fontSize: 14, fontWeight: 700, color: "#0f3460" }}>{kw.count.toLocaleString()}</td>
                        {sqPrev && <td style={{ padding: "7px 8px", textAlign: "center", fontSize: 12, color: "#888" }}>{prev !== undefined ? prev.toLocaleString() : "-"}</td>}
                        {sqPrev && <td style={{ padding: "7px 8px", textAlign: "center", fontSize: 11, fontWeight: 600, color: diff === null ? "#ccc" : diff > 0 ? "#0a8f3c" : diff < 0 ? "#c0392b" : "#888" }}>
                          {diff === null ? "-" : diff > 0 ? `+${diff}` : diff === 0 ? "→" : String(diff)}
                        </td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ); })()}

      {/* ════ P8: 口コミ件数推移 ════ */}
      {(() => { pageNum++; return null; })()}
      {hasReviews && (
        <div style={slideStyle} className="slide">
          <div style={slideBarStyle}><span>{shop.name} — 口コミ件数推移</span><span style={{ fontSize: 11, opacity: 0.45, fontWeight: 400 }}>{pn(pageNum)}</span></div>
          <div style={{ ...slideBodyStyle, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: "95%", maxHeight: 600 }}>
              <Line data={{ labels: reviewLabels, datasets: [{
                label: "口コミ件数", data: reviewCounts,
                borderColor: "#fbc02d", backgroundColor: "rgba(251,192,45,.15)",
                fill: true, tension: 0.3, pointRadius: 4, pointBackgroundColor: "#fbc02d", borderWidth: 2,
              }]}} options={lineOptions} />
            </div>
          </div>
        </div>
      )}

      {/* ════ P9: 月間口コミ増加数 ════ */}
      {(() => { pageNum++; return null; })()}
      {hasReviews && (
        <div style={slideStyle} className="slide">
          <div style={slideBarStyle}><span>{shop.name} — 月間口コミ増加数</span><span style={{ fontSize: 11, opacity: 0.45, fontWeight: 400 }}>{pn(pageNum)}</span></div>
          <div style={{ ...slideBodyStyle, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: "95%", maxHeight: 600 }}>
              <Bar data={{ labels: reviewLabels.slice(1), datasets: [{
                label: "月間増加数", data: reviewDelta.slice(1),
                backgroundColor: (reviewDelta.slice(1) as number[]).map(v => v >= 20 ? "rgba(39,174,96,.75)" : v >= 10 ? "rgba(251,192,45,.75)" : "rgba(229,115,115,.75)"),
                borderRadius: 3,
              }]}} options={{ responsive: true, maintainAspectRatio: true, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: "#f0f0f0" } } } }} />
            </div>
          </div>
        </div>
      )}

      {/* ════ P10: 口コミ分析 ════ */}
      {(() => { pageNum++; return null; })()}
      <div style={slideStyle} className="slide">
        <div style={slideBarStyle}><span>{shop.name} — 口コミ分析</span><span style={{ fontSize: 11, opacity: 0.45, fontWeight: 400 }}>{pn(pageNum)}</span></div>
        <div style={slideBodyStyle}>
          <div style={stitleStyle}>口コミ分析</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "auto 1fr", gap: 16, flex: 1 }}>
            <div style={{ background: "#fff", borderRadius: 12, padding: "24px 28px", boxShadow: "0 1px 6px rgba(0,0,0,.04)", display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: "#27ae60", marginBottom: 14 }}>ポジティブワード（推定）</h3>
              <div>{reviewAnalysis.positiveWords.length > 0 ? reviewAnalysis.positiveWords.map((w, i) => (
                <span key={i} style={{ display: "inline-block", padding: "6px 16px", borderRadius: 16, fontSize: 13, margin: 5, fontWeight: 500, background: "#e6f9ee", color: "#0a8f3c" }}>{w}</span>
              )) : <span style={{ color: "#bbb", fontSize: 14, fontStyle: "italic" }}>データ準備中</span>}</div>
            </div>
            <div style={{ background: "#fff", borderRadius: 12, padding: "24px 28px", boxShadow: "0 1px 6px rgba(0,0,0,.04)", display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: "#c0392b", marginBottom: 14 }}>ネガティブワード（推定）</h3>
              <div>{reviewAnalysis.negativeWords.length > 0 ? reviewAnalysis.negativeWords.map((w, i) => (
                <span key={i} style={{ display: "inline-block", padding: "6px 16px", borderRadius: 16, fontSize: 13, margin: 5, fontWeight: 500, background: "#fde8e8", color: "#c0392b" }}>{w}</span>
              )) : <span style={{ color: "#bbb", fontSize: 14, fontStyle: "italic" }}>データ準備中</span>}</div>
            </div>
            <div style={{ background: "#fff", borderRadius: 12, padding: "24px 28px", boxShadow: "0 1px 6px rgba(0,0,0,.04)", gridColumn: "1/-1", display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>口コミ総評</h3>
              <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 32, color: "#fbc02d" }}>{"★".repeat(Math.floor(shop.rating))}{"☆".repeat(5 - Math.floor(shop.rating))}</div>
                  <span style={{ fontSize: 56, fontWeight: 900, color: "#0f3460" }}>{shop.rating}</span>
                  <span style={{ fontSize: 16, color: "#888", marginLeft: 8 }}>/ 5.0（{shop.totalReviews.toLocaleString()}件）</span>
                </div>
              </div>
              <p style={{ fontSize: 15, lineHeight: 1.9, color: "#444", margin: 0 }} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(reviewAnalysis.summary, { ALLOWED_TAGS: ["strong", "em", "br"] }) }} />
            </div>
          </div>
        </div>
      </div>

      {/* ════ P11: 担当者コメント ════ */}
      {(() => { pageNum++; return null; })()}
      <div style={slideStyle} className="slide">
        <div style={slideBarStyle}><span>{shop.name} — 担当者コメント</span><span style={{ fontSize: 11, opacity: 0.45, fontWeight: 400 }}>{pn(pageNum)}</span></div>
        <div style={slideBodyStyle}>
          <div style={stitleStyle}>担当者コメント</div>
          <div style={{ background: "linear-gradient(135deg,#f0f4ff,#fff)", border: "2px solid #0f3460", borderRadius: 14, padding: "28px 32px", flex: 1, display: "flex", flexDirection: "column" }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: "#0f3460", marginBottom: 12 }}>{curLabel} 総評</h3>
            <ul style={{ paddingLeft: 20, margin: 0 }}>
              {comments.map((c, i) => (
                <li key={i} style={{ fontSize: 14, lineHeight: 2, color: "#444" }} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(c, { ALLOWED_TAGS: ["strong", "em", "br"] }) }} />
              ))}
            </ul>
            {/* メモ欄 */}
            <div style={{ marginTop: 16, borderTop: "1px solid #dde", paddingTop: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#0f3460" }}>メモ（担当者用）</span>
                <div style={{ display: "flex", gap: 6 }}>
                  {!memoEditing ? (
                    <button onClick={() => setMemoEditing(true)} style={{ fontSize: 10, padding: "3px 10px", borderRadius: 6, border: "1px solid #ccd", background: "#fff", cursor: "pointer", color: "#555" }}>
                      {memo ? "編集" : "追加"}
                    </button>
                  ) : (
                    <>
                      <button onClick={saveMemo} style={{ fontSize: 10, padding: "3px 10px", borderRadius: 6, border: "none", background: "#0f3460", color: "#fff", cursor: "pointer" }}>保存</button>
                      <button onClick={() => { setMemoEditing(false); const s = localStorage.getItem(memoKey); setMemo(s || ""); }} style={{ fontSize: 10, padding: "3px 10px", borderRadius: 6, border: "1px solid #ccd", background: "#fff", cursor: "pointer", color: "#555" }}>キャンセル</button>
                    </>
                  )}
                  {memoSaved && <span style={{ fontSize: 10, color: "#0a8f3c" }}>保存しました</span>}
                </div>
              </div>
              {memoEditing ? (
                <textarea value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="この店舗への所感やメモを記入..."
                  style={{ width: "100%", minHeight: 60, padding: "8px 10px", fontSize: 13, lineHeight: 1.6, border: "1px solid #ccd", borderRadius: 8, resize: "vertical", fontFamily: "inherit" }} />
              ) : memo ? (
                <p style={{ fontSize: 13, lineHeight: 1.8, color: "#444", margin: 0, whiteSpace: "pre-wrap" }}>{memo}</p>
              ) : (
                <p style={{ fontSize: 12, color: "#aaa", margin: 0, fontStyle: "italic" }}>メモなし</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
