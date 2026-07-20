"use client";

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  LineController,
  BarElement,
  BarController,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { Chart, Pie } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, LineController, BarElement, BarController, ArcElement, Title, Tooltip, Legend);

export type CampaignRow = {
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

export type GbpRow = {
  month: string;
  shopName: string;
  totalImpressions: number;
  totalVisits: number;
  phone: number;
  directions: number;
  website: number;
  menuClicks: number;
  saveShare: number;
  reservation: number; // 予約（GBPシートM列「注文」由来）
};

export type ChannelRow = {
  network: string; // segments.ad_network_type の値（MAPS / SEARCH / YOUTUBE / GMAIL / DISCOVER / CONTENT 等）
  impressions: number;
  clicks: number;
  costMicros: number;
};

export type PmaxReportData = {
  monthly: CampaignRow[];
  daily: CampaignRow[];
  gbp: GbpRow[];
  channels?: ChannelRow[];
  shopName: string;
  year: number;
  month: number;
  summaryText?: string;
};

// 媒体別配信比率の表示定義（色はチャネルに固定。順位で塗り替えない）
const CHANNEL_DEFS = [
  { key: "MAPS", label: "Googleマップ", color: "#2a78d6" },
  { key: "SEARCH", label: "Google検索", color: "#008300" },
  { key: "CONTENT", label: "ディスプレイ", color: "#e87ba4" },
  { key: "YOUTUBE", label: "YouTube", color: "#eda100" },
  { key: "GMAIL", label: "Gmail", color: "#1baf7a" },
  { key: "DISCOVER", label: "Discover", color: "#eb6834" },
] as const;
const CHANNEL_OTHER = { label: "その他", color: "#898781" };

const SLIDE_W = 1123;
const SLIDE_H = 794;
// 月次推移の線グラフ色（指標に固定: 表示回数=赤/クリック数=青/クリック率=黄/クリック単価=緑）
const monthlyLineColors = { impressions: "#e53935", clicks: "#1e88e5", ctr: "#fdd835", cpc: "#43a047" } as const;
const kpiTopColors = [
  "linear-gradient(90deg,#4fc3f7,#0288d1)", "linear-gradient(90deg,#81c784,#388e3c)",
  "linear-gradient(90deg,#ffb74d,#f57c00)", "linear-gradient(90deg,#ba68c8,#7b1fa2)",
  "linear-gradient(90deg,#e57373,#d32f2f)", "linear-gradient(90deg,#4db6ac,#00897b)",
  "linear-gradient(90deg,#90a4ae,#546e7a)", "linear-gradient(90deg,#fff176,#f9a825)",
  "linear-gradient(90deg,#f48fb1,#c2185b)", "linear-gradient(90deg,#a1887f,#5d4037)",
];

const slideStyle: React.CSSProperties = {
  width: SLIDE_W, minHeight: SLIDE_H, margin: "20px auto", background: "#f0f2f5",
  borderRadius: 8, overflow: "hidden", boxShadow: "0 8px 40px rgba(0,0,0,.4)",
  display: "flex", flexDirection: "column", pageBreakAfter: "always", pageBreakInside: "avoid",
  maxWidth: "calc(100vw - 24px)",
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

const formatCost = (micros: number) => `¥${Math.round(micros / 1_000_000).toLocaleString()}`;
const formatCpc = (micros: number) => `¥${(micros / 1_000_000).toFixed(1)}`;
const formatCtr = (ctr: number) => `${(ctr * 100).toFixed(2)}%`;
const formatMonthShort = (m: string) => { if (!m) return ""; const d = new Date(m); return `${d.getMonth() + 1}月`; };
const formatDate = (d: string) => d ? d.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$2/$3") : "";
const formatNum = (n: number) => n.toLocaleString();

function ComparisonBadge({ current, previous, label, format }: { current: number; previous: number; label: string; format?: (v: number) => string }) {
  const fmt = format || ((v: number) => v.toLocaleString());
  if (previous === 0 && current === 0) return <div style={{ fontSize: 11, color: "#888", lineHeight: 1.5 }}>→ 0.0%（{fmt(previous)}→{fmt(current)}）{label}</div>;
  if (previous === 0) return <div style={{ fontSize: 11, color: "#0a8f3c", lineHeight: 1.5 }}>▲ NEW {label}</div>;
  const pct = ((current - previous) / previous) * 100;
  const isUp = pct > 0;
  const isFlat = Math.abs(pct) < 0.5;
  const arrow = isFlat ? "→" : isUp ? "▲" : "▼";
  const color = isFlat ? "#888" : isUp ? "#0a8f3c" : "#c0392b";
  return <div style={{ fontSize: 11, color, lineHeight: 1.5 }}>{arrow} {isFlat ? "0.0" : (isUp ? "+" : "") + pct.toFixed(1)}%（{fmt(previous)}→{fmt(current)}）{label}</div>;
}

function KpiCard({ kpi, colorIdx }: { kpi: { label: string; value: number; format: (v: number) => string; prev: number; lastYear: number | null }; colorIdx: number }) {
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

/**
 * P-MAX 店舗レポートの表示専用コンポーネント。
 * データ取得は各ページ側で行い、結果をpropsで渡す。
 * @param backHref 指定すると左上に「戻る」リンクを表示（グループページから遷移した場合など）
 */
export default function PmaxReportView({ data, backHref }: { data: PmaxReportData; backHref?: string }) {
  const { monthly, daily, gbp: gbpRows, channels = [], shopName, year: targetYear, month: targetMonthNum, summaryText = "" } = data;

  // ── データ集計 ──
  const currentMonthKey = `${targetYear}-${String(targetMonthNum).padStart(2, "0")}`;
  const prevMonthDate = new Date(targetYear, targetMonthNum - 2, 1);
  const prevMonthKey = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, "0")}`;
  const lastYearMonthKey = `${targetYear - 1}-${String(targetMonthNum).padStart(2, "0")}`;

  const currentMonth = `${targetYear}/${targetMonthNum}`;
  const periodStart = `${targetYear}/${String(targetMonthNum).padStart(2, "0")}/01`;
  const periodEnd = `${targetYear}/${String(targetMonthNum).padStart(2, "0")}/${new Date(targetYear, targetMonthNum, 0).getDate()}`;

  const languages = Array.from(new Set([...monthly.map(r => r.language), ...daily.map(r => r.language)])).sort();
  const monthlyByLang: Record<string, CampaignRow[]> = {};
  const dailyByLang: Record<string, CampaignRow[]> = {};
  for (const lang of languages) {
    const langRows = monthly.filter(r => r.language === lang);
    const monthMap = new Map<string, CampaignRow>();
    for (const r of langRows) {
      const key = r.month || "";
      const existing = monthMap.get(key);
      if (existing) {
        existing.impressions += r.impressions; existing.clicks += r.clicks; existing.costMicros += r.costMicros;
        existing.ctr = existing.impressions > 0 ? existing.clicks / existing.impressions : 0;
        existing.averageCpc = existing.clicks > 0 ? existing.costMicros / existing.clicks : 0;
      } else { monthMap.set(key, { ...r }); }
    }
    monthlyByLang[lang] = Array.from(monthMap.values()).sort((a, b) => (a.month || "").localeCompare(b.month || ""));

    const langDailyRows = daily.filter(r => r.language === lang);
    const dayMap = new Map<string, CampaignRow>();
    for (const r of langDailyRows) {
      const key = r.date || "";
      const existing = dayMap.get(key);
      if (existing) {
        existing.impressions += r.impressions; existing.clicks += r.clicks; existing.costMicros += r.costMicros;
        existing.ctr = existing.impressions > 0 ? existing.clicks / existing.impressions : 0;
        existing.averageCpc = existing.clicks > 0 ? existing.costMicros / existing.clicks : 0;
      } else { dayMap.set(key, { ...r }); }
    }
    dailyByLang[lang] = Array.from(dayMap.values()).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  }

  function getAdsMonthTotal(monthKey: string) {
    const rows = monthly.filter(r => (r.month || "").startsWith(monthKey));
    return { impressions: rows.reduce((s, r) => s + r.impressions, 0), clicks: rows.reduce((s, r) => s + r.clicks, 0), costMicros: rows.reduce((s, r) => s + r.costMicros, 0), ctr: 0, averageCpc: 0 };
  }
  const adsCurrent = getAdsMonthTotal(currentMonthKey);
  adsCurrent.ctr = adsCurrent.impressions > 0 ? adsCurrent.clicks / adsCurrent.impressions : 0;
  adsCurrent.averageCpc = adsCurrent.clicks > 0 ? adsCurrent.costMicros / adsCurrent.clicks : 0;
  const adsPrev = getAdsMonthTotal(prevMonthKey);
  adsPrev.ctr = adsPrev.impressions > 0 ? adsPrev.clicks / adsPrev.impressions : 0;
  adsPrev.averageCpc = adsPrev.clicks > 0 ? adsPrev.costMicros / adsPrev.clicks : 0;
  const adsLastYear = getAdsMonthTotal(lastYearMonthKey);
  const hasYearData = adsLastYear.impressions > 0 || adsLastYear.clicks > 0 || adsLastYear.costMicros > 0;

  const gbpCurrentKey = `${targetYear}/${String(targetMonthNum).padStart(2, "0")}`;
  const gbpPrevKeyVal = `${prevMonthDate.getFullYear()}/${String(prevMonthDate.getMonth() + 1).padStart(2, "0")}`;
  const gbpLastYearKey = `${targetYear - 1}/${String(targetMonthNum).padStart(2, "0")}`;
  const gbpCurrent = gbpRows.find(r => r.month === gbpCurrentKey);
  const gbpPrev = gbpRows.find(r => r.month === gbpPrevKeyVal);
  const gbpLastYear = gbpRows.find(r => r.month === gbpLastYearKey);
  const hasGbpYearData = !!gbpLastYear;

  const hasSummary = summaryText.length > 0;

  // コンバージョン（GBP由来アクション）の月次系列
  const convRows = [...gbpRows].sort((a, b) => (a.month || "").localeCompare(b.month || ""));
  const convLabels = convRows.map((r) => {
    const mm = (r.month || "").split("/")[1];
    return mm ? `${Number(mm)}月` : r.month;
  });
  const convMetrics: { key: keyof GbpRow; label: string }[] = [
    { key: "totalVisits", label: "合計来店数" },
    { key: "phone", label: "電話" },
    { key: "directions", label: "経路案内" },
    { key: "menuClicks", label: "メニュークリック" },
    { key: "reservation", label: "予約" },
    { key: "website", label: "WEBサイト" },
    { key: "saveShare", label: "保存・共有" },
  ];
  const hasConversion = convRows.length > 0;
  const convOffset = hasConversion ? 1 : 0;

  // 媒体別配信比率（対象月の表示回数ベース）: 6チャネル＋その他に集計し、多い順に並べる
  const channelAgg = (() => {
    const byKey = new Map<string, number>();
    let otherImp = 0;
    const knownKeys = new Set<string>(CHANNEL_DEFS.map((d) => d.key));
    for (const r of channels) {
      if (knownKeys.has(r.network)) byKey.set(r.network, (byKey.get(r.network) || 0) + r.impressions);
      else otherImp += r.impressions;
    }
    const items: { label: string; color: string; impressions: number }[] = CHANNEL_DEFS.map((d) => ({
      label: d.label, color: d.color, impressions: byKey.get(d.key) || 0,
    }));
    if (otherImp > 0) items.push({ label: CHANNEL_OTHER.label, color: CHANNEL_OTHER.color, impressions: otherImp });
    items.sort((a, b) => b.impressions - a.impressions);
    const total = items.reduce((s, i) => s + i.impressions, 0);
    return { items, total };
  })();
  const hasChannels = channelAgg.total > 0;
  const channelOffset = hasChannels ? 1 : 0;
  const channelPct = (imp: number) => (channelAgg.total > 0 ? ((imp / channelAgg.total) * 100).toFixed(1) : "0.0");

  const totalPages = 1 + convOffset + languages.length + channelOffset + (hasSummary ? 1 : 0);

  const kpiCards = [
    { label: "総表示回数", value: adsCurrent.impressions, format: formatNum, prev: adsPrev.impressions, lastYear: hasYearData ? adsLastYear.impressions : null },
    { label: "総クリック", value: adsCurrent.clicks, format: formatNum, prev: adsPrev.clicks, lastYear: hasYearData ? adsLastYear.clicks : null },
    { label: "総広告費", value: adsCurrent.costMicros, format: formatCost, prev: adsPrev.costMicros, lastYear: hasYearData ? adsLastYear.costMicros : null },
    { label: "合計来店数", value: gbpCurrent?.totalVisits ?? 0, format: formatNum, prev: gbpPrev?.totalVisits ?? 0, lastYear: hasGbpYearData ? (gbpLastYear?.totalVisits ?? 0) : null },
    { label: "電話", value: gbpCurrent?.phone ?? 0, format: formatNum, prev: gbpPrev?.phone ?? 0, lastYear: hasGbpYearData ? (gbpLastYear?.phone ?? 0) : null },
    { label: "経路案内", value: gbpCurrent?.directions ?? 0, format: formatNum, prev: gbpPrev?.directions ?? 0, lastYear: hasGbpYearData ? (gbpLastYear?.directions ?? 0) : null },
    { label: "メニュークリック", value: gbpCurrent?.menuClicks ?? 0, format: formatNum, prev: gbpPrev?.menuClicks ?? 0, lastYear: hasGbpYearData ? (gbpLastYear?.menuClicks ?? 0) : null },
    { label: "予約", value: gbpCurrent?.reservation ?? 0, format: formatNum, prev: gbpPrev?.reservation ?? 0, lastYear: hasGbpYearData ? (gbpLastYear?.reservation ?? 0) : null },
    { label: "WEBサイト", value: gbpCurrent?.website ?? 0, format: formatNum, prev: gbpPrev?.website ?? 0, lastYear: hasGbpYearData ? (gbpLastYear?.website ?? 0) : null },
    { label: "保存・共有", value: gbpCurrent?.saveShare ?? 0, format: formatNum, prev: gbpPrev?.saveShare ?? 0, lastYear: hasGbpYearData ? (gbpLastYear?.saveShare ?? 0) : null },
  ];

  return (
    <div style={{ background: "#1a1a2e", minHeight: "100vh", paddingBottom: 40 }}>
      {backHref && (
        <div style={{ maxWidth: SLIDE_W, margin: "0 auto", padding: "16px 12px 0" }}>
          <a href={backHref} style={{ color: "#fff", fontSize: 14, textDecoration: "none", opacity: 0.85, display: "inline-flex", alignItems: "center", gap: 6 }}>
            ← グループ一覧へ戻る
          </a>
        </div>
      )}
      {/* P1: KPIサマリー */}
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

      {/* コンバージョン月次推移ページ（グラフなし・数値のみ） */}
      {hasConversion && (
        <div style={{ ...slideStyle, minHeight: "auto" }}>
          <div style={slideBarStyle}>
            <span>{shopName} — コンバージョン推移</span>
            <span>2 / {totalPages}</span>
          </div>
          <div style={{ ...slideBodyStyle, overflow: "visible" }}>
            <div style={stitleStyle}>コンバージョン月次推移</div>
            <div style={{ overflowX: "auto", border: "1px solid #e0e0e0", borderRadius: 8 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead><tr>
                  <th style={{ background: "#0f3460", color: "#fff", padding: "10px 14px", fontWeight: 600, textAlign: "left", whiteSpace: "nowrap" }}>指標</th>
                  {convLabels.map((lbl, i) => (
                    <th key={i} style={{ background: i === convLabels.length - 1 ? "#e94560" : "#0f3460", color: "#fff", padding: "10px 8px", fontWeight: 600, textAlign: "center", whiteSpace: "nowrap" }}>{lbl}</th>
                  ))}
                  <th style={{ background: "#16213e", color: "#fff", padding: "10px 14px", fontWeight: 600, textAlign: "center" }}>計</th>
                </tr></thead>
                <tbody>
                  {convMetrics.map((m, ri) => {
                    const values = convRows.map((r) => Number(r[m.key] || 0));
                    const total = values.reduce((s, v) => s + v, 0);
                    return (
                      <tr key={m.key} style={{ background: ri % 2 === 0 ? "#f8f9fa" : "#fff" }}>
                        <td style={{ padding: "9px 14px", fontWeight: 700, color: "#0f3460", whiteSpace: "nowrap" }}>{m.label}</td>
                        {values.map((v, i) => (
                          <td key={i} style={{ textAlign: "center", padding: "9px 8px", background: i === values.length - 1 ? "#fff8f0" : undefined }}>{v.toLocaleString()}</td>
                        ))}
                        <td style={{ textAlign: "center", padding: "9px 14px", fontWeight: 700, background: "#eef1f6" }}>{total.toLocaleString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 言語別ページ */}
      {languages.map((lang, langIdx) => {
        const mRows = monthlyByLang[lang];
        const dRows = dailyByLang[lang];
        return (
          <div key={lang} style={{ ...slideStyle, minHeight: "auto" }}>
            <div style={slideBarStyle}>
              <span>{shopName} — {lang}</span>
              <span>{2 + convOffset + langIdx} / {totalPages}</span>
            </div>
            <div style={{ ...slideBodyStyle, overflow: "visible" }}>
              <div style={stitleStyle}>月次推移</div>
              {mRows.length > 1 && (
                <div style={{ height: 220, marginBottom: 12 }}>
                  <Chart
                    type="bar"
                    data={{
                      labels: mRows.map(r => formatMonthShort(r.month || "")),
                      datasets: [
                        // 表示回数・クリック数は棒グラフ（先に定義＝先に描画され、線の背面になる。
                        // order指定は凡例の並び順まで変えてしまうので使わない）
                        { type: "bar" as const, label: "表示回数", data: mRows.map(r => r.impressions), yAxisID: "y", backgroundColor: monthlyLineColors.impressions, borderColor: monthlyLineColors.impressions, borderWidth: 0, borderRadius: 3 },
                        { type: "bar" as const, label: "クリック数", data: mRows.map(r => r.clicks), yAxisID: "y1", backgroundColor: monthlyLineColors.clicks, borderColor: monthlyLineColors.clicks, borderWidth: 0, borderRadius: 3 },
                        // クリック率・クリック単価は線グラフのまま
                        { type: "line" as const, label: "クリック率", data: mRows.map(r => r.ctr * 100), yAxisID: "y2", borderColor: monthlyLineColors.ctr, backgroundColor: monthlyLineColors.ctr, borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, tension: 0.3, fill: false },
                        { type: "line" as const, label: "クリック単価", data: mRows.map(r => r.averageCpc / 1_000_000), yAxisID: "y3", borderColor: monthlyLineColors.cpc, backgroundColor: monthlyLineColors.cpc, borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, tension: 0.3, fill: false },
                      ],
                    }}
                    options={{
                      responsive: true, maintainAspectRatio: false,
                      plugins: {
                        legend: { display: true, position: "bottom", labels: { boxWidth: 14, padding: 16, usePointStyle: false } },
                        tooltip: {
                          callbacks: {
                            label: (ctx) => {
                              const v = ctx.parsed.y ?? 0;
                              if (ctx.dataset.label === "クリック率") return `クリック率: ${v.toFixed(2)}%`;
                              if (ctx.dataset.label === "クリック単価") return `クリック単価: ¥${v.toFixed(1)}`;
                              return `${ctx.dataset.label}: ${Math.round(v).toLocaleString()}`;
                            },
                          },
                        },
                      },
                      scales: {
                        x: { grid: { display: false } },
                        y: { beginAtZero: true, position: "left", grid: { color: "#f0f0f0" }, ticks: { callback: (v) => Number(v).toLocaleString() } },
                        y1: { beginAtZero: true, position: "right", grid: { drawOnChartArea: false }, ticks: { callback: (v) => Number(v).toLocaleString() } },
                        y2: { display: false, beginAtZero: true },
                        y3: { display: false, beginAtZero: true },
                      },
                    }}
                  />
                </div>
              )}
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead><tr>
                  <th style={{ background: "#0f3460", color: "#fff", padding: "8px 10px", fontWeight: 600 }}>月</th>
                  {mRows.map((r, i) => <th key={i} style={{ background: i === mRows.length - 1 ? "#e94560" : "#0f3460", color: "#fff", padding: "8px 6px", fontWeight: 600, textAlign: "center" }}>{formatMonthShort(r.month || "")}</th>)}
                </tr></thead>
                <tbody>
                  {(["impressions", "clicks", "ctr", "averageCpc", "costMicros"] as const).map((field, ri) => (
                    <tr key={field} style={{ background: ri % 2 === 0 ? "#f8f9fa" : "#f8f9fb" }}>
                      <td style={{ padding: "6px 10px", fontWeight: 600, color: "#666" }}>{{ impressions: "表示回数", clicks: "クリック数", ctr: "クリック率", averageCpc: "平均クリック単価", costMicros: "広告費" }[field]}</td>
                      {mRows.map((r, i) => (
                        <td key={i} style={{ textAlign: "center", padding: "6px", fontWeight: field === "costMicros" ? 700 : undefined, background: i === mRows.length - 1 ? "#fff8f0" : undefined }}>
                          {field === "impressions" ? r.impressions.toLocaleString() : field === "clicks" ? r.clicks.toLocaleString() : field === "ctr" ? formatCtr(r.ctr) : field === "averageCpc" ? formatCpc(r.averageCpc) : formatCost(r.costMicros)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {dRows.length > 0 && (
                <>
                  <div style={{ ...stitleStyle, marginTop: 24, marginBottom: 10 }}>日次データ{dRows[0]?.date ? `（${new Date(dRows[0].date).getMonth() + 1}月）` : ""}</div>
                  <div style={{ overflowY: "auto", maxHeight: 280, border: "1px solid #e0e0e0", borderRadius: 8 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <thead><tr>
                        {["日付", "表示回数", "クリック数", "クリック率", "平均クリック単価", "広告費"].map((h, i) => (
                          <th key={h} style={{ background: "#0f3460", color: "#fff", padding: "8px 12px", fontWeight: 600, textAlign: i === 0 ? "left" : "center", position: "sticky", top: 0, zIndex: 1 }}>{h}</th>
                        ))}
                      </tr></thead>
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

      {/* 媒体別配信比率ページ（円グラフ） */}
      {hasChannels && (
        <div style={slideStyle}>
          <div style={slideBarStyle}>
            <span>{shopName} — 媒体別配信比率</span>
            <span>{2 + convOffset + languages.length} / {totalPages}</span>
          </div>
          <div style={slideBodyStyle}>
            <div style={stitleStyle}>媒体別配信比率（{currentMonth}）</div>
            <div style={{ display: "flex", gap: 24, alignItems: "stretch" }}>
              <div style={{ background: "#fff", borderRadius: 12, padding: 28, width: 440, flexShrink: 0, boxShadow: "0 1px 6px rgba(0,0,0,.04)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div style={{ width: 370, height: 370 }}>
                  <Pie
                    data={{
                      labels: channelAgg.items.filter((i) => i.impressions > 0).map((i) => i.label),
                      datasets: [{
                        data: channelAgg.items.filter((i) => i.impressions > 0).map((i) => i.impressions),
                        backgroundColor: channelAgg.items.filter((i) => i.impressions > 0).map((i) => i.color),
                        borderColor: "#fff",
                        borderWidth: 2,
                      }],
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: { display: false },
                        tooltip: {
                          callbacks: {
                            label: (ctx) => {
                              const v = Number(ctx.parsed) || 0;
                              return ` ${ctx.label}: ${channelPct(v)}%（${v.toLocaleString()}回）`;
                            },
                          },
                        },
                      },
                    }}
                  />
                </div>
              </div>
              <div style={{ flex: 1, background: "#fff", borderRadius: 12, padding: "14px 26px", boxShadow: "0 1px 6px rgba(0,0,0,.04)", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                <div style={{ display: "flex", alignItems: "center", padding: "6px 0 10px", borderBottom: "2px solid #0f3460", fontSize: 12, fontWeight: 700, color: "#888" }}>
                  <span style={{ flex: 1 }}>配信先</span>
                  <span style={{ width: 110, textAlign: "right" }}>表示回数</span>
                  <span style={{ width: 80, textAlign: "right" }}>割合</span>
                </div>
                {channelAgg.items.map((it, i) => (
                  <div key={it.label} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: "1px solid #eef0f4", opacity: it.impressions === 0 ? 0.45 : 1 }}>
                    <span style={{ width: 20, fontSize: 13, fontWeight: 700, color: "#9aa3b2" }}>{i + 1}</span>
                    <span style={{ width: 14, height: 14, borderRadius: 4, background: it.color, border: "1px solid rgba(11,11,11,.12)", flexShrink: 0 }} />
                    <span style={{ fontSize: 15, fontWeight: 600, color: "#333", flex: 1 }}>{it.label}</span>
                    <span style={{ width: 110, textAlign: "right", fontSize: 13, color: "#888", fontVariantNumeric: "tabular-nums" }}>{it.impressions.toLocaleString()}回</span>
                    <span style={{ width: 80, textAlign: "right", fontSize: 18, fontWeight: 800, color: "#0f3460", fontVariantNumeric: "tabular-nums" }}>{channelPct(it.impressions)}%</span>
                  </div>
                ))}
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0 4px" }}>
                  <span style={{ width: 20 }} />
                  <span style={{ width: 14 }} />
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#0f3460", flex: 1 }}>合計</span>
                  <span style={{ width: 110, textAlign: "right", fontSize: 14, fontWeight: 700, color: "#0f3460", fontVariantNumeric: "tabular-nums" }}>{channelAgg.total.toLocaleString()}回</span>
                  <span style={{ width: 80, textAlign: "right", fontSize: 14, fontWeight: 700, color: "#0f3460" }}>100%</span>
                </div>
              </div>
            </div>
            <div style={{ fontSize: 11, color: "#888", marginTop: 12, lineHeight: 1.6 }}>
              ※ 対象月のGoogle広告の表示回数を配信先ネットワーク別に集計した割合です。P-MAX広告は成果が最大になるよう配信先を自動で最適化します。
            </div>
          </div>
        </div>
      )}

      {/* まとめページ */}
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
