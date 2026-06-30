"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type StoreSummary = {
  shopName: string;
  languages: string[];
  impressions: number;
  clicks: number;
  costMicros: number;
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

const LANG_COLORS: Record<string, string> = {
  Japanese: "bg-blue-100 text-blue-700",
  Chinese: "bg-red-100 text-red-700",
  English: "bg-emerald-100 text-emerald-700",
  Korean: "bg-purple-100 text-purple-700",
  Thai: "bg-amber-100 text-amber-700",
  Unknown: "bg-slate-100 text-slate-600",
};

export default function PmaxTopPage() {
  const [stores, setStores] = useState<StoreSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const router = useRouter();

  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth());

  const monthOptions = useMemo(() => {
    const opts = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      opts.push({ year: d.getFullYear(), month: d.getMonth(), label: `${d.getFullYear()}年${d.getMonth() + 1}月` });
    }
    return opts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError("");
      try {
        const headers = await getAuthHeaders();
        const { startDate, endDate } = getMonthRange(selectedYear, selectedMonth);
        const res = await fetch(`/api/pmax/store-summary?startDate=${startDate}&endDate=${endDate}`, { headers });
        const data = await res.json();
        if (data.error) {
          setError(data.error);
        } else {
          setStores(data.stores || []);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "取得に失敗しました");
      } finally {
        setLoading(false);
      }
    })();
  }, [selectedYear, selectedMonth, getAuthHeaders]);

  const filtered = stores.filter(
    (s) => s.shopName.toLowerCase().includes(search.toLowerCase())
  );

  const totalStores = stores.length;
  const totalImpressions = stores.reduce((s, v) => s + v.impressions, 0);
  const totalClicks = stores.reduce((s, v) => s + v.clicks, 0);
  const totalCost = stores.reduce((s, v) => s + v.costMicros, 0);

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
              <p className="text-xs text-slate-500">店舗別パフォーマンス一覧</p>
            </div>
          </div>
          <span className="px-3 py-1 bg-[#003D6B] text-white text-xs font-semibold rounded-full">P-MAX広告レポート</span>
        </div>
      </header>

      {/* KPIバー */}
      <div className="bg-white border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-6 py-4 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-slate-50 rounded-lg p-4">
            <p className="text-[11px] text-slate-500 font-medium">店舗数</p>
            <p className="text-2xl font-bold text-[#003D6B]">{totalStores}<span className="text-sm font-normal text-slate-400 ml-1">店舗</span></p>
          </div>
          <div className="bg-slate-50 rounded-lg p-4">
            <p className="text-[11px] text-slate-500 font-medium">総表示回数</p>
            <p className="text-2xl font-bold text-blue-600">{totalImpressions.toLocaleString()}<span className="text-sm font-normal text-slate-400 ml-1">回</span></p>
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
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <input
            type="text"
            placeholder="店舗名で検索..."
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
          <span className="text-xs text-slate-400">{filtered.length} / {stores.length} 店舗</span>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin w-8 h-8 border-2 border-[#003D6B] border-t-transparent rounded-full" />
            <span className="ml-3 text-sm text-slate-500">全アカウントから店舗データを取得中...</span>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && !error && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.length === 0 ? (
              <p className="text-sm text-slate-500 py-8 text-center col-span-full">
                {search ? "該当する店舗が見つかりません" : "店舗データがありません"}
              </p>
            ) : (
              filtered.map((store) => (
                <button
                  key={store.shopName}
                  onClick={() => router.push(`/pmax/store?name=${encodeURIComponent(store.shopName)}&year=${selectedYear}&month=${selectedMonth + 1}`)}
                  className="bg-white rounded-xl border border-slate-200 p-5 hover:border-[#003D6B]/30 hover:shadow-lg transition-all text-left group"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-800 group-hover:text-[#003D6B] truncate">{store.shopName}</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {store.languages.map((lang) => (
                          <span key={lang} className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${LANG_COLORS[lang] || LANG_COLORS.Unknown}`}>
                            {lang}
                          </span>
                        ))}
                      </div>
                    </div>
                    <svg className="w-5 h-5 text-slate-300 group-hover:text-[#003D6B] transition-colors flex-shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-blue-50 rounded-lg p-2 text-center">
                      <p className="text-[10px] text-blue-500">表示</p>
                      <p className="text-sm font-bold text-blue-700">{store.impressions.toLocaleString()}</p>
                    </div>
                    <div className="bg-emerald-50 rounded-lg p-2 text-center">
                      <p className="text-[10px] text-emerald-500">クリック</p>
                      <p className="text-sm font-bold text-emerald-700">{store.clicks.toLocaleString()}</p>
                    </div>
                    <div className="bg-orange-50 rounded-lg p-2 text-center">
                      <p className="text-[10px] text-orange-500">広告費</p>
                      <p className="text-sm font-bold text-orange-700">{formatCost(store.costMicros)}</p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </main>
    </div>
  );
}
