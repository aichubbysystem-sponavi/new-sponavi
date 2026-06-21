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
const formatCpc = (micros: number) => `¥${Math.round(micros / 1_000_000).toLocaleString()}`;
const formatCtr = (ctr: number) => `${(ctr * 100).toFixed(2)}%`;
const formatMonthShort = (m: string) => { if (!m) return ""; const d = new Date(m); return `${d.getMonth() + 1}月`; };
const formatDate = (d: string) => d ? d.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$2/$3") : "";

function getDateRange(monthsBack: number) {
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - monthsBack);
  start.setDate(1);
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  return { startDate: fmt(start), endDate: fmt(end) };
}

function MomBadge({ current, previous }: { current: number; previous: number }) {
  if (previous === 0 && current === 0) return <span style={badgeStyle(false, true)}>→ 0.0%</span>;
  if (previous === 0) return <span style={badgeStyle(true)}>▲ NEW</span>;
  const pct = ((current - previous) / previous) * 100;
  const isUp = pct > 0;
  const isFlat = Math.abs(pct) < 0.5;
  const arrow = isFlat ? "→" : isUp ? "▲" : "▼";
  return <span style={badgeStyle(isUp, isFlat)}>{arrow} {isFlat ? "0.0" : pct.toFixed(1)}%</span>;
}

function badgeStyle(isUp: boolean, isFlat?: boolean): React.CSSProperties {
  return {
    display: "inline-block", padding: "2px 7px", borderRadius: 16, fontSize: 11, fontWeight: 600,
    background: isFlat ? "#f0f0f0" : isUp ? "#e6f9ee" : "#fde8e8",
    color: isFlat ? "#888" : isUp ? "#0a8f3c" : "#c0392b",
  };
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
  const router = useRouter();

  const [monthly, setMonthly] = useState<CampaignRow[]>([]);
  const [daily, setDaily] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!shopName) {
      setLoading(false);
      setError("店舗名が指定されていません");
      return;
    }
    (async () => {
      setLoading(true);
      setError("");
      try {
        const token = (await supabase.auth.getSession()).data.session?.access_token;
        const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
        const { startDate, endDate } = getDateRange(12);
        const res = await fetch(`/api/pmax/store-detail?shopName=${encodeURIComponent(shopName)}&startDate=${startDate}&endDate=${endDate}`, { headers });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setMonthly(data.monthly || []);
        setDaily(data.daily || []);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "取得に失敗しました");
      } finally {
        setLoading(false);
      }
    })();
  }, [shopName]);

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

  // 言語でグループ化
  const languages = Array.from(new Set(monthly.map(r => r.language))).sort();
  const monthlyByLang: Record<string, CampaignRow[]> = {};
  const dailyByLang: Record<string, CampaignRow[]> = {};
  for (const lang of languages) {
    monthlyByLang[lang] = monthly.filter(r => r.language === lang).sort((a, b) => (a.month || "").localeCompare(b.month || ""));
    dailyByLang[lang] = daily.filter(r => r.language === lang).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  }

  const now = new Date();
  const currentMonth = `${now.getFullYear()}/${now.getMonth() + 1}`;
  const periodStart = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/01`;
  const periodEnd = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()}`;

  // 言語別サマリー集計
  const langTotals = languages.map((lang) => {
    const rows = monthlyByLang[lang];
    return {
      lang,
      impressions: rows.reduce((s, r) => s + r.impressions, 0),
      clicks: rows.reduce((s, r) => s + r.clicks, 0),
      costMicros: rows.reduce((s, r) => s + r.costMicros, 0),
    };
  });
  const totalImpressions = langTotals.reduce((s, l) => s + l.impressions, 0);
  const totalClicks = langTotals.reduce((s, l) => s + l.clicks, 0);
  const totalCost = langTotals.reduce((s, l) => s + l.costMicros, 0);

  const totalPages = 2 + languages.length * 2;

  return (
    <div style={{ background: "#1a1a2e", minHeight: "100vh", paddingBottom: 40 }}>
      {/* トップバー */}
      <div className="no-print" style={{ background: "rgba(0,0,0,0.3)", padding: "12px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100, backdropFilter: "blur(10px)" }}>
        <button onClick={() => router.push("/pmax")} style={{ color: "rgba(255,255,255,0.8)", background: "none", border: "none", cursor: "pointer", fontSize: 14 }}>
          ← 店舗一覧に戻る
        </button>
        <span style={{ fontSize: 12, color: "#4fc3f7", background: "rgba(79,195,247,0.15)", padding: "4px 12px", borderRadius: 20, border: "1px solid rgba(79,195,247,0.3)" }}>
          P-MAX広告レポート
        </span>
      </div>

      {/* ===== P1: サマリー ===== */}
      <div style={slideStyle}>
        <div style={{ background: "linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%)", color: "#fff", padding: "28px 36px 20px", flexShrink: 0, position: "relative" }}>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900, letterSpacing: 1 }}>{shopName}</h1>
          <div style={{ fontSize: 13, opacity: 0.7, marginTop: 2 }}>P-MAX広告 レポート報告</div>
          <div style={{ position: "absolute", top: 28, right: 36, background: "rgba(255,255,255,.12)", padding: "7px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
            {periodStart} - {periodEnd}
          </div>
        </div>
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
            <span style={{ color: "#888" }}>言語数</span>
            <span style={{ fontWeight: 700 }}>{languages.length}</span>
          </div>
        </div>
        <div style={{ flex: 1, padding: "20px 36px", overflow: "hidden" }}>
          <div style={stitleStyle}>主要指標サマリー</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
            {[
              { label: "総表示回数", value: totalImpressions, format: (v: number) => v.toLocaleString() },
              { label: "総クリック数", value: totalClicks, format: (v: number) => v.toLocaleString() },
              { label: "総広告費", value: totalCost, format: (v: number) => formatCost(v) },
              { label: "クリック率", value: totalImpressions > 0 ? totalClicks / totalImpressions : 0, format: (v: number) => formatCtr(v) },
              { label: "平均CPC", value: totalClicks > 0 ? totalCost / totalClicks : 0, format: (v: number) => formatCpc(v) },
              { label: "対応言語", value: languages.length, format: (v: number) => `${v}言語` },
            ].map((kpi, i) => (
              <div key={kpi.label} style={{ background: "#fff", borderRadius: 12, padding: "14px 16px", position: "relative", overflow: "hidden", boxShadow: "0 1px 6px rgba(0,0,0,.04)" }}>
                <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: 3, background: kpiTopColors[i % kpiTopColors.length] }} />
                <div style={{ fontSize: 12, color: "#888", fontWeight: 500 }}>{kpi.label}</div>
                <div style={{ fontSize: 26, fontWeight: 900, lineHeight: 1.1, margin: "4px 0" }}>{kpi.format(kpi.value)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ===== P2: 言語別指標比較 ===== */}
      <div style={slideStyle}>
        <div style={slideBarStyle}>
          <span>{shopName} — 言語別 広告指標</span>
          <span>2 / {totalPages}</span>
        </div>
        <div style={slideBodyStyle}>
          <div style={stitleStyle}>言語別 指標比較</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            {([
              { key: "impressions" as const, label: "表示回数", format: (v: number) => v.toLocaleString(), color: chartColors[0], border: chartBorderColors[0] },
              { key: "clicks" as const, label: "クリック数", format: (v: number) => v.toLocaleString(), color: chartColors[1], border: chartBorderColors[1] },
              { key: "costMicros" as const, label: "広告費", format: (v: number) => formatCost(v), color: chartColors[2], border: chartBorderColors[2] },
            ]).map((metric) => (
              <div key={metric.key}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#0f3460", marginBottom: 8, textAlign: "center" }}>{metric.label}</div>
                <div style={{ height: 220 }}>
                  <Bar
                    data={{
                      labels: langTotals.map(l => l.lang),
                      datasets: [{ label: metric.label, data: langTotals.map(l => l[metric.key]), backgroundColor: langTotals.map((_, i) => chartColors[i % chartColors.length]), borderColor: langTotals.map((_, i) => chartBorderColors[i % chartBorderColors.length]), borderWidth: 1 }],
                    }}
                    options={{
                      responsive: true, maintainAspectRatio: false,
                      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => metric.format(ctx.raw as number) } } },
                      scales: {
                        x: { grid: { display: false }, ticks: { font: { size: 10 } } },
                        y: { beginAtZero: true, grid: { color: "#f0f0f0" }, ticks: { callback: (v) => metric.key === "costMicros" ? formatCost(Number(v)) : Number(v).toLocaleString(), font: { size: 10 } } },
                      },
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          <table style={{ width: "95%", margin: "16px auto 0", borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr>
                <th style={{ background: "#0f3460", color: "#fff", padding: "6px 8px", fontWeight: 600 }}>言語</th>
                <th style={{ background: "#0f3460", color: "#fff", padding: "6px 8px", fontWeight: 600, textAlign: "center" }}>表示回数</th>
                <th style={{ background: "#0f3460", color: "#fff", padding: "6px 8px", fontWeight: 600, textAlign: "center" }}>クリック数</th>
                <th style={{ background: "#0f3460", color: "#fff", padding: "6px 8px", fontWeight: 600, textAlign: "center" }}>クリック率</th>
                <th style={{ background: "#0f3460", color: "#fff", padding: "6px 8px", fontWeight: 600, textAlign: "center" }}>平均CPC</th>
                <th style={{ background: "#0f3460", color: "#fff", padding: "6px 8px", fontWeight: 600, textAlign: "center" }}>広告費</th>
              </tr>
            </thead>
            <tbody>
              {langTotals.map((l, i) => (
                <tr key={l.lang} style={{ background: i % 2 === 0 ? "#fff" : "#f8f9fb" }}>
                  <td style={{ padding: "5px 8px", fontWeight: 600, color: "#666" }}>{l.lang}</td>
                  <td style={{ textAlign: "center", padding: "5px 8px" }}>{l.impressions.toLocaleString()}</td>
                  <td style={{ textAlign: "center", padding: "5px 8px" }}>{l.clicks.toLocaleString()}</td>
                  <td style={{ textAlign: "center", padding: "5px 8px" }}>{l.impressions > 0 ? formatCtr(l.clicks / l.impressions) : "0.00%"}</td>
                  <td style={{ textAlign: "center", padding: "5px 8px" }}>{l.clicks > 0 ? formatCpc(l.costMicros / l.clicks) : "¥0"}</td>
                  <td style={{ textAlign: "center", padding: "5px 8px", fontWeight: 700 }}>{formatCost(l.costMicros)}</td>
                </tr>
              ))}
              <tr style={{ background: "#e8eaf0", fontWeight: 700 }}>
                <td style={{ padding: "5px 8px" }}>合計</td>
                <td style={{ textAlign: "center", padding: "5px 8px" }}>{totalImpressions.toLocaleString()}</td>
                <td style={{ textAlign: "center", padding: "5px 8px" }}>{totalClicks.toLocaleString()}</td>
                <td style={{ textAlign: "center", padding: "5px 8px" }}>{totalImpressions > 0 ? formatCtr(totalClicks / totalImpressions) : "0.00%"}</td>
                <td style={{ textAlign: "center", padding: "5px 8px" }}>{totalClicks > 0 ? formatCpc(totalCost / totalClicks) : "¥0"}</td>
                <td style={{ textAlign: "center", padding: "5px 8px" }}>{formatCost(totalCost)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ===== P3+: 言語別 月次→日次ペア ===== */}
      {languages.map((lang, langIdx) => {
        const mRows = monthlyByLang[lang];
        const dRows = dailyByLang[lang];

        return (
          <div key={lang}>
            {/* 月次ページ */}
            <div style={slideStyle}>
              <div style={slideBarStyle}>
                <span>{shopName} — {lang} 月次推移</span>
                <span>{3 + langIdx * 2} / {totalPages}</span>
              </div>
              <div style={slideBodyStyle}>
                <div style={{ height: 280 }}>
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
                <table style={{ width: "95%", margin: "12px auto 0", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr>
                      <th style={{ background: "#0f3460", color: "#fff", padding: "6px 8px", fontWeight: 600 }}>月</th>
                      {mRows.map((r, i) => (
                        <th key={i} style={{ background: i === mRows.length - 1 ? "#e94560" : "#0f3460", color: "#fff", padding: "6px 4px", fontWeight: 600, textAlign: "center" }}>
                          {formatMonthShort(r.month || "")}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(["impressions", "clicks", "ctr", "averageCpc", "costMicros"] as const).map((field, ri) => (
                      <tr key={field} style={{ background: ri % 2 === 0 ? "#f8f9fa" : "#f8f9fb" }}>
                        <td style={{ padding: "4px 8px", fontWeight: 600, color: "#666" }}>
                          {{ impressions: "表示回数", clicks: "クリック数", ctr: "クリック率", averageCpc: "平均CPC", costMicros: "広告費" }[field]}
                        </td>
                        {mRows.map((r, i) => (
                          <td key={i} style={{ textAlign: "center", padding: "4px", fontWeight: field === "costMicros" ? 700 : undefined, background: i === mRows.length - 1 ? "#fff8f0" : undefined }}>
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
              </div>
            </div>

            {/* 日次ページ */}
            {dRows.length > 0 && (
              <div style={{ ...slideStyle, minHeight: "auto" }}>
                <div style={slideBarStyle}>
                  <span>{shopName} — {lang} 日次データ</span>
                  <span>{4 + langIdx * 2} / {totalPages}</span>
                </div>
                <div style={{ ...slideBodyStyle, padding: "16px 24px" }}>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                      <thead>
                        <tr>
                          {["日付", "表示回数", "クリック数", "クリック率", "平均CPC", "広告費"].map((h, i) => (
                            <th key={h} style={{ background: "#0f3460", color: "#fff", padding: "6px 8px", fontWeight: 600, textAlign: i === 0 ? "left" : "center" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {dRows.map((r, i) => (
                          <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#f8f9fb" }}>
                            <td style={{ padding: "4px 8px", fontWeight: 600, color: "#666" }}>{formatDate(r.date || "")}</td>
                            <td style={{ textAlign: "center", padding: "4px 8px" }}>{r.impressions.toLocaleString()}</td>
                            <td style={{ textAlign: "center", padding: "4px 8px" }}>{r.clicks.toLocaleString()}</td>
                            <td style={{ textAlign: "center", padding: "4px 8px" }}>{formatCtr(r.ctr)}</td>
                            <td style={{ textAlign: "center", padding: "4px 8px" }}>{formatCpc(r.averageCpc)}</td>
                            <td style={{ textAlign: "center", padding: "4px 8px", fontWeight: 700 }}>{formatCost(r.costMicros)}</td>
                          </tr>
                        ))}
                        <tr style={{ background: "#e8eaf0", fontWeight: 700 }}>
                          <td style={{ padding: "6px 8px" }}>合計</td>
                          <td style={{ textAlign: "center", padding: "6px 8px" }}>{dRows.reduce((s, r) => s + r.impressions, 0).toLocaleString()}</td>
                          <td style={{ textAlign: "center", padding: "6px 8px" }}>{dRows.reduce((s, r) => s + r.clicks, 0).toLocaleString()}</td>
                          <td style={{ textAlign: "center", padding: "6px 8px" }}>{formatCtr(dRows.reduce((s, r) => s + r.clicks, 0) / Math.max(dRows.reduce((s, r) => s + r.impressions, 0), 1))}</td>
                          <td style={{ textAlign: "center", padding: "6px 8px" }}>{formatCpc(dRows.reduce((s, r) => s + r.costMicros, 0) / Math.max(dRows.reduce((s, r) => s + r.clicks, 0), 1))}</td>
                          <td style={{ textAlign: "center", padding: "6px 8px" }}>{formatCost(dRows.reduce((s, r) => s + r.costMicros, 0))}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
