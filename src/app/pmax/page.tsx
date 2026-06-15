"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";

type Account = {
  customerId: string;
  name: string;
  status: string;
};

type AccountSummary = {
  impressions: number;
  clicks: number;
  costMicros: number;
  conversions: number;
  interactionRate: number;
};

function getMonthRange(year: number, month: number) {
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  return { startDate: fmt(start), endDate: fmt(end) };
}

function formatCost(micros: number) {
  return `¥${Math.round(micros / 1_000_000).toLocaleString()}`;
}

export default function PmaxTopPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [summaries, setSummaries] = useState<Record<string, AccountSummary>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const router = useRouter();

  // 月選択
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth());

  // 月の選択肢（過去12ヶ月）
  const monthOptions = useMemo(() => {
    const opts = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      opts.push({ year: d.getFullYear(), month: d.getMonth(), label: `${d.getFullYear()}年${d.getMonth() + 1}月` });
    }
    return opts;
  }, []);

  // アカウント一覧取得
  useEffect(() => {
    fetch("/api/pmax/accounts")
      .then((res) => res.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setAccounts(data.accounts || []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // 各アカウントのサマリー取得
  useEffect(() => {
    if (accounts.length === 0) return;
    const { startDate, endDate } = getMonthRange(selectedYear, selectedMonth);
    setSummaries({});

    const controller = new AbortController();
    // 並列で全アカウント取得（5並列制限）
    const fetchAll = async () => {
      const BATCH = 5;
      for (let i = 0; i < accounts.length; i += BATCH) {
        if (controller.signal.aborted) break;
        const batch = accounts.slice(i, i + BATCH);
        const results = await Promise.allSettled(
          batch.map(async (a) => {
            const res = await fetch(`/api/pmax/summary?customerId=${a.customerId}&startDate=${startDate}&endDate=${endDate}`, { signal: controller.signal });
            const data = await res.json();
            if (data.error) return { id: a.customerId, summary: null };
            return { id: a.customerId, summary: data as AccountSummary };
          })
        );
        if (controller.signal.aborted) break;
        setSummaries((prev) => {
          const next = { ...prev };
          for (const r of results) {
            if (r.status === "fulfilled" && r.value.summary) {
              next[r.value.id] = r.value.summary;
            }
          }
          return next;
        });
      }
    };
    fetchAll();
    return () => controller.abort();
  }, [accounts, selectedYear, selectedMonth]);

  const filtered = accounts.filter(
    (a) =>
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.customerId.includes(search)
  );

  // 集計KPI
  const totalAccounts = accounts.length;
  const totalImpressions = Object.values(summaries).reduce((s, v) => s + v.impressions, 0);
  const totalClicks = Object.values(summaries).reduce((s, v) => s + v.clicks, 0);
  const totalCost = Object.values(summaries).reduce((s, v) => s + v.costMicros, 0);
  const loadedCount = Object.keys(summaries).length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* ヘッダー */}
      <header className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-[#003D6B] flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-800">P-MAX 広告レポート</h1>
              <p className="text-xs text-slate-500">株式会社Chubby</p>
            </div>
          </div>
          <span className="px-3 py-1 bg-[#003D6B] text-white text-xs font-semibold rounded-full">P-MAX広告レポート</span>
        </div>
      </header>

      {/* KPIバー */}
      <div className="bg-white border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-6 py-4 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-slate-50 rounded-lg p-4">
            <p className="text-[11px] text-slate-500 font-medium">管理アカウント数</p>
            <p className="text-2xl font-bold text-[#003D6B]">{totalAccounts}<span className="text-sm font-normal text-slate-400 ml-1">件</span></p>
          </div>
          <div className="bg-slate-50 rounded-lg p-4">
            <p className="text-[11px] text-slate-500 font-medium">総表示回数</p>
            <p className="text-2xl font-bold text-blue-600">{totalImpressions.toLocaleString()}<span className="text-sm font-normal text-slate-400 ml-1">回</span></p>
            {loadedCount < totalAccounts && <p className="text-[10px] text-slate-400">{loadedCount}/{totalAccounts} 読込中...</p>}
          </div>
          <div className="bg-slate-50 rounded-lg p-4">
            <p className="text-[11px] text-slate-500 font-medium">総クリック数</p>
            <p className="text-2xl font-bold text-emerald-600">{totalClicks.toLocaleString()}<span className="text-sm font-normal text-slate-400 ml-1">回</span></p>
          </div>
          <div className="bg-slate-50 rounded-lg p-4">
            <p className="text-[11px] text-slate-500 font-medium">総広告費</p>
            <p className="text-2xl font-bold text-orange-600">{formatCost(totalCost)}</p>
          </div>
        </div>
      </div>

      {/* メインコンテンツ */}
      <main className="max-w-7xl mx-auto px-6 py-6">
        {/* フィルターバー */}
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <input
            type="text"
            placeholder="アカウント名・IDで検索..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-[200px] max-w-sm px-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#003D6B]/20 focus:border-[#003D6B]"
          />
          <select
            value={`${selectedYear}-${selectedMonth}`}
            onChange={(e) => {
              const [y, m] = e.target.value.split("-").map(Number);
              setSelectedYear(y);
              setSelectedMonth(m);
            }}
            className="px-4 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#003D6B]/20"
          >
            {monthOptions.map((o) => (
              <option key={`${o.year}-${o.month}`} value={`${o.year}-${o.month}`}>
                {o.label}
              </option>
            ))}
          </select>
          <span className="text-xs text-slate-400">{filtered.length} / {accounts.length} アカウント</span>
        </div>

        {/* ローディング */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin w-8 h-8 border-2 border-[#003D6B] border-t-transparent rounded-full" />
            <span className="ml-3 text-sm text-slate-500">アカウント一覧を取得中...</span>
          </div>
        )}

        {/* エラー */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* アカウントカード一覧 */}
        {!loading && !error && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.length === 0 ? (
              <p className="text-sm text-slate-500 py-8 text-center col-span-full">
                {search ? "該当するアカウントが見つかりません" : "アカウントがありません"}
              </p>
            ) : (
              filtered.map((account) => {
                const s = summaries[account.customerId];
                return (
                  <button
                    key={account.customerId}
                    onClick={() => router.push(`/pmax/${account.customerId}`)}
                    className="bg-white rounded-xl border border-slate-200 p-5 hover:border-[#003D6B]/30 hover:shadow-lg transition-all text-left group"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-800 group-hover:text-[#003D6B] truncate">{account.name}</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          ID: {account.customerId.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3")}
                        </p>
                      </div>
                      <svg className="w-5 h-5 text-slate-300 group-hover:text-[#003D6B] transition-colors flex-shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                    {s ? (
                      <div className="grid grid-cols-3 gap-2">
                        <div className="bg-blue-50 rounded-lg p-2 text-center">
                          <p className="text-[10px] text-blue-500">表示</p>
                          <p className="text-sm font-bold text-blue-700">{s.impressions.toLocaleString()}</p>
                        </div>
                        <div className="bg-emerald-50 rounded-lg p-2 text-center">
                          <p className="text-[10px] text-emerald-500">クリック</p>
                          <p className="text-sm font-bold text-emerald-700">{s.clicks.toLocaleString()}</p>
                        </div>
                        <div className="bg-orange-50 rounded-lg p-2 text-center">
                          <p className="text-[10px] text-orange-500">広告費</p>
                          <p className="text-sm font-bold text-orange-700">{formatCost(s.costMicros)}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-xs text-slate-400">
                        <div className="animate-spin w-3 h-3 border border-slate-300 border-t-transparent rounded-full" />
                        読込中...
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>
        )}
      </main>
    </div>
  );
}
