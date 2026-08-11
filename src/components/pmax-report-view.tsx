"use client";

import { useState } from "react";
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
import { buildPmaxAdvice } from "@/lib/pmax-advice";
import {
  applyAdsOverrides,
  applyGbpOverrides,
  GBP_OVERRIDE_FIELDS,
  EMPTY_PMAX_SETTINGS,
  type PmaxReportSettings,
} from "@/lib/pmax-overrides";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, LineController, BarElement, BarController, ArcElement, Title, Tooltip, Legend);

// 店舗様へのアドバイスページの全体スイッチ。
// 2026-08-07 ユーザー依頼で全店舗非表示（コード・ロジックは温存。再開時は true に戻すだけ）
const SHOW_ADVICE_PAGE = false;

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
// 月次推移の色（指標に固定: 表示回数=赤/クリック数=青/クリック率=黄/クリック単価=緑）
// 棒（表示回数・クリック数）は前面の折れ線を隠さないよう半透明にする
const monthlyLineColors = { impressions: "#e53935", clicks: "#1e88e5", ctr: "#fdd835", cpc: "#43a047" } as const;
const monthlyBarColors = { impressions: "rgba(229,57,53,.38)", clicks: "rgba(30,136,229,.38)" } as const;
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

function KpiCard({ kpi, colorIdx, valueNode }: { kpi: { label: string; value: number; format: (v: number) => string; prev: number; lastYear: number | null }; colorIdx: number; valueNode?: React.ReactNode }) {
  return (
    <div style={{ background: "#fff", borderRadius: 12, padding: "14px 16px", position: "relative", overflow: "hidden", boxShadow: "0 1px 6px rgba(0,0,0,.04)" }}>
      <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: 3, background: kpiTopColors[colorIdx % kpiTopColors.length] }} />
      <div style={{ fontSize: 12, color: "#888", fontWeight: 500 }}>{kpi.label}</div>
      <div style={{ fontSize: 24, fontWeight: 900, lineHeight: 1.1, margin: "4px 0 6px" }}>{valueNode ?? kpi.format(kpi.value)}</div>
      <ComparisonBadge current={kpi.value} previous={kpi.prev} label="前月比" format={kpi.format} />
      {kpi.lastYear !== null && <ComparisonBadge current={kpi.value} previous={kpi.lastYear} label="前年比" format={kpi.format} />}
    </div>
  );
}

/**
 * P-MAX 店舗レポートの表示コンポーネント。
 * データ取得は各ページ側で行い、結果をpropsで渡す。
 * @param backHref 指定すると左上に「戻る」リンクを表示（グループページから遷移した場合など）
 * @param settings 表示設定＋数値上書き（共有ページでも渡されるとレポートに反映される）
 * @param editable trueで「表示設定」「数値を編集」ボタンを表示（管理画面のみ）。
 *                 編集内容は onSettingsChange 経由で親がDB保存する。
 */
export default function PmaxReportView({ data, backHref, settings, editable = false, onSettingsChange, saveState = "" }: {
  data: PmaxReportData;
  backHref?: string;
  settings?: PmaxReportSettings;
  editable?: boolean;
  onSettingsChange?: (next: PmaxReportSettings) => void;
  saveState?: "" | "saving" | "saved" | "error";
}) {
  const { monthly, daily, gbp: gbpRaw, channels: channelsRaw = [], shopName, year: targetYear, month: targetMonthNum, summaryText: summaryTextRaw = "" } = data;
  const { overrides, sectionVisibility, summaryOverride } = settings || EMPTY_PMAX_SETTINGS;
  // 手動編集した「まとめ」文章があればそちらを優先表示（AI生成文は上書きしない）
  // マークダウン強調(**)は過去に保存された文面に混入している可能性があるため表示時に除去
  const summaryText = (summaryOverride || summaryTextRaw).replace(/\*\*/g, "");
  // 表示設定: 未設定キーは表示（falseだけ非表示）
  const vis = (key: string) => sectionVisibility[key] !== false;
  const canEdit = editable && !!onSettingsChange;

  // 編集モード（数値クリック→インライン入力）
  const [editMode, setEditMode] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // 同じ上書きキー（g|<月>|<field>）がKPIサマリーとコンバージョン表など複数箇所に
  // 同時に描画されるため、「今どのインスタンスが入力欄になっているか」は別IDで区別する
  // （区別しないと両方に同時にinput autoFocusが生成され、後者へブラウザが自動スクロールしてしまう）
  const [activeUiId, setActiveUiId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [summaryEditing, setSummaryEditing] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState("");

  // ── データ集計 ──
  const currentMonthKey = `${targetYear}-${String(targetMonthNum).padStart(2, "0")}`;
  const prevMonthDate = new Date(targetYear, targetMonthNum - 2, 1);
  const prevMonthKey = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, "0")}`;
  const lastYearMonthKey = `${targetYear - 1}-${String(targetMonthNum).padStart(2, "0")}`;

  // GBP行・チャネル行はコピーしてから数値上書きを適用（元データは変更しない）
  const gbpRows: GbpRow[] = gbpRaw.map((r) => ({ ...r }));
  for (const r of gbpRows) applyGbpOverrides(r, overrides);
  const channels: ChannelRow[] = channelsRaw.map((r) => ({ ...r }));
  for (const r of channels) {
    const v = overrides[`c|${currentMonthKey}|${r.network}|impressions`];
    if (v !== undefined) r.impressions = v;
  }

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
    const monthAgg = Array.from(monthMap.values());
    // 手動編集（数値上書き）を集計後の行に適用
    for (const row of monthAgg) applyAdsOverrides(row, `m|${lang}|${row.month || ""}`, overrides);
    monthlyByLang[lang] = monthAgg.sort((a, b) => (a.month || "").localeCompare(b.month || ""));

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
    const dayAgg = Array.from(dayMap.values());
    for (const row of dayAgg) applyAdsOverrides(row, `d|${lang}|${row.date || ""}`, overrides);
    dailyByLang[lang] = dayAgg.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  }

  // 集計は上書き適用済みの言語別月次行から行う（言語別テーブルとKPIサマリーの整合を保つ）。
  // さらに k|<月>|<field> の直接上書きがあれば合計値そのものを差し替える。
  function getAdsMonthTotal(monthKey: string) {
    const t = { impressions: 0, clicks: 0, costMicros: 0, ctr: 0, averageCpc: 0 };
    for (const lang of languages) {
      for (const r of monthlyByLang[lang] || []) {
        if ((r.month || "").startsWith(monthKey)) {
          t.impressions += r.impressions; t.clicks += r.clicks; t.costMicros += r.costMicros;
        }
      }
    }
    const oImp = overrides[`k|${monthKey}|impressions`];
    if (oImp !== undefined) t.impressions = oImp;
    const oClk = overrides[`k|${monthKey}|clicks`];
    if (oClk !== undefined) t.clicks = oClk;
    const oCost = overrides[`k|${monthKey}|costYen`];
    if (oCost !== undefined) t.costMicros = Math.round(oCost * 1_000_000);
    t.ctr = t.impressions > 0 ? t.clicks / t.impressions : 0;
    t.averageCpc = t.clicks > 0 ? t.costMicros / t.clicks : 0;
    return t;
  }
  const adsCurrent = getAdsMonthTotal(currentMonthKey);
  const adsPrev = getAdsMonthTotal(prevMonthKey);
  const adsLastYear = getAdsMonthTotal(lastYearMonthKey);
  const hasYearData = adsLastYear.impressions > 0 || adsLastYear.clicks > 0 || adsLastYear.costMicros > 0;

  const gbpCurrentKey = `${targetYear}/${String(targetMonthNum).padStart(2, "0")}`;
  const gbpPrevKeyVal = `${prevMonthDate.getFullYear()}/${String(prevMonthDate.getMonth() + 1).padStart(2, "0")}`;
  const gbpLastYearKey = `${targetYear - 1}/${String(targetMonthNum).padStart(2, "0")}`;
  // GBP行が無い月でも手動上書きがあれば0埋め行を合成して表示する（KPIカード編集用）
  const findGbp = (mKey: string): GbpRow | undefined => {
    const row = gbpRows.find(r => r.month === mKey);
    if (row) return row;
    if (GBP_OVERRIDE_FIELDS.some((f) => overrides[`g|${mKey}|${f}`] !== undefined)) {
      const synth: GbpRow = { month: mKey, shopName, totalImpressions: 0, totalVisits: 0, phone: 0, directions: 0, website: 0, menuClicks: 0, saveShare: 0, reservation: 0 };
      applyGbpOverrides(synth, overrides);
      return synth;
    }
    return undefined;
  };
  const gbpCurrent = findGbp(gbpCurrentKey);
  const gbpPrev = findGbp(gbpPrevKeyVal);
  const gbpLastYear = findGbp(gbpLastYearKey);
  const hasGbpYearData = !!gbpLastYear;

  const hasSummary = summaryText.length > 0 && vis("summary");

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
    { key: "saveShare", label: "保存・共有・写真" },
  ];
  const hasConversion = convRows.length > 0 && vis("conversion");
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
    const items: { label: string; color: string; impressions: number; network: string }[] = CHANNEL_DEFS.map((d) => ({
      label: d.label, color: d.color, impressions: byKey.get(d.key) || 0, network: d.key,
    }));
    if (otherImp > 0) items.push({ label: CHANNEL_OTHER.label, color: CHANNEL_OTHER.color, impressions: otherImp, network: "" });
    items.sort((a, b) => b.impressions - a.impressions);
    const total = items.reduce((s, i) => s + i.impressions, 0);
    return { items, total };
  })();
  const hasChannels = channelAgg.total > 0 && vis("channels");
  const channelOffset = hasChannels ? 1 : 0;
  const channelPct = (imp: number) => (channelAgg.total > 0 ? ((imp / channelAgg.total) * 100).toFixed(1) : "0.0");

  // 店舗様へのアドバイス（営業商談の原文引用ベース・当月数値に合致した項目のみ）
  const adviceParagraphs = (() => {
    const gbpActionTotal = (r?: GbpRow) =>
      r ? r.totalVisits + r.phone + r.directions + r.website + r.menuClicks + r.saveShare + r.reservation : 0;
    // マップ+検索の配信割合（チャネル生データから。集計が無い月はnull）
    const channelTotalImp = channels.reduce((s, r) => s + r.impressions, 0);
    const mapsSearchImp = channels.filter((r) => r.network === "MAPS" || r.network === "SEARCH").reduce((s, r) => s + r.impressions, 0);
    // 当月の言語別平均クリック単価（クリックが発生した言語のみ）
    const langCpcs = languages.flatMap((lang) => {
      const row = (monthlyByLang[lang] || []).find((r) => (r.month || "").startsWith(currentMonthKey));
      if (!row || row.clicks <= 0) return [];
      return [{ language: lang, cpcYen: row.averageCpc / 1_000_000 }];
    });
    return buildPmaxAdvice({
      impressions: adsCurrent.impressions,
      prevImpressions: adsPrev.impressions,
      clicks: adsCurrent.clicks,
      prevClicks: adsPrev.clicks,
      ctr: adsCurrent.ctr,
      prevCtr: adsPrev.ctr,
      cpcYen: adsCurrent.averageCpc / 1_000_000,
      prevCpcYen: adsPrev.averageCpc / 1_000_000,
      // GBP行が無い月は「未計測」としてnullを渡す（0件との混同禁止・重要ナレッジ2026-07-31）
      mapActionsTotal: gbpCurrent ? gbpActionTotal(gbpCurrent) : null,
      mapsSearchSharePct: channelTotalImp > 0 ? (mapsSearchImp / channelTotalImp) * 100 : null,
      langCpcs,
      saveShare: gbpCurrent ? gbpCurrent.saveShare : null,
      prevSaveShare: gbpPrev ? gbpPrev.saveShare : null,
    });
  })();
  const hasAdvice = SHOW_ADVICE_PAGE && vis("advice") && adviceParagraphs.length > 0;
  const adviceOffset = hasAdvice ? 1 : 0;

  // 表示設定でOFFにした言語ページは描画・ページ番号の両方から除外
  const visibleLanguages = languages.filter((lang) => vis(`lang|${lang}`));
  const showDaily = vis("daily");

  const totalPages = 1 + convOffset + visibleLanguages.length + channelOffset + adviceOffset + (hasSummary ? 1 : 0);

  // ── 編集モード: 数値クリック→インライン入力。空で確定すると元の値に戻す ──
  const commitEdit = () => {
    if (!activeKey || !onSettingsChange) { setActiveKey(null); setActiveUiId(null); return; }
    const key = activeKey;
    setActiveKey(null);
    setActiveUiId(null);
    const t = draft.trim().replace(/[,，¥￥%％\s]/g, "");
    const next = { ...overrides };
    if (t === "") {
      if (next[key] === undefined) return;
      delete next[key];
    } else {
      const n = Number(t);
      if (!Number.isFinite(n) || n < 0) return;
      if (next[key] === n) return;
      next[key] = n;
    }
    onSettingsChange({ overrides: next, sectionVisibility, summaryOverride });
  };

  /**
   * 編集対応の数値表示。編集モード中はクリックで入力欄に切り替わる。
   * @param uiId 入力欄インスタンスの識別子（省略時はkey）。同じ上書きキーを別々の場所
   *             （KPIサマリーとコンバージョン表など）に描画する場合は必ず別々のuiIdを渡すこと。
   *             同一uiIdが複数箇所にあると、複数のinput autoFocusが同時に生成され
   *             ブラウザが最後の要素へ自動スクロールしてしまう。
   */
  const ed = (key: string, display: string, rawForInput: number | string, uiId: string = key) => {
    if (!canEdit || !editMode) return <>{display}</>;
    if (activeUiId === uiId) {
      return (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitEdit();
            else if (e.key === "Escape") { setActiveKey(null); setActiveUiId(null); }
          }}
          style={{ width: 80, maxWidth: "100%", fontSize: "inherit", fontWeight: "inherit", textAlign: "center", border: "1.5px solid #e94560", borderRadius: 4, padding: "1px 4px", color: "#1a1a2e", background: "#fff", boxSizing: "border-box" }}
        />
      );
    }
    const isOverridden = overrides[key] !== undefined;
    return (
      <span
        onClick={() => { setActiveKey(key); setActiveUiId(uiId); setDraft(String(rawForInput)); }}
        title={isOverridden ? "手動編集済み。クリックで再編集（空にして確定すると元の値に戻ります）" : "クリックして編集"}
        style={{ cursor: "pointer", borderBottom: "1.5px dashed #e94560", background: isOverridden ? "rgba(233,69,96,.14)" : undefined, borderRadius: 2 }}
      >{display}</span>
    );
  };

  const toggleSection = (key: string) => {
    if (!onSettingsChange) return;
    onSettingsChange({ overrides, sectionVisibility: { ...sectionVisibility, [key]: !vis(key) }, summaryOverride });
  };

  const kpiCards = [
    { label: "総表示回数", value: adsCurrent.impressions, format: formatNum, prev: adsPrev.impressions, lastYear: hasYearData ? adsLastYear.impressions : null, editKey: `k|${currentMonthKey}|impressions`, editRaw: adsCurrent.impressions },
    { label: "総クリック", value: adsCurrent.clicks, format: formatNum, prev: adsPrev.clicks, lastYear: hasYearData ? adsLastYear.clicks : null, editKey: `k|${currentMonthKey}|clicks`, editRaw: adsCurrent.clicks },
    { label: "総広告費", value: adsCurrent.costMicros, format: formatCost, prev: adsPrev.costMicros, lastYear: hasYearData ? adsLastYear.costMicros : null, editKey: `k|${currentMonthKey}|costYen`, editRaw: Math.round(adsCurrent.costMicros / 1_000_000) },
    { label: "合計来店数", value: gbpCurrent?.totalVisits ?? 0, format: formatNum, prev: gbpPrev?.totalVisits ?? 0, lastYear: hasGbpYearData ? (gbpLastYear?.totalVisits ?? 0) : null, editKey: `g|${gbpCurrentKey}|totalVisits`, editRaw: gbpCurrent?.totalVisits ?? 0 },
    { label: "電話", value: gbpCurrent?.phone ?? 0, format: formatNum, prev: gbpPrev?.phone ?? 0, lastYear: hasGbpYearData ? (gbpLastYear?.phone ?? 0) : null, editKey: `g|${gbpCurrentKey}|phone`, editRaw: gbpCurrent?.phone ?? 0 },
    { label: "経路案内", value: gbpCurrent?.directions ?? 0, format: formatNum, prev: gbpPrev?.directions ?? 0, lastYear: hasGbpYearData ? (gbpLastYear?.directions ?? 0) : null, editKey: `g|${gbpCurrentKey}|directions`, editRaw: gbpCurrent?.directions ?? 0 },
    { label: "メニュークリック", value: gbpCurrent?.menuClicks ?? 0, format: formatNum, prev: gbpPrev?.menuClicks ?? 0, lastYear: hasGbpYearData ? (gbpLastYear?.menuClicks ?? 0) : null, editKey: `g|${gbpCurrentKey}|menuClicks`, editRaw: gbpCurrent?.menuClicks ?? 0 },
    { label: "予約", value: gbpCurrent?.reservation ?? 0, format: formatNum, prev: gbpPrev?.reservation ?? 0, lastYear: hasGbpYearData ? (gbpLastYear?.reservation ?? 0) : null, editKey: `g|${gbpCurrentKey}|reservation`, editRaw: gbpCurrent?.reservation ?? 0 },
    { label: "WEBサイト", value: gbpCurrent?.website ?? 0, format: formatNum, prev: gbpPrev?.website ?? 0, lastYear: hasGbpYearData ? (gbpLastYear?.website ?? 0) : null, editKey: `g|${gbpCurrentKey}|website`, editRaw: gbpCurrent?.website ?? 0 },
    { label: "保存・共有・写真", value: gbpCurrent?.saveShare ?? 0, format: formatNum, prev: gbpPrev?.saveShare ?? 0, lastYear: hasGbpYearData ? (gbpLastYear?.saveShare ?? 0) : null, editKey: `g|${gbpCurrentKey}|saveShare`, editRaw: gbpCurrent?.saveShare ?? 0 },
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
            {kpiCards.slice(0, 3).map((kpi, i) => <KpiCard key={kpi.label} kpi={kpi} colorIdx={i} valueNode={canEdit ? ed(kpi.editKey, kpi.format(kpi.value), kpi.editRaw, `kpi:${kpi.editKey}`) : undefined} />)}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 14 }}>
            {kpiCards.slice(3, 6).map((kpi, i) => <KpiCard key={kpi.label} kpi={kpi} colorIdx={i + 3} valueNode={canEdit ? ed(kpi.editKey, kpi.format(kpi.value), kpi.editRaw, `kpi:${kpi.editKey}`) : undefined} />)}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 14 }}>
            {kpiCards.slice(6, 10).map((kpi, i) => <KpiCard key={kpi.label} kpi={kpi} colorIdx={i + 6} valueNode={canEdit ? ed(kpi.editKey, kpi.format(kpi.value), kpi.editRaw, `kpi:${kpi.editKey}`) : undefined} />)}
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
                          <td key={i} style={{ textAlign: "center", padding: "9px 8px", background: i === values.length - 1 ? "#fff8f0" : undefined }}>
                            {ed(`g|${convRows[i].month}|${m.key}`, v.toLocaleString(), v)}
                          </td>
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

      {/* 言語別ページ（表示設定でOFFの言語は出さない） */}
      {visibleLanguages.map((lang, langIdx) => {
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
                        // 表示回数・クリック数は棒グラフ（order大 = 先に描画され折れ線の背面になる）
                        { type: "bar" as const, label: "表示回数", data: mRows.map(r => r.impressions), yAxisID: "y", backgroundColor: monthlyBarColors.impressions, borderColor: monthlyBarColors.impressions, borderWidth: 0, borderRadius: 3, order: 2 },
                        { type: "bar" as const, label: "クリック数", data: mRows.map(r => r.clicks), yAxisID: "y1", backgroundColor: monthlyBarColors.clicks, borderColor: monthlyBarColors.clicks, borderWidth: 0, borderRadius: 3, order: 2 },
                        // クリック率・クリック単価は線グラフ（order小 = 前面）
                        { type: "line" as const, label: "クリック率", data: mRows.map(r => r.ctr * 100), yAxisID: "y2", borderColor: monthlyLineColors.ctr, backgroundColor: monthlyLineColors.ctr, borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, tension: 0.3, fill: false, order: 1 },
                        { type: "line" as const, label: "クリック単価", data: mRows.map(r => r.averageCpc / 1_000_000), yAxisID: "y3", borderColor: monthlyLineColors.cpc, backgroundColor: monthlyLineColors.cpc, borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, tension: 0.3, fill: false, order: 1 },
                      ],
                    }}
                    options={{
                      responsive: true, maintainAspectRatio: false,
                      plugins: {
                        // orderを付けるとChart.jsは凡例もorder順に並べ替えるため、datasetIndex順に戻す
                        legend: { display: true, position: "bottom", labels: { boxWidth: 14, padding: 16, usePointStyle: false, sort: (a, b) => (a.datasetIndex ?? 0) - (b.datasetIndex ?? 0) } },
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
                      {mRows.map((r, i) => {
                        const prefix = `m|${lang}|${r.month || ""}`;
                        const cell =
                          field === "impressions" ? ed(`${prefix}|impressions`, r.impressions.toLocaleString(), r.impressions)
                          : field === "clicks" ? ed(`${prefix}|clicks`, r.clicks.toLocaleString(), r.clicks)
                          : field === "ctr" ? ed(`${prefix}|ctrPct`, formatCtr(r.ctr), +(r.ctr * 100).toFixed(2))
                          : field === "averageCpc" ? ed(`${prefix}|cpcYen`, formatCpc(r.averageCpc), +(r.averageCpc / 1_000_000).toFixed(1))
                          : ed(`${prefix}|costYen`, formatCost(r.costMicros), Math.round(r.costMicros / 1_000_000));
                        return (
                          <td key={i} style={{ textAlign: "center", padding: "6px", fontWeight: field === "costMicros" ? 700 : undefined, background: i === mRows.length - 1 ? "#fff8f0" : undefined }}>
                            {cell}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {showDaily && dRows.length > 0 && (
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
                        {dRows.map((r, i) => {
                          const prefix = `d|${lang}|${r.date || ""}`;
                          return (
                          <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#f8f9fb" }}>
                            <td style={{ padding: "6px 12px", fontWeight: 600, color: "#666", whiteSpace: "nowrap" }}>{formatDate(r.date || "")}</td>
                            <td style={{ textAlign: "center", padding: "6px 12px" }}>{ed(`${prefix}|impressions`, r.impressions.toLocaleString(), r.impressions)}</td>
                            <td style={{ textAlign: "center", padding: "6px 12px" }}>{ed(`${prefix}|clicks`, r.clicks.toLocaleString(), r.clicks)}</td>
                            <td style={{ textAlign: "center", padding: "6px 12px" }}>{ed(`${prefix}|ctrPct`, formatCtr(r.ctr), +(r.ctr * 100).toFixed(2))}</td>
                            <td style={{ textAlign: "center", padding: "6px 12px" }}>{ed(`${prefix}|cpcYen`, formatCpc(r.averageCpc), +(r.averageCpc / 1_000_000).toFixed(1))}</td>
                            <td style={{ textAlign: "center", padding: "6px 12px", fontWeight: 700 }}>{ed(`${prefix}|costYen`, formatCost(r.costMicros), Math.round(r.costMicros / 1_000_000))}</td>
                          </tr>
                          );
                        })}
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
            <span>{2 + convOffset + visibleLanguages.length} / {totalPages}</span>
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
                    <span style={{ width: 110, textAlign: "right", fontSize: 13, color: "#888", fontVariantNumeric: "tabular-nums" }}>
                      {it.network ? ed(`c|${currentMonthKey}|${it.network}|impressions`, it.impressions.toLocaleString(), it.impressions) : it.impressions.toLocaleString()}回
                    </span>
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

      {/* 店舗様へのアドバイスページ（最終ページの1つ前） */}
      {hasAdvice && (
        <div style={slideStyle}>
          <div style={slideBarStyle}>
            <span>{shopName} — アドバイス</span>
            <span>{2 + convOffset + visibleLanguages.length + channelOffset} / {totalPages}</span>
          </div>
          {/* 溢れた場合に下だけ切れるよう flex-start（タイトル消失防止） */}
          <div style={{ ...slideBodyStyle, justifyContent: "flex-start", paddingTop: 36 }}>
            <div style={stitleStyle}>店舗様へのアドバイス</div>
            <div style={{ background: "#fff", borderRadius: 12, padding: "24px 28px", fontSize: 15, lineHeight: 1.8, color: "#333" }}>
              {adviceParagraphs.map((p, i) => (
                <p key={i} style={{ margin: i === 0 ? 0 : "14px 0 0" }}>{p}</p>
              ))}
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
            {canEdit && editMode ? (
              summaryEditing ? (
                <div>
                  <textarea
                    autoFocus
                    value={summaryDraft}
                    onChange={(e) => setSummaryDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Escape") setSummaryEditing(false); }}
                    style={{ width: "100%", minHeight: 260, fontSize: 15, lineHeight: 1.8, color: "#333", padding: "24px 28px", borderRadius: 12, border: "1.5px solid #e94560", boxSizing: "border-box", fontFamily: "inherit", resize: "vertical" }}
                  />
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button
                      onClick={() => {
                        setSummaryEditing(false);
                        if (!onSettingsChange) return;
                        const next = summaryDraft.trim() === "" ? "" : summaryDraft;
                        if (next === summaryOverride) return;
                        onSettingsChange({ overrides, sectionVisibility, summaryOverride: next });
                      }}
                      style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: "#e94560", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                    >
                      保存
                    </button>
                    <button
                      onClick={() => setSummaryEditing(false)}
                      style={{ padding: "8px 20px", borderRadius: 8, border: "1px solid #ccc", background: "#fff", color: "#666", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                    >
                      キャンセル
                    </button>
                    {summaryOverride && (
                      <button
                        onClick={() => {
                          if (!confirm("手動編集を取り消してAI生成文に戻します。よろしいですか？")) return;
                          setSummaryEditing(false);
                          onSettingsChange?.({ overrides, sectionVisibility, summaryOverride: "" });
                        }}
                        style={{ padding: "8px 20px", borderRadius: 8, border: "1px solid #f0c0c8", background: "#fef1f3", color: "#c0392b", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                      >
                        AI生成文に戻す
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div
                  onClick={() => { setSummaryEditing(true); setSummaryDraft(summaryText); }}
                  title="クリックして編集"
                  style={{ background: "#fff", borderRadius: 12, padding: "24px 28px", fontSize: 15, lineHeight: 1.8, color: "#333", whiteSpace: "pre-wrap", cursor: "pointer", border: summaryOverride ? "1.5px dashed #e94560" : "1.5px dashed transparent" }}
                >
                  {summaryText}
                  <div style={{ fontSize: 11, color: "#e94560", marginTop: 12, fontWeight: 600 }}>
                    クリックして編集{summaryOverride ? "（手動編集済み）" : ""}
                  </div>
                </div>
              )
            ) : (
              <div style={{ background: "#fff", borderRadius: 12, padding: "24px 28px", fontSize: 15, lineHeight: 1.8, color: "#333", whiteSpace: "pre-wrap" }}>
                {summaryText}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 編集ツールバー（管理画面のみ・印刷/共有ページには出ない） */}
      {canEdit && (
        <div className="no-print" style={{ position: "fixed", right: 20, bottom: 20, zIndex: 120, display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          {editMode && (
            <div style={{ background: "rgba(233,69,96,.95)", color: "#fff", padding: "10px 14px", borderRadius: 10, fontSize: 12, maxWidth: 280, lineHeight: 1.7, boxShadow: "0 4px 16px rgba(0,0,0,.3)" }}>
              編集モード中：赤い点線の数値をクリックすると変更できます。空にして確定すると元の値に戻ります。変更は自動保存され、共有URLにもそのまま反映されます。
            </div>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {saveState && (
              <span style={{ fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 20, background: saveState === "error" ? "rgba(244,67,54,.9)" : "rgba(255,255,255,.15)", color: "#fff" }}>
                {saveState === "saving" ? "保存中..." : saveState === "saved" ? "保存済み" : "保存失敗（再編集で再試行）"}
              </span>
            )}
            <button
              onClick={() => setShowSettings(true)}
              style={{ padding: "10px 18px", borderRadius: 10, border: "1px solid rgba(255,255,255,.3)", background: "#16213e", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 16px rgba(0,0,0,.3)" }}
            >
              表示設定
            </button>
            <button
              onClick={() => { setEditMode(!editMode); setActiveKey(null); setActiveUiId(null); setSummaryEditing(false); }}
              style={{ padding: "10px 18px", borderRadius: 10, border: "none", background: editMode ? "#e94560" : "#0f3460", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 16px rgba(0,0,0,.3)" }}
            >
              {editMode ? "編集を終了" : "数値を編集"}
            </button>
          </div>
        </div>
      )}

      {/* 表示設定モーダル */}
      {canEdit && showSettings && (
        <div
          className="no-print"
          style={{ position: "fixed", inset: 0, zIndex: 130, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => setShowSettings(false)}
        >
          <div style={{ background: "#fff", borderRadius: 14, maxWidth: 440, width: "100%", maxHeight: "80vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ background: "linear-gradient(135deg,#1a1a2e,#0f3460)", padding: "14px 20px", borderRadius: "14px 14px 0 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#fff" }}>表示設定</h3>
              <button onClick={() => setShowSettings(false)} style={{ background: "none", border: "none", color: "#fff", fontSize: 20, cursor: "pointer", lineHeight: 1 }}>&times;</button>
            </div>
            <div style={{ padding: "16px 20px" }}>
              <p style={{ margin: "0 0 12px", fontSize: 12, color: "#888", lineHeight: 1.6 }}>
                OFFにしたページは管理画面・共有URLの両方で非表示になります（設定は店舗ごとに保存）。
              </p>
              {([
                { key: "conversion", label: "コンバージョン推移", enabled: convRows.length > 0 },
                ...languages.map((lang) => ({ key: `lang|${lang}`, label: `言語別ページ: ${lang}`, enabled: true })),
                { key: "daily", label: "日次データ表（言語別ページ内）", enabled: true },
                { key: "channels", label: "媒体別配信比率", enabled: channelAgg.total > 0 },
                ...(SHOW_ADVICE_PAGE ? [{ key: "advice", label: "店舗様へのアドバイス", enabled: true }] : []),
                { key: "summary", label: "まとめ", enabled: summaryText.length > 0 },
              ]).map((item) => (
                <label key={item.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 4px", borderBottom: "1px solid #f0f0f5", cursor: "pointer", opacity: item.enabled ? 1 : 0.5 }}>
                  <span style={{ fontSize: 14, color: "#333" }}>
                    {item.label}
                    {!item.enabled && <span style={{ fontSize: 11, color: "#aaa", marginLeft: 6 }}>（この月はデータなし）</span>}
                  </span>
                  <input
                    type="checkbox"
                    checked={vis(item.key)}
                    onChange={() => toggleSection(item.key)}
                    style={{ width: 18, height: 18, accentColor: "#0f3460", cursor: "pointer" }}
                  />
                </label>
              ))}
              {Object.keys(overrides).length > 0 && (
                <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid #eee", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 12, color: "#888" }}>手動編集した数値: {Object.keys(overrides).length}件</span>
                  <button
                    onClick={() => {
                      if (!confirm("この店舗の手動編集した数値をすべて元に戻します。よろしいですか？")) return;
                      onSettingsChange?.({ overrides: {}, sectionVisibility, summaryOverride });
                    }}
                    style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #f0c0c8", background: "#fef1f3", color: "#c0392b", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                  >
                    すべて元の値に戻す
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
