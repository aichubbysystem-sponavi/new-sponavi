"use client";

import { useEffect, useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
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
} from "chart.js";
import { Bar, Line } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend);

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

// ==============================
// ユーティリティ
// ==============================
const formatCost = (micros: number) =>
  `¥${Math.round(micros / 1_000_000).toLocaleString()}`;

const formatCpc = (micros: number) =>
  `¥${Math.round(micros / 1_000_000).toLocaleString()}`;

const formatCtr = (ctr: number) => `${(ctr * 100).toFixed(2)}%`;

const formatMonth = (m: string) => {
  if (!m) return "";
  const d = new Date(m);
  return `${d.getFullYear()}/${d.getMonth() + 1}`;
};

const formatDate = (d: string) => {
  if (!d) return "";
  return d.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$2/$3");
};

// 日付ヘルパー
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

// チャート色
const COLORS = [
  "#003D6B", "#E67E22", "#27AE60", "#8E44AD", "#E74C3C",
  "#3498DB", "#F39C12", "#1ABC9C", "#9B59B6", "#2ECC71",
];

// ==============================
// メインコンポーネント
// ==============================
export default function PmaxReportPage() {
  const { customerId } = useParams<{ customerId: string }>();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState(0);
  const [accountName, setAccountName] = useState("");
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [monthlyData, setMonthlyData] = useState<MonthlyData | null>(null);
  const [dailyData, setDailyData] = useState<DailyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // データ取得
  useEffect(() => {
    if (!customerId) return;

    const { startDate: mStart, endDate: mEnd } = getDateRange(12);
    const { startDate: dStart, endDate: dEnd } = getCurrentMonthRange();

    setLoading(true);
    setError("");

    Promise.all([
      fetch(`/api/pmax/accounts`).then((r) => r.json()),
      fetch(`/api/pmax/summary?customerId=${customerId}&startDate=${mStart}&endDate=${mEnd}`).then((r) => r.json()),
      fetch(`/api/pmax/monthly?customerId=${customerId}&startDate=${mStart}&endDate=${mEnd}`).then((r) => r.json()),
      fetch(`/api/pmax/daily?customerId=${customerId}&startDate=${dStart}&endDate=${dEnd}`).then((r) => r.json()),
    ])
      .then(([accountsRes, summaryRes, monthlyRes, dailyRes]) => {
        const acct = (accountsRes.accounts || []).find(
          (a: any) => a.customerId === customerId
        );
        setAccountName(acct?.name || customerId);

        if (summaryRes.error) throw new Error(summaryRes.error);
        setSummary(summaryRes);
        setMonthlyData(monthlyRes);
        setDailyData(dailyRes);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [customerId]);

  const tabs = ["サマリー", "グラフ", "月次推移", "日次データ"];

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-10 h-10 border-3 border-[#003D6B] border-t-transparent rounded-full mx-auto" />
          <p className="mt-4 text-sm text-slate-500">レポートデータを取得中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 max-w-lg w-full">
          <h2 className="text-lg font-bold text-red-700 mb-2">エラー</h2>
          <p className="text-sm text-red-600">{error}</p>
          <button onClick={() => router.push("/pmax")} className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700">
            戻る
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* ヘッダー */}
      <header className="bg-white border-b border-slate-200 shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => router.push("/pmax")} className="text-slate-400 hover:text-slate-700">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="text-lg font-bold text-slate-800">{accountName}</h1>
              <p className="text-xs text-slate-400">
                ID: {customerId.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3")}
              </p>
            </div>
          </div>
        </div>
        {/* タブ */}
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex gap-1 border-t border-slate-100 pt-1">
            {tabs.map((tab, i) => (
              <button
                key={tab}
                onClick={() => setActiveTab(i)}
                className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors ${
                  activeTab === i
                    ? "bg-[#003D6B] text-white"
                    : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* コンテンツ */}
      <main className="max-w-7xl mx-auto px-6 py-6">
        {activeTab === 0 && summary && <SummaryTab data={summary} />}
        {activeTab === 1 && monthlyData && <ChartTab data={monthlyData} />}
        {activeTab === 2 && monthlyData && <MonthlyTab data={monthlyData} />}
        {activeTab === 3 && dailyData && <DailyTab data={dailyData} />}
      </main>
    </div>
  );
}

// ==============================
// ページ1: サマリー
// ==============================
function SummaryTab({ data }: { data: SummaryData }) {
  const cards = [
    { label: "総表示回数", value: data.impressions.toLocaleString(), icon: "👁" },
    { label: "総クリック", value: data.clicks.toLocaleString(), icon: "👆" },
    { label: "総広告費", value: formatCost(data.costMicros), icon: "💰" },
    { label: "クリック率", value: formatCtr(data.interactionRate), icon: "📊" },
    { label: "コンバージョン", value: Math.round(data.conversions).toLocaleString(), icon: "🎯" },
    {
      label: "平均CPC",
      value: data.clicks > 0 ? formatCpc(data.costMicros / data.clicks) : "¥0",
      icon: "💵",
    },
  ];

  return (
    <div>
      <h2 className="text-base font-semibold text-slate-700 mb-4">直近12ヶ月 サマリー</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {cards.map((card) => (
          <div key={card.label} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <p className="text-xs text-slate-500 mb-1">{card.label}</p>
            <p className="text-2xl font-bold text-slate-800">{card.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ==============================
// ページ2: グラフ
// ==============================
function ChartTab({ data }: { data: MonthlyData }) {
  const campaignNames = Object.keys(data.campaigns);

  // 全月を集約
  const allMonths = useMemo(() => {
    const set = new Set<string>();
    for (const rows of Object.values(data.campaigns)) {
      for (const r of rows) if (r.month) set.add(r.month);
    }
    return Array.from(set).sort();
  }, [data]);

  // 表示回数の棒グラフ
  const impressionsChart = useMemo(() => ({
    labels: allMonths.map(formatMonth),
    datasets: campaignNames.map((name, i) => {
      const rows = data.campaigns[name];
      const monthMap = new Map(rows.map((r) => [r.month, r.impressions]));
      return {
        label: name,
        data: allMonths.map((m) => monthMap.get(m) || 0),
        backgroundColor: COLORS[i % COLORS.length],
      };
    }),
  }), [data, allMonths, campaignNames]);

  // 広告費の棒グラフ
  const costChart = useMemo(() => ({
    labels: allMonths.map(formatMonth),
    datasets: campaignNames.map((name, i) => {
      const rows = data.campaigns[name];
      const monthMap = new Map(rows.map((r) => [r.month, Math.round(r.costMicros / 1_000_000)]));
      return {
        label: name,
        data: allMonths.map((m) => monthMap.get(m) || 0),
        backgroundColor: COLORS[i % COLORS.length],
      };
    }),
  }), [data, allMonths, campaignNames]);

  const barOptions = {
    responsive: true,
    plugins: { legend: { position: "top" as const } },
    scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } },
  };

  return (
    <div className="space-y-8">
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">月別 表示回数（キャンペーン別）</h3>
        <Bar data={impressionsChart} options={barOptions} />
      </div>
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">月別 広告費（キャンペーン別）</h3>
        <Bar data={costChart} options={{ ...barOptions, scales: { ...barOptions.scales, y: { ...barOptions.scales.y, ticks: { callback: (v: any) => `¥${v.toLocaleString()}` } } } }} />
      </div>
    </div>
  );
}

// ==============================
// ページ3: 月次推移（言語別テーブル）
// ==============================
function MonthlyTab({ data }: { data: MonthlyData }) {
  const campaignNames = Object.keys(data.campaigns);
  const [selected, setSelected] = useState(campaignNames[0] || "");

  const rows = data.campaigns[selected] || [];

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h2 className="text-base font-semibold text-slate-700">月次推移</h2>
        <div className="flex gap-2 flex-wrap">
          {campaignNames.map((name) => (
            <button
              key={name}
              onClick={() => setSelected(name)}
              className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
                selected === name
                  ? "bg-[#003D6B] text-white border-[#003D6B]"
                  : "bg-white text-slate-600 border-slate-200 hover:border-[#003D6B]/30"
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-4 py-3 text-left font-medium text-slate-600">月</th>
              <th className="px-4 py-3 text-right font-medium text-slate-600">表示回数</th>
              <th className="px-4 py-3 text-right font-medium text-slate-600">クリック数</th>
              <th className="px-4 py-3 text-right font-medium text-slate-600">クリック率</th>
              <th className="px-4 py-3 text-right font-medium text-slate-600">平均CPC</th>
              <th className="px-4 py-3 text-right font-medium text-slate-600">広告費</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-700">{formatMonth(row.month || "")}</td>
                <td className="px-4 py-3 text-right text-slate-800">{row.impressions.toLocaleString()}</td>
                <td className="px-4 py-3 text-right text-slate-800">{row.clicks.toLocaleString()}</td>
                <td className="px-4 py-3 text-right text-slate-800">{formatCtr(row.ctr)}</td>
                <td className="px-4 py-3 text-right text-slate-800">{formatCpc(row.averageCpc)}</td>
                <td className="px-4 py-3 text-right font-medium text-slate-800">{formatCost(row.costMicros)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">データがありません</td></tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="bg-slate-50 font-semibold">
                <td className="px-4 py-3 text-slate-700">合計</td>
                <td className="px-4 py-3 text-right text-slate-800">{rows.reduce((s, r) => s + r.impressions, 0).toLocaleString()}</td>
                <td className="px-4 py-3 text-right text-slate-800">{rows.reduce((s, r) => s + r.clicks, 0).toLocaleString()}</td>
                <td className="px-4 py-3 text-right text-slate-800">
                  {formatCtr(rows.reduce((s, r) => s + r.clicks, 0) / Math.max(rows.reduce((s, r) => s + r.impressions, 0), 1))}
                </td>
                <td className="px-4 py-3 text-right text-slate-800">
                  {formatCpc(rows.reduce((s, r) => s + r.costMicros, 0) / Math.max(rows.reduce((s, r) => s + r.clicks, 0), 1))}
                </td>
                <td className="px-4 py-3 text-right text-slate-800">{formatCost(rows.reduce((s, r) => s + r.costMicros, 0))}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// ==============================
// ページ4: 日次データ（言語別テーブル）
// ==============================
function DailyTab({ data }: { data: DailyData }) {
  const campaignNames = Object.keys(data.campaigns);
  const [selected, setSelected] = useState(campaignNames[0] || "");

  const rows = data.campaigns[selected] || [];

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h2 className="text-base font-semibold text-slate-700">日次データ（今月）</h2>
        <div className="flex gap-2 flex-wrap">
          {campaignNames.map((name) => (
            <button
              key={name}
              onClick={() => setSelected(name)}
              className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
                selected === name
                  ? "bg-[#003D6B] text-white border-[#003D6B]"
                  : "bg-white text-slate-600 border-slate-200 hover:border-[#003D6B]/30"
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-4 py-3 text-left font-medium text-slate-600">日付</th>
              <th className="px-4 py-3 text-right font-medium text-slate-600">表示回数</th>
              <th className="px-4 py-3 text-right font-medium text-slate-600">クリック数</th>
              <th className="px-4 py-3 text-right font-medium text-slate-600">クリック率</th>
              <th className="px-4 py-3 text-right font-medium text-slate-600">平均CPC</th>
              <th className="px-4 py-3 text-right font-medium text-slate-600">広告費</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-700">{formatDate(row.date || "")}</td>
                <td className="px-4 py-3 text-right text-slate-800">{row.impressions.toLocaleString()}</td>
                <td className="px-4 py-3 text-right text-slate-800">{row.clicks.toLocaleString()}</td>
                <td className="px-4 py-3 text-right text-slate-800">{formatCtr(row.ctr)}</td>
                <td className="px-4 py-3 text-right text-slate-800">{formatCpc(row.averageCpc)}</td>
                <td className="px-4 py-3 text-right font-medium text-slate-800">{formatCost(row.costMicros)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">データがありません</td></tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="bg-slate-50 font-semibold">
                <td className="px-4 py-3 text-slate-700">合計</td>
                <td className="px-4 py-3 text-right text-slate-800">{rows.reduce((s, r) => s + r.impressions, 0).toLocaleString()}</td>
                <td className="px-4 py-3 text-right text-slate-800">{rows.reduce((s, r) => s + r.clicks, 0).toLocaleString()}</td>
                <td className="px-4 py-3 text-right text-slate-800">
                  {formatCtr(rows.reduce((s, r) => s + r.clicks, 0) / Math.max(rows.reduce((s, r) => s + r.impressions, 0), 1))}
                </td>
                <td className="px-4 py-3 text-right text-slate-800">
                  {formatCpc(rows.reduce((s, r) => s + r.costMicros, 0) / Math.max(rows.reduce((s, r) => s + r.clicks, 0), 1))}
                </td>
                <td className="px-4 py-3 text-right text-slate-800">{formatCost(rows.reduce((s, r) => s + r.costMicros, 0))}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
