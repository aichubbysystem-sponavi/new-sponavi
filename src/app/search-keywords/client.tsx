"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";

interface ShopKeywordStatus {
  id: string;
  name: string;
  gbp_location_name: string | null;
  latestMonth: string | null;
  keywordCount: number;
  topKeywords: string[];
  lastSynced: string | null;
  status: "synced" | "stale" | "never" | "no_gbp";
}

interface SyncResult {
  shopName: string;
  success: boolean;
  latestMonth?: string;
  totalMonths?: number;
  error?: string;
}

const PER_PAGE = 50;

function statusLabel(s: ShopKeywordStatus["status"]) {
  switch (s) {
    case "synced": return { text: "済", cls: "bg-emerald-50 text-emerald-700" };
    case "stale": return { text: "古い", cls: "bg-amber-50 text-amber-700" };
    case "never": return { text: "未同期", cls: "bg-slate-100 text-slate-500" };
    case "no_gbp": return { text: "GBP未設定", cls: "bg-red-50 text-red-600" };
  }
}

function getExpectedMonth(): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}/${d.getMonth() + 1}`;
}

export default function SearchKeywordsClient() {
  const [shops, setShops] = useState<ShopKeywordStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "synced" | "stale" | "never" | "no_gbp" | "failed">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [toast, setToast] = useState<string | null>(null);

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ current: 0, total: 0, shopName: "" });
  const [syncResults, setSyncResults] = useState<SyncResult[]>([]);
  const [showResults, setShowResults] = useState(false);

  const expectedMonth = useMemo(() => getExpectedMonth(), []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }, []);

  // Load shop list + keyword status
  useEffect(() => {
    loadShops();
  }, []);

  async function loadShops() {
    setLoading(true);
    try {
      const res = await fetch("/api/search-keywords/status");
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setShops(data.shops || []);
    } catch (e: any) {
      showToast(`読み込みエラー: ${e?.message}`);
    } finally {
      setLoading(false);
    }
  }

  // Filter + search
  const filtered = useMemo(() => {
    let list = shops;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((s) => s.name.toLowerCase().includes(q));
    }
    if (statusFilter === "failed") {
      const failedNames = new Set(syncResults.filter((r) => !r.success).map((r) => r.shopName));
      list = list.filter((s) => failedNames.has(s.name));
    } else if (statusFilter !== "all") {
      list = list.filter((s) => s.status === statusFilter);
    }
    return list;
  }, [shops, search, statusFilter, syncResults]);

  // Pagination
  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const paged = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  // Selection (id-based to handle duplicate shop names)
  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((s) => s.id)));
    }
  }

  // Resolve selected IDs to shop names for sync API
  function selectedToNames(): string[] {
    const shopMap = new Map(shops.map((s) => [s.id, s.name]));
    return Array.from(selected).map((id) => shopMap.get(id) || "").filter(Boolean);
  }

  // Sync one shop (with AbortSignal)
  async function syncOne(shopName: string, signal?: AbortSignal): Promise<SyncResult> {
    try {
      const res = await fetch(`/api/report/sync-search-keywords?name=${encodeURIComponent(shopName)}&months=12`, { signal });
      if (res.redirected || res.status === 401 || res.status === 403) {
        return { shopName, success: false, error: "認証切れ" };
      }
      const data = await res.json();
      if (data.success) {
        return { shopName, success: true, latestMonth: data.latestMonth, totalMonths: data.totalMonths };
      }
      return { shopName, success: false, error: data.error || "Unknown error" };
    } catch (e: any) {
      if (e?.name === "AbortError") return { shopName, success: false, error: "中断" };
      return { shopName, success: false, error: e?.message || "Network error" };
    }
  }

  const cancelRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // Cleanup on unmount (page navigation)
  useEffect(() => {
    return () => {
      cancelRef.current = true;
      abortRef.current?.abort();
    };
  }, []);

  // Bulk sync (1 at a time with 500ms delay to respect rate limits)
  async function handleBulkSync(targets: string[]) {
    if (targets.length === 0) { showToast("対象店舗を選択してください"); return; }
    cancelRef.current = false;
    const controller = new AbortController();
    abortRef.current = controller;
    setSyncing(true);
    setSyncResults([]);
    setSyncProgress({ current: 0, total: targets.length, shopName: "" });

    const results: SyncResult[] = [];
    let consecutiveErrors = 0;

    for (let i = 0; i < targets.length; i++) {
      if (cancelRef.current || controller.signal.aborted) {
        showToast(`中断しました (${i}/${targets.length})`);
        break;
      }
      setSyncProgress({ current: i + 1, total: targets.length, shopName: targets[i] });
      const result = await syncOne(targets[i], controller.signal);
      results.push(result);
      setSyncResults([...results]);

      // Auth error detection: stop immediately
      if (result.error === "認証切れ") {
        showToast("セッションが切れました。再ログインしてください。");
        break;
      }

      // 10 consecutive errors → auto-stop
      consecutiveErrors = result.success ? 0 : consecutiveErrors + 1;
      if (consecutiveErrors >= 10) {
        showToast(`10件連続失敗のため中断しました (${i + 1}/${targets.length})`);
        break;
      }

      // Rate limit: wait 500ms between requests
      if (i < targets.length - 1) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    setSyncProgress({ current: results.length, total: targets.length, shopName: "" });
    setSyncResults(results);
    setSyncing(false);
    abortRef.current = null;
    setShowResults(true);

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;
    showToast(`完了: ${successCount}件成功 / ${failCount}件失敗`);

    // Reload data
    await loadShops();
    setSelected(new Set());
  }

  // KPI counts
  const kpi = useMemo(() => {
    const total = shops.length;
    const synced = shops.filter((s) => s.status === "synced").length;
    const stale = shops.filter((s) => s.status === "stale").length;
    const never = shops.filter((s) => s.status === "never").length;
    const noGbp = shops.filter((s) => s.status === "no_gbp").length;
    const failed = syncResults.filter((r) => !r.success).length;
    return { total, synced, stale, never, noGbp, failed };
  }, [shops, syncResults]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <span className="inline-block w-6 h-6 border-2 border-slate-300 border-t-[#003D6B] rounded-full animate-spin" />
        <span className="ml-3 text-slate-500 text-sm">店舗データを読み込み中...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">検索語句管理</h1>
          <p className="text-xs text-slate-400 mt-1">GBP Performance APIから検索語句を一括取得・管理 | 対象月: {expectedMonth}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const syncable = shops.filter((s) => s.gbp_location_name && s.status !== "no_gbp").map((s) => s.name);
              handleBulkSync(syncable);
            }}
            disabled={syncing}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#003D6B] text-white hover:bg-[#002a4a] disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {syncing ? "同期中..." : `全店舗同期 (${shops.filter((s) => s.gbp_location_name).length})`}
          </button>
          <button
            onClick={() => handleBulkSync(selectedToNames())}
            disabled={syncing || selected.size === 0}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {selected.size > 0 ? `${selected.size}件同期` : "選択同期"}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      {syncing && (
        <div className="bg-white rounded-xl p-4 shadow-sm border border-blue-100">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-slate-600">
              <span className="inline-block w-3 h-3 border-2 border-slate-300 border-t-[#003D6B] rounded-full animate-spin mr-2" />
              同期中: {syncProgress.shopName}
            </span>
            <div className="flex items-center gap-3">
              <span className="font-semibold text-[#003D6B]">{syncProgress.current}/{syncProgress.total}</span>
              <button
                onClick={() => { cancelRef.current = true; abortRef.current?.abort(); }}
                className="px-3 py-1 rounded text-xs font-semibold bg-red-50 text-red-600 hover:bg-red-100 transition"
              >
                中断
              </button>
            </div>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-2">
            <div
              className="bg-[#003D6B] h-2 rounded-full transition-all duration-300"
              style={{ width: `${syncProgress.total > 0 ? (syncProgress.current / syncProgress.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "総店舗数", value: kpi.total, cls: "text-[#003D6B]" },
          { label: `最新月済 (${expectedMonth})`, value: kpi.synced, cls: "text-emerald-600" },
          { label: "古い (前月以前)", value: kpi.stale, cls: "text-amber-600" },
          { label: "未同期", value: kpi.never, cls: "text-slate-500" },
          { label: "GBP未設定", value: kpi.noGbp, cls: "text-red-600" },
          { label: "同期失敗", value: kpi.failed, cls: "text-red-600" },
        ].map((k) => (
          <div key={k.label} className="bg-white rounded-xl p-3 shadow-sm border border-slate-100">
            <p className="text-[11px] font-medium text-slate-400 mb-1">{k.label}</p>
            <p className={`text-2xl font-bold ${k.cls}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="店舗名で検索..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm w-60 focus:outline-none focus:ring-2 focus:ring-[#003D6B]/30"
        />
        {(
          [
            { key: "all", label: "すべて" },
            { key: "synced", label: "済" },
            { key: "stale", label: "古い" },
            { key: "never", label: "未同期" },
            { key: "no_gbp", label: "GBP未設定" },
            { key: "failed", label: "失敗" },
          ] as { key: typeof statusFilter; label: string }[]
        ).map((f) => (
          <button
            key={f.key}
            onClick={() => { setStatusFilter(f.key); setPage(1); }}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition ${
              statusFilter === f.key
                ? "bg-[#003D6B] text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {f.label}
            {f.key === "failed" && kpi.failed > 0 && (
              <span className="ml-1 bg-red-500 text-white text-[10px] px-1 rounded-full">{kpi.failed}</span>
            )}
          </button>
        ))}
        <span className="text-xs text-slate-400 ml-auto">{filtered.length}件表示</span>
      </div>

      {/* Sync results panel */}
      {showResults && syncResults.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-700">
              同期結果: {syncResults.filter((r) => r.success).length}件成功 / {syncResults.filter((r) => !r.success).length}件失敗
            </h3>
            <div className="flex items-center gap-2">
              {syncResults.some((r) => !r.success) && (
                <button
                  onClick={() => {
                    const failedNames = syncResults.filter((r) => !r.success).map((r) => r.shopName);
                    handleBulkSync(failedNames);
                  }}
                  disabled={syncing}
                  className="px-3 py-1 rounded-lg text-xs font-semibold bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition"
                >
                  失敗分を再実行 ({syncResults.filter((r) => !r.success).length})
                </button>
              )}
              <button onClick={() => setShowResults(false)} className="text-slate-400 hover:text-slate-600 text-lg leading-none">&times;</button>
            </div>
          </div>
          {syncResults.some((r) => !r.success) && (
            <div className="max-h-48 overflow-y-auto divide-y divide-slate-50">
              {syncResults.filter((r) => !r.success).map((r, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span className="text-slate-700">{r.shopName}</span>
                  <span className="text-red-500 text-xs truncate max-w-[50%]" title={r.error}>{r.error}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="pl-4 pr-2 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && selected.size === filtered.length}
                    onChange={toggleSelectAll}
                    className="w-3.5 h-3.5 rounded border-slate-300"
                  />
                </th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500">店舗名</th>
                <th className="px-3 py-3 text-center text-xs font-semibold text-slate-500">ステータス</th>
                <th className="px-3 py-3 text-center text-xs font-semibold text-slate-500">最新月</th>
                <th className="px-3 py-3 text-center text-xs font-semibold text-slate-500">KW数</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500">TOP3キーワード</th>
                <th className="px-3 py-3 text-center text-xs font-semibold text-slate-500">最終同期</th>
                <th className="px-3 py-3 text-center text-xs font-semibold text-slate-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {paged.map((shop) => {
                const st = statusLabel(shop.status);
                const isSelected = selected.has(shop.id);
                const failResult = syncResults.find((r) => r.shopName === shop.name && !r.success);
                return (
                  <tr key={shop.id} className={`hover:bg-slate-50/50 transition ${failResult ? "bg-red-50/30" : ""}`}>
                    <td className="pl-4 pr-2 py-2.5">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(shop.id)}
                        className="w-3.5 h-3.5 rounded border-slate-300"
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="font-medium text-slate-800">{shop.name}</span>
                      {failResult && (
                        <p className="text-[10px] text-red-500 mt-0.5 truncate max-w-[250px]" title={failResult.error}>{failResult.error}</p>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${st.cls}`}>{st.text}</span>
                    </td>
                    <td className="px-3 py-2.5 text-center text-xs text-slate-600">
                      {shop.latestMonth || "-"}
                    </td>
                    <td className="px-3 py-2.5 text-center text-xs font-semibold text-slate-700">
                      {shop.keywordCount > 0 ? shop.keywordCount : "-"}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-500 max-w-[250px] truncate">
                      {shop.topKeywords.length > 0 ? shop.topKeywords.join(", ") : "-"}
                    </td>
                    <td className="px-3 py-2.5 text-center text-[11px] text-slate-400">
                      {shop.lastSynced ? new Date(shop.lastSynced).toLocaleDateString("ja-JP", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "-"}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <button
                        onClick={() => handleBulkSync([shop.name])}
                        disabled={syncing || shop.status === "no_gbp"}
                        className="px-2.5 py-1 rounded text-[11px] font-semibold bg-blue-50 text-blue-600 hover:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
                      >
                        同期
                      </button>
                    </td>
                  </tr>
                );
              })}
              {paged.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-slate-400 text-sm">該当する店舗がありません</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-1 py-3 border-t border-slate-100">
            <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className="px-3 py-1 rounded text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-40">
              前へ
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
              .map((p, i, arr) => (
                <span key={p}>
                  {i > 0 && arr[i - 1] !== p - 1 && <span className="px-1 text-slate-300">...</span>}
                  <button
                    onClick={() => setPage(p)}
                    className={`w-7 h-7 rounded text-xs font-semibold ${
                      p === page ? "bg-[#003D6B] text-white" : "text-slate-500 hover:bg-slate-100"
                    }`}
                  >
                    {p}
                  </button>
                </span>
              ))}
            <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages} className="px-3 py-1 rounded text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-40">
              次へ
            </button>
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#003D6B] text-white px-6 py-3 rounded-xl shadow-lg text-sm animate-in slide-in-from-bottom-4">
          {toast}
        </div>
      )}
    </div>
  );
}
