"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";

type StoreSummary = {
  shopName: string;
  languages: string[];
  impressions: number;
  clicks: number;
  costMicros: number;
};

function formatCost(micros: number) {
  return `¥${Math.round(micros / 1_000_000).toLocaleString("ja-JP")}`;
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
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const router = useRouter();

  // 選択状態
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState("");
  const [fetchingStores, setFetchingStores] = useState(false);

  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1); // 1-indexed

  const monthOptions = useMemo(() => {
    const opts = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      opts.push({
        year: d.getFullYear(),
        month: d.getMonth() + 1,
        label: `${d.getFullYear()}年${d.getMonth() + 1}月`,
      });
    }
    return opts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const monthKey = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}`;

  const fetchStores = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get(`/api/pmax/store-summary?month=${monthKey}`);
      const data = res.data;
      if (data.error) {
        setError(data.error);
      } else {
        setStores(data.stores || []);
        setLastSyncedAt(data.lastSyncedAt || null);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [monthKey]);

  useEffect(() => {
    fetchStores();
  }, [fetchStores]);

  // 全選択/全解除
  const toggleSelectAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((s) => s.shopName)));
    }
  };

  const toggleSelect = (shopName: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(shopName)) next.delete(shopName);
      else next.add(shopName);
      return next;
    });
  };

  // 全店舗取得（Google Ads APIから店舗一覧を取得してカード表示）
  const handleFetchStores = async () => {
    setFetchingStores(true);
    setSyncProgress("Google Ads APIから全店舗を取得中...");
    try {
      const res = await api.get(`/api/pmax/list-stores?month=${monthKey}`, { timeout: 120000 });
      const apiStores: StoreSummary[] = res.data.stores || [];
      // DB同期済みの店舗とマージ（同期済みはDBの値、未同期はAPI値）
      const dbNames = new Set(stores.map((s) => s.shopName));
      const merged = [...stores];
      for (const s of apiStores) {
        if (!dbNames.has(s.shopName)) {
          merged.push(s);
        }
      }
      merged.sort((a, b) => b.impressions - a.impressions);
      setStores(merged);
      setSyncProgress(`${apiStores.length}店舗を取得しました。同期する店舗を選択して「反映」してください。`);
    } catch (err: unknown) {
      setSyncProgress(`取得エラー: ${err instanceof Error ? err.message : "不明なエラー"}`);
    } finally {
      setFetchingStores(false);
      setTimeout(() => setSyncProgress(""), 8000);
    }
  };

  // 反映ボタン
  const handleSync = async () => {
    if (selected.size === 0) return;
    setSyncing(true);
    const shopNames = Array.from(selected);
    const BATCH_SIZE = 50;
    let totalSynced = 0, totalMonthly = 0, totalDaily = 0, totalGbp = 0;
    let lastRes: { dbVerifyCount?: number; insertErrors?: string[] } | null = null;
    try {
      for (let i = 0; i < shopNames.length; i += BATCH_SIZE) {
        const batch = shopNames.slice(i, i + BATCH_SIZE);
        setSyncProgress(`同期中... ${i + 1}〜${Math.min(i + BATCH_SIZE, shopNames.length)} / ${shopNames.length}店舗`);
        const res = await api.post("/api/pmax/sync", { shopNames: batch, month: monthKey }, { timeout: 290000 });
        lastRes = res.data;
        totalSynced += res.data.synced || 0;
        totalMonthly += res.data.monthlyRows || 0;
        totalDaily += res.data.dailyRows || 0;
        totalGbp += res.data.gbpSynced || 0;
      }
      setSyncProgress(`${totalSynced}店舗の同期完了（月次${totalMonthly}件・日次${totalDaily}件・GBP${totalGbp}件）DB検証: ${lastRes?.dbVerifyCount ?? "?"}件${lastRes?.insertErrors ? " エラー: " + lastRes.insertErrors.join(", ") : ""}`);
      setSelected(new Set());
      await fetchStores();
    } catch (err: unknown) {
      setSyncProgress(`同期エラー（${totalSynced}店舗完了済み）: ${err instanceof Error ? err.message : "不明なエラー"}`);
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncProgress(""), 8000);
    }
  };

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
            <p className="text-2xl font-bold text-blue-600">{totalImpressions.toLocaleString("ja-JP")}<span className="text-sm font-normal text-slate-400 ml-1">回</span></p>
          </div>
          <div className="bg-slate-50 rounded-lg p-4">
            <p className="text-[11px] text-slate-500 font-medium">総クリック数</p>
            <p className="text-2xl font-bold text-emerald-600">{totalClicks.toLocaleString("ja-JP")}<span className="text-sm font-normal text-slate-400 ml-1">回</span></p>
          </div>
          <div className="bg-slate-50 rounded-lg p-4">
            <p className="text-[11px] text-slate-500 font-medium">総広告費</p>
            <p className="text-2xl font-bold text-orange-600">{formatCost(totalCost)}</p>
          </div>
        </div>
      </div>

      {/* メインコンテンツ */}
      <main className="max-w-7xl mx-auto px-6 py-6">
        {/* 操作バー */}
        <div className="flex flex-wrap items-center gap-3 mb-3">
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
              setSelected(new Set());
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

        {/* 同期操作バー */}
        <div className="flex flex-wrap items-center gap-3 mb-5 bg-white border border-slate-200 rounded-lg px-4 py-3">
          <button
            onClick={handleFetchStores}
            disabled={fetchingStores || syncing}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
              fetchingStores || syncing
                ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                : "bg-emerald-600 text-white hover:bg-emerald-700"
            }`}
          >
            {fetchingStores ? "取得中..." : "全店舗取得"}
          </button>
          <button
            onClick={toggleSelectAll}
            disabled={stores.length === 0}
            className="text-xs px-3 py-1.5 border border-slate-300 rounded-md hover:bg-slate-50 transition-colors"
          >
            {selected.size === filtered.length && filtered.length > 0 ? "全解除" : "全選択"}
          </button>
          <span className="text-xs text-slate-500">{selected.size}店舗選択中</span>
          <button
            onClick={handleSync}
            disabled={syncing || selected.size === 0}
            className={`ml-auto px-5 py-2 rounded-lg text-sm font-bold transition-all ${
              syncing || selected.size === 0
                ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                : "bg-[#003D6B] text-white hover:bg-[#002a4d] shadow-sm"
            }`}
          >
            {syncing ? "同期中..." : `反映（${selected.size}店舗）`}
          </button>
          {lastSyncedAt && (
            <span className="text-[10px] text-slate-400">
              最終同期: {new Date(lastSyncedAt).toLocaleString("ja-JP")}
            </span>
          )}
        </div>

        {/* 同期プログレス */}
        {syncProgress && (
          <div className={`mb-4 px-4 py-3 rounded-lg text-sm ${syncing ? "bg-blue-50 text-blue-700" : syncProgress.includes("エラー") ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
            {syncProgress}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin w-8 h-8 border-2 border-[#003D6B] border-t-transparent rounded-full" />
            <span className="ml-3 text-sm text-slate-500">データを読み込み中...</span>
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
                {search ? "該当する店舗が見つかりません" : "この月のデータはまだ同期されていません。店舗を選択して「反映」してください。"}
              </p>
            ) : (
              filtered.map((store) => (
                <div
                  key={store.shopName}
                  className={`bg-white rounded-xl border p-5 transition-all ${
                    selected.has(store.shopName) ? "border-[#003D6B] ring-2 ring-[#003D6B]/20" : "border-slate-200 hover:border-[#003D6B]/30 hover:shadow-lg"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {/* チェックボックス */}
                    <input
                      type="checkbox"
                      checked={selected.has(store.shopName)}
                      onChange={() => toggleSelect(store.shopName)}
                      className="mt-1 w-4 h-4 rounded border-slate-300 text-[#003D6B] focus:ring-[#003D6B]/20 cursor-pointer flex-shrink-0"
                    />
                    {/* 店舗カード */}
                    <button
                      onClick={() => router.push(`/pmax/store?name=${encodeURIComponent(store.shopName)}&year=${selectedYear}&month=${selectedMonth}`)}
                      className="flex-1 text-left group"
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
                          <p className="text-sm font-bold text-blue-700">{store.impressions.toLocaleString("ja-JP")}</p>
                        </div>
                        <div className="bg-emerald-50 rounded-lg p-2 text-center">
                          <p className="text-[10px] text-emerald-500">クリック</p>
                          <p className="text-sm font-bold text-emerald-700">{store.clicks.toLocaleString("ja-JP")}</p>
                        </div>
                        <div className="bg-orange-50 rounded-lg p-2 text-center">
                          <p className="text-[10px] text-orange-500">広告費</p>
                          <p className="text-sm font-bold text-orange-700">{formatCost(store.costMicros)}</p>
                        </div>
                      </div>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </main>
    </div>
  );
}
