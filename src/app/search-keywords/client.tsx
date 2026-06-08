"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import DateRangePicker, { useDateRange } from "@/components/date-range-picker";
import { useShop } from "@/components/shop-provider";

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
  shopId: string;
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

/** JST基準で前月を "YYYY/M" 形式で返す */
function getExpectedMonthJST(): string {
  const nowJST = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const d = new Date(nowJST.getUTCFullYear(), nowJST.getUTCMonth() - 1, 1);
  return `${d.getFullYear()}/${d.getMonth() + 1}`;
}

async function getAuthToken(): Promise<string> {
  const { supabase } = await import("@/lib/supabase");
  const session = (await supabase.auth.getSession()).data.session;
  return session?.access_token || "";
}

export default function SearchKeywordsClient() {
  const { favoriteShopIds, addToFavorites, removeFromFavorites } = useShop();
  const [shops, setShops] = useState<ShopKeywordStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "synced" | "stale" | "never" | "no_gbp" | "failed" | "no_data">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [toast, setToast] = useState<string | null>(null);

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ current: 0, total: 0, shopName: "" });
  const [syncResults, setSyncResults] = useState<SyncResult[]>([]);
  const [showResults, setShowResults] = useState(false);

  const expectedMonth = useMemo(() => getExpectedMonthJST(), []);
  const { startMonth: skStart, endMonth: skEnd, setRange: skSetRange, isMonthInRange: skIsMonthInRange } = useDateRange(6);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }, []);

  useEffect(() => { loadShops(); }, []);

  // お気に入り店舗があればページ表示時に自動選択
  const initRef = useRef(false);
  useEffect(() => {
    if (initRef.current || shops.length === 0 || favoriteShopIds.size === 0) return;
    initRef.current = true;
    const valid = new Set(Array.from(favoriteShopIds).filter(id => shops.some(s => s.id === id)));
    if (valid.size > 0) setSelected(valid);
  }, [shops, favoriteShopIds]);

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
      const failedIds = new Set(syncResults.filter((r) => !r.success && r.error !== "API returned 0 months of data").map((r) => r.shopId));
      list = list.filter((s) => failedIds.has(s.id));
    } else if (statusFilter === "no_data") {
      const noDataIds = new Set(syncResults.filter((r) => !r.success && r.error === "API returned 0 months of data").map((r) => r.shopId));
      list = list.filter((s) => noDataIds.has(s.id));
    } else if (statusFilter !== "all") {
      list = list.filter((s) => s.status === statusFilter);
    }
    // 期間フィルタ: latestMonthが範囲内 or 未同期の店舗を表示
    list = list.filter((s) => !s.latestMonth || s.status === "never" || s.status === "no_gbp" || skIsMonthInRange(s.latestMonth));
    return list;
  }, [shops, search, statusFilter, syncResults, skIsMonthInRange]);

  // Pagination
  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const paged = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  // Selection (id-based)
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

  // Sync one shop by ID (with AbortSignal + auth + 90s timeout)
  async function syncOne(shopId: string, shopName: string, parentSignal?: AbortSignal, apiPath = "/api/report/sync-search-keywords"): Promise<SyncResult> {
    // タイムアウトを最初に設定（getAuthToken含む全体をカバー）
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const onParentAbort = () => controller.abort();
    parentSignal?.addEventListener("abort", onParentAbort);
    try {
      const token = await getAuthToken();
      if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
      const res = await fetch(apiPath, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ shopId }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", onParentAbort);
      if (res.status === 401 || res.status === 403) {
        return { shopId, shopName, success: false, error: "認証切れ" };
      }
      const data = await res.json();
      if (data.success) {
        return { shopId, shopName, success: true, latestMonth: data.latestMonth, totalMonths: data.totalMonths };
      }
      return { shopId, shopName, success: false, error: data.error || "Unknown error" };
    } catch (e: any) {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", onParentAbort);
      if (e?.name === "AbortError") return { shopId, shopName, success: false, error: "タイムアウト" };
      return { shopId, shopName, success: false, error: e?.message || "Network error" };
    }
  }

  const cancelRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => { cancelRef.current = true; abortRef.current?.abort(); };
  }, []);

  // Build sync targets: deduplicate by gbp_location_name, return { shopId, shopName, gbpLoc }[]
  function buildSyncTargets(shopIds: string[]): { shopId: string; shopName: string; gbpLoc: string }[] {
    const shopMap = new Map(shops.map((s) => [s.id, s]));
    const seenLocations = new Set<string>();
    const targets: { shopId: string; shopName: string; gbpLoc: string }[] = [];

    for (const id of shopIds) {
      const shop = shopMap.get(id);
      if (!shop || !shop.gbp_location_name) continue;
      if (seenLocations.has(shop.gbp_location_name)) continue;
      seenLocations.add(shop.gbp_location_name);
      targets.push({ shopId: shop.id, shopName: shop.name, gbpLoc: shop.gbp_location_name });
    }
    return targets;
  }

  // Bulk sync (ID-based, deduped, with consecutive error handling)
  async function handleBulkSync(shopIds: string[], apiPath = "/api/report/sync-search-keywords") {
    const targets = buildSyncTargets(shopIds);
    if (targets.length === 0) { showToast("対象店舗がありません"); return; }

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
      const t = targets[i];
      setSyncProgress({ current: i + 1, total: targets.length, shopName: t.shopName });
      // 35秒の強制タイムアウト（syncOne内の30秒+猶予5秒）でハング防止
      const result = await Promise.race([
        syncOne(t.shopId, t.shopName, controller.signal, apiPath),
        new Promise<SyncResult>((resolve) =>
          setTimeout(() => resolve({ shopId: t.shopId, shopName: t.shopName, success: false, error: "タイムアウト（強制）" }), 35000)
        ),
      ]);
      results.push(result);
      setSyncResults([...results]);

      if (result.error === "認証切れ") {
        showToast("セッションが切れました。再ログインしてください。");
        break;
      }

      // "no data" は連続エラーにカウントしない（実害なし）
      if (result.success || result.error === "API returned 0 months of data") {
        consecutiveErrors = 0;
      } else {
        consecutiveErrors++;
      }
      if (consecutiveErrors >= 10) {
        showToast(`10件連続失敗のため中断しました (${i + 1}/${targets.length})`);
        break;
      }

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
    const failCount = results.filter((r) => !r.success && r.error !== "API returned 0 months of data").length;
    const noDataCount = results.filter((r) => r.error === "API returned 0 months of data").length;
    showToast(`完了: ${successCount}件成功 / ${failCount}件失敗 / ${noDataCount}件データなし`);

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
    const realFailed = syncResults.filter((r) => !r.success && r.error !== "API returned 0 months of data").length;
    const noData = syncResults.filter((r) => r.error === "API returned 0 months of data").length;
    return { total, synced, stale, never, noGbp, failed: realFailed, noData };
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
          <div className="mt-2">
            <DateRangePicker startMonth={skStart} endMonth={skEnd} onChange={skSetRange} compact />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {favoriteShopIds.size > 0 && (
            <button
              onClick={() => setSelected(new Set(Array.from(favoriteShopIds).filter(id => shops.some(s => s.id === id))))}
              className="px-3 py-2 rounded-lg text-sm font-semibold border text-emerald-700 bg-emerald-50 border-emerald-300 hover:bg-emerald-100 cursor-pointer transition"
            >
              いつもの店舗 ({favoriteShopIds.size})
            </button>
          )}
          {selected.size > 0 && (() => {
            const selectedArr = Array.from(selected);
            const notInFav = selectedArr.filter(id => !favoriteShopIds.has(id));
            const inFav = selectedArr.filter(id => favoriteShopIds.has(id));
            return (
              <>
                {notInFav.length > 0 && (
                  <button
                    onClick={() => addToFavorites(notInFav)}
                    className="px-3 py-2 rounded-lg text-xs font-semibold border text-blue-700 bg-blue-50 border-blue-300 hover:bg-blue-100 cursor-pointer transition"
                  >
                    + いつもの店舗に追加 ({notInFav.length})
                  </button>
                )}
                {inFav.length > 0 && inFav.length === selectedArr.length && (
                  <button
                    onClick={() => removeFromFavorites(inFav)}
                    className="px-3 py-2 rounded-lg text-xs font-semibold border text-red-600 bg-red-50 border-red-200 hover:bg-red-100 cursor-pointer transition"
                  >
                    - いつもの店舗から削除 ({inFav.length})
                  </button>
                )}
              </>
            );
          })()}
          <button
            onClick={() => {
              // 未同期 + 古い のみ対象（済は除外）、GBP未設定も除外
              const syncable = shops
                .filter((s) => s.gbp_location_name && (s.status === "never" || s.status === "stale"))
                .map((s) => s.id);
              handleBulkSync(syncable);
            }}
            disabled={syncing}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#003D6B] text-white hover:bg-[#002a4a] disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {syncing ? "同期中..." : `未同期を一括同期 (${shops.filter((s) => s.gbp_location_name && (s.status === "never" || s.status === "stale")).length})`}
          </button>
          <button
            onClick={() => handleBulkSync(Array.from(selected))}
            disabled={syncing || selected.size === 0}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {selected.size > 0 ? `${selected.size}件同期` : "選択同期"}
          </button>
          <button
            onClick={() => {
              const syncable = shops
                .filter((s) => s.gbp_location_name)
                .map((s) => s.id);
              handleBulkSync(syncable, "/api/report/sync-performance");
            }}
            disabled={syncing}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {syncing ? "同期中..." : `パフォーマンス一括同期 (${shops.filter((s) => s.gbp_location_name).length})`}
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
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          { label: "総店舗数", value: kpi.total, cls: "text-[#003D6B]" },
          { label: `最新月済 (${expectedMonth})`, value: kpi.synced, cls: "text-emerald-600" },
          { label: "古い (前月以前)", value: kpi.stale, cls: "text-amber-600" },
          { label: "未同期", value: kpi.never, cls: "text-slate-500" },
          { label: "GBP未設定", value: kpi.noGbp, cls: "text-red-600" },
          { label: "同期失敗", value: kpi.failed, cls: "text-red-600" },
          { label: "データなし", value: kpi.noData, cls: "text-orange-500" },
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
            { key: "no_data", label: "データなし" },
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
            {f.key === "no_data" && kpi.noData > 0 && (
              <span className="ml-1 bg-orange-400 text-white text-[10px] px-1 rounded-full">{kpi.noData}</span>
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
              同期結果: {syncResults.filter((r) => r.success).length}件成功 / {syncResults.filter((r) => !r.success && r.error !== "API returned 0 months of data").length}件失敗 / {syncResults.filter((r) => r.error === "API returned 0 months of data").length}件データなし
            </h3>
            <div className="flex items-center gap-2">
              {syncResults.some((r) => !r.success && r.error !== "API returned 0 months of data") && (
                <button
                  onClick={() => {
                    const failedIds = syncResults.filter((r) => !r.success && r.error !== "API returned 0 months of data" && r.error !== "認証切れ" && r.error !== "中断").map((r) => r.shopId);
                    handleBulkSync(failedIds);
                  }}
                  disabled={syncing}
                  className="px-3 py-1 rounded-lg text-xs font-semibold bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition"
                >
                  失敗分を再実行 ({syncResults.filter((r) => !r.success && r.error !== "API returned 0 months of data" && r.error !== "認証切れ" && r.error !== "中断").length})
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
                  <span className={`text-xs truncate max-w-[50%] ${r.error === "API returned 0 months of data" ? "text-orange-500" : "text-red-500"}`} title={r.error}>{r.error}</span>
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
                const failResult = syncResults.find((r) => r.shopId === shop.id && !r.success);
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
                        <p className={`text-[10px] mt-0.5 truncate max-w-[250px] ${failResult.error === "API returned 0 months of data" ? "text-orange-500" : "text-red-500"}`} title={failResult.error}>{failResult.error}</p>
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
                        onClick={() => handleBulkSync([shop.id])}
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
