"use client";

import Link from "next/link";
import { useState, useMemo, useTransition, useEffect, useCallback } from "react";
import type { ShopListItem } from "@/lib/report-data";
import { syncAllData, syncShopData } from "./actions";

type SortKey = "name" | "rating" | "totalReviews" | "period";
type SortDir = "asc" | "desc";
type ViewMode = "card" | "list";

const PER_PAGE_CARD = 30;
const PER_PAGE_LIST = 50;

const RATING_FILTERS = [
  { label: "すべて", min: 0, max: 6 },
  { label: "★4.5+", min: 4.5, max: 6 },
  { label: "★4.0+", min: 4.0, max: 6 },
  { label: "★3.5+", min: 3.5, max: 6 },
  { label: "★3.5未満", min: 0, max: 3.5 },
];

// ★ビジュアル表示
function Stars({ rating }: { rating: number }) {
  const full = Math.floor(rating);
  const half = rating - full >= 0.3;
  return (
    <span className="text-amber-400 text-xs tracking-tight">
      {"★".repeat(full)}{half ? "★" : ""}{"☆".repeat(5 - full - (half ? 1 : 0))}
    </span>
  );
}

// 前月比バッジ
function MomBadge({ cur, prev, label }: { cur: number; prev: number; label: string }) {
  if (prev === 0 && cur === 0) return null;
  const pct = prev > 0 ? ((cur - prev) / prev) * 100 : 100;
  const isUp = pct >= 0;
  const isAlert = pct <= -30;
  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
        isAlert ? "bg-red-100 text-red-700" : isUp ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"
      }`}
      title={`${label}: ${prev.toLocaleString()}→${cur.toLocaleString()}`}
    >
      {isUp ? "↑" : "↓"}{Math.abs(pct).toFixed(0)}%
    </span>
  );
}

export default function ReportListClient({
  shops,
  source,
}: {
  shops: ShopListItem[];
  source: "cache" | "spreadsheet" | "mock";
}) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const [ratingFilter, setRatingFilter] = useState(0);
  const [areaFilter, setAreaFilter] = useState("すべて");
  const [viewMode, setViewMode] = useState<ViewMode>("card");
  const [syncing, startSync] = useTransition();
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [showOnlyFavorites, setShowOnlyFavorites] = useState(false);
  const [showOnlyAlert, setShowOnlyAlert] = useState(false);

  // お気に入りをlocalStorageから読み込み
  useEffect(() => {
    const saved = localStorage.getItem("report-favorites");
    if (saved) setFavorites(new Set(JSON.parse(saved)));
  }, []);

  const saveFavorites = useCallback((next: Set<string>) => {
    setFavorites(next);
    localStorage.setItem("report-favorites", JSON.stringify(Array.from(next)));
  }, []);

  function toggleFavorite(id: string) {
    const next = new Set(favorites);
    if (next.has(id)) next.delete(id); else next.add(id);
    saveFavorites(next);
  }

  // エリア一覧を抽出
  const areas = useMemo(() => {
    const set = new Set<string>();
    shops.forEach((s) => { if (s.area) set.add(s.area); });
    return ["すべて", ...Array.from(set).sort((a, b) => a.localeCompare(b, "ja"))];
  }, [shops]);

  // アラート店舗判定（口コミ前月比-30%以上）
  function isAlertShop(shop: ShopListItem): boolean {
    if (!shop.prevTotalReviews || shop.prevTotalReviews === 0) return false;
    const delta = shop.totalReviews - shop.prevTotalReviews;
    return delta < 0; // 口コミ減少は異常
  }

  const perPage = viewMode === "card" ? PER_PAGE_CARD : PER_PAGE_LIST;

  // フィルタ＆ソート
  const filtered = useMemo(() => {
    let result = shops;

    // お気に入りフィルタ
    if (showOnlyFavorites) result = result.filter((s) => favorites.has(s.id));

    // アラートフィルタ
    if (showOnlyAlert) result = result.filter(isAlertShop);

    // テキスト検索
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (s) => s.name.toLowerCase().includes(q) || s.address.toLowerCase().includes(q)
      );
    }

    // 評価フィルタ
    const rf = RATING_FILTERS[ratingFilter];
    if (rf.min > 0 || rf.max < 6) {
      result = result.filter((s) => s.rating >= rf.min && s.rating < rf.max);
    }

    // エリアフィルタ
    if (areaFilter !== "すべて") {
      result = result.filter((s) => s.area === areaFilter);
    }

    // ソート（お気に入りを上部固定）
    result = [...result].sort((a, b) => {
      const aFav = favorites.has(a.id) ? 0 : 1;
      const bFav = favorites.has(b.id) ? 0 : 1;
      if (aFav !== bFav) return aFav - bFav;

      let cmp = 0;
      switch (sortKey) {
        case "name": cmp = a.name.localeCompare(b.name, "ja"); break;
        case "rating": cmp = a.rating - b.rating; break;
        case "totalReviews": cmp = a.totalReviews - b.totalReviews; break;
        case "period": cmp = a.period.localeCompare(b.period, "ja"); break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return result;
  }, [shops, search, sortKey, sortDir, ratingFilter, areaFilter, favorites, showOnlyFavorites, showOnlyAlert]);

  const totalPages = Math.ceil(filtered.length / perPage);
  const paged = filtered.slice((page - 1) * perPage, page * perPage);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "name" ? "asc" : "desc"); }
    setPage(1);
  }

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 4000); }

  function handleSyncAll() {
    startSync(async () => {
      const result = await syncAllData();
      setLastSync(result.timestamp);
      showToast(`全${shops.length}店舗のデータを反映しました`);
      setTimeout(() => window.location.reload(), 1500);
    });
  }

  function handleSyncSelected() {
    if (selected.size === 0) { showToast("店舗を選択してください"); return; }
    startSync(async () => {
      const ids = Array.from(selected);
      const result = await syncShopData(ids);
      setLastSync(result.timestamp);
      setSelected(new Set());
      showToast(`${result.count}店舗のデータを反映しました`);
      setTimeout(() => window.location.reload(), 1500);
    });
  }

  function toggleSelect(id: string) {
    setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  function toggleSelectAll() {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((s) => s.id)));
  }

  // 統計
  const shopsWithRating = shops.filter((s) => s.rating > 0);
  const avgRating = shopsWithRating.length > 0
    ? (shopsWithRating.reduce((s, sh) => s + sh.rating, 0) / shopsWithRating.length).toFixed(1) : "-";
  const totalReviews = shops.reduce((s, sh) => s + sh.totalReviews, 0);
  const alertCount = shops.filter(isAlertShop).length;
  const analyzedCount = shops.filter((s) => s.analyzed).length;
  const totalSearch = shops.reduce((s, sh) => s + (sh.searchTotal || 0), 0);
  const prevTotalSearch = shops.reduce((s, sh) => s + (sh.prevSearchTotal || 0), 0);
  const totalMap = shops.reduce((s, sh) => s + (sh.mapTotal || 0), 0);
  const prevTotalMap = shops.reduce((s, sh) => s + (sh.prevMapTotal || 0), 0);
  const sortArrow = (key: SortKey) => sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  // 評価分布
  const ratingDist = useMemo(() => {
    const d = { "4.5+": 0, "4.0-4.4": 0, "3.5-3.9": 0, "3.0-3.4": 0, "<3.0": 0, "未評価": 0 };
    shops.forEach((s) => {
      if (s.rating >= 4.5) d["4.5+"]++;
      else if (s.rating >= 4.0) d["4.0-4.4"]++;
      else if (s.rating >= 3.5) d["3.5-3.9"]++;
      else if (s.rating >= 3.0) d["3.0-3.4"]++;
      else if (s.rating > 0) d["<3.0"]++;
      else d["未評価"]++;
    });
    return d;
  }, [shops]);

  return (
    <div className="min-h-screen bg-[#f1f5f9]" style={{ fontFamily: "'Segoe UI', 'Hiragino Sans', 'Meiryo', sans-serif" }}>
      {/* ヘッダー */}
      <header className="bg-[#E6EEFF] shadow-sm border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-[1440px] mx-auto px-6 h-[60px] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold text-[#003D6B] tracking-wide">SPOTLIGHT NAVIGATOR</h1>
            <span className="text-xs text-slate-500 bg-white/60 px-2.5 py-0.5 rounded-full">レポート管理</span>
          </div>
          <div className="flex items-center gap-2">
            {source !== "spreadsheet" && <span className="text-xs text-amber-700 bg-amber-100 px-3 py-1 rounded-full font-medium">デモデータ</span>}
            {lastSync && <span className="text-xs text-slate-400">反映: {new Date(lastSync).toLocaleTimeString("ja-JP")}</span>}
            {selected.size > 0 && (
              <>
                <button onClick={handleSyncSelected} disabled={syncing}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${syncing ? "bg-slate-200 text-slate-400" : "bg-emerald-600 text-white hover:bg-emerald-700"}`}>
                  {syncing ? "反映中..." : `${selected.size}店舗反映`}
                </button>
                <button
                  onClick={() => {
                    const ids = Array.from(selected);
                    const batch = ids.slice(0, 10);
                    if (ids.length > 10) showToast(`最大10店舗ずつ開きます（${batch.length}/${ids.length}件）`);
                    batch.forEach((id, i) => {
                      setTimeout(() => {
                        window.open(`/report/${encodeURIComponent(id)}`, `_report_${i}`);
                      }, i * 500);
                    });
                    showToast(`${batch.length}店舗のレポートを開いています。各タブでPDFダウンロードしてください。`);
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-purple-600 text-white hover:bg-purple-700 transition-all"
                >
                  一括PDF（{Math.min(selected.size, 10)}件）
                </button>
              </>
            )}
            <button onClick={handleSyncAll} disabled={syncing}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${syncing ? "bg-slate-200 text-slate-400" : "bg-[#003D6B] text-white hover:bg-[#002a4a]"}`}>
              {syncing ? <><span className="inline-block w-3 h-3 border-2 border-slate-300 border-t-white rounded-full animate-spin" />取得中...</> : <>↻ 全店舗反映</>}
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-[1440px] mx-auto px-6 py-6">
        {/* KPI + 評価分布 */}
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3 mb-5">
          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
            <p className="text-[11px] font-medium text-slate-400 mb-1">管理店舗数</p>
            <p className="text-2xl font-bold text-[#003D6B]">{shops.length.toLocaleString()}<span className="text-xs font-normal text-slate-400 ml-1">店舗</span></p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
            <p className="text-[11px] font-medium text-slate-400 mb-1">平均評価</p>
            <p className="text-2xl font-bold text-amber-500">{avgRating}<span className="text-xs font-normal text-slate-400 ml-1">/ 5.0</span></p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
            <p className="text-[11px] font-medium text-slate-400 mb-1">総口コミ</p>
            <p className="text-2xl font-bold text-emerald-600">{totalReviews.toLocaleString()}<span className="text-xs font-normal text-slate-400 ml-1">件</span></p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
            <p className="text-[11px] font-medium text-slate-400 mb-1">検索数合計</p>
            <p className="text-2xl font-bold text-blue-600">{totalSearch.toLocaleString()}<span className="text-xs font-normal text-slate-400 ml-1">回</span></p>
            {prevTotalSearch > 0 && <MomBadge cur={totalSearch} prev={prevTotalSearch} label="検索" />}
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
            <p className="text-[11px] font-medium text-slate-400 mb-1">マップ表示合計</p>
            <p className="text-2xl font-bold text-teal-600">{totalMap.toLocaleString()}<span className="text-xs font-normal text-slate-400 ml-1">回</span></p>
            {prevTotalMap > 0 && <MomBadge cur={totalMap} prev={prevTotalMap} label="マップ" />}
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
            <p className="text-[11px] font-medium text-slate-400 mb-1">AI分析済み</p>
            <p className="text-2xl font-bold text-purple-600">{analyzedCount}<span className="text-xs font-normal text-slate-400 ml-1">/ {shops.length}</span></p>
          </div>
          {/* 評価分布 */}
          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 xl:col-span-2">
            <p className="text-[11px] font-medium text-slate-400 mb-2">評価分布</p>
            <div className="flex gap-1 items-end h-8">
              {Object.entries(ratingDist).map(([label, count]) => {
                const max = Math.max(...Object.values(ratingDist), 1);
                const h = Math.max((count / max) * 100, 4);
                const colors: Record<string, string> = { "4.5+": "bg-emerald-400", "4.0-4.4": "bg-blue-400", "3.5-3.9": "bg-amber-400", "3.0-3.4": "bg-orange-400", "<3.0": "bg-red-400", "未評価": "bg-slate-200" };
                return (
                  <div key={label} className="flex-1 flex flex-col items-center gap-0.5" title={`${label}: ${count}件`}>
                    <div className={`w-full rounded-sm ${colors[label]}`} style={{ height: `${h}%` }} />
                    <span className="text-[8px] text-slate-400 leading-none">{label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* フィルタバー */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-3 mb-4">
          <div className="flex flex-wrap gap-2 items-center">
            {/* 検索 */}
            <div className="relative flex-1 min-w-[200px]">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              <input type="text" placeholder="店舗名・住所で検索..." value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#003D6B]/20" />
            </div>

            {/* エリアフィルタ */}
            <select value={areaFilter} onChange={(e) => { setAreaFilter(e.target.value); setPage(1); }}
              className="px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none">
              {areas.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>

            {/* 評価フィルタ */}
            <div className="flex gap-1">
              {RATING_FILTERS.map((rf, i) => (
                <button key={i} onClick={() => { setRatingFilter(i); setPage(1); }}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${ratingFilter === i ? "bg-[#003D6B] text-white" : "bg-slate-50 text-slate-500 hover:bg-slate-100"}`}>{rf.label}</button>
              ))}
            </div>

            {/* 特殊フィルタ */}
            <button onClick={() => { setShowOnlyFavorites(!showOnlyFavorites); setPage(1); }}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold ${showOnlyFavorites ? "bg-amber-100 text-amber-700" : "bg-slate-50 text-slate-400 hover:bg-slate-100"}`}>
              ★ お気に入り{favorites.size > 0 && ` (${favorites.size})`}
            </button>
            {alertCount > 0 && (
              <button onClick={() => { setShowOnlyAlert(!showOnlyAlert); setPage(1); }}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold ${showOnlyAlert ? "bg-red-100 text-red-700" : "bg-red-50 text-red-400 hover:bg-red-100"}`}>
                ⚠ 要注意 ({alertCount})
              </button>
            )}

            {/* ソート */}
            <div className="flex gap-1 ml-auto">
              {([["name", "名前"], ["rating", "評価"], ["totalReviews", "口コミ"]] as [SortKey, string][]).map(([key, label]) => (
                <button key={key} onClick={() => toggleSort(key)}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold ${sortKey === key ? "bg-blue-50 text-[#003D6B] border border-blue-200" : "bg-slate-50 text-slate-500 hover:bg-slate-100"}`}>
                  {label}{sortArrow(key)}
                </button>
              ))}
            </div>

            {/* 表示切替 */}
            <div className="flex border border-slate-200 rounded-lg overflow-hidden">
              <button onClick={() => setViewMode("card")}
                className={`px-2.5 py-1.5 text-[11px] ${viewMode === "card" ? "bg-[#003D6B] text-white" : "bg-white text-slate-500"}`}>
                ▦ カード
              </button>
              <button onClick={() => setViewMode("list")}
                className={`px-2.5 py-1.5 text-[11px] ${viewMode === "list" ? "bg-[#003D6B] text-white" : "bg-white text-slate-500"}`}>
                ☰ リスト
              </button>
            </div>
          </div>
        </div>

        {/* 件数バー */}
        <div className="flex items-center justify-between mb-2 px-1">
          <div className="flex items-center gap-3">
            <button onClick={toggleSelectAll} className="text-[11px] text-[#003D6B] hover:underline font-medium">
              {selected.size === filtered.length ? "全解除" : "全選択"}
            </button>
            <p className="text-[11px] text-slate-400">
              {filtered.length}件{search && ` — 「${search}」`}
              {selected.size > 0 && <span className="ml-2 text-emerald-600 font-semibold">{selected.size}件選択中</span>}
            </p>
          </div>
          {totalPages > 1 && <p className="text-[11px] text-slate-400">{page} / {totalPages}</p>}
        </div>

        {/* 店舗一覧 */}
        {paged.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-16 text-center">
            <p className="text-slate-400 text-sm">該当する店舗がありません</p>
          </div>
        ) : viewMode === "card" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mb-6">
            {paged.map((shop) => (
              <ShopCard key={shop.id} shop={shop} checked={selected.has(shop.id)} onToggle={() => toggleSelect(shop.id)}
                isFavorite={favorites.has(shop.id)} onToggleFav={() => toggleFavorite(shop.id)} isAlert={isAlertShop(shop)} />
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden mb-6">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="w-8 p-2"><input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleSelectAll} className="w-3.5 h-3.5" /></th>
                  <th className="w-8 p-2">★</th>
                  <th className="text-left p-2 font-semibold text-slate-600">店舗名</th>
                  <th className="text-left p-2 font-semibold text-slate-600 hidden xl:table-cell">住所</th>
                  <th className="p-2 font-semibold text-slate-600 text-center">評価</th>
                  <th className="p-2 font-semibold text-slate-600 text-center">口コミ</th>
                  <th className="p-2 font-semibold text-slate-600 text-center hidden md:table-cell">口コミ比</th>
                  <th className="p-2 font-semibold text-slate-600 text-center hidden lg:table-cell">検索比</th>
                  <th className="p-2 font-semibold text-slate-600 text-center hidden lg:table-cell">マップ比</th>
                  <th className="p-2 font-semibold text-slate-600 text-center">対象月</th>
                  <th className="p-2 font-semibold text-slate-600 text-center">AI</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {paged.map((shop) => (
                  <tr key={shop.id} className={`border-b border-slate-50 hover:bg-slate-50 transition-colors ${isAlertShop(shop) ? "bg-red-50/50" : ""}`}>
                    <td className="p-2 text-center">
                      <input type="checkbox" checked={selected.has(shop.id)} onChange={() => toggleSelect(shop.id)} className="w-3.5 h-3.5" />
                    </td>
                    <td className="p-2 text-center">
                      <button onClick={() => toggleFavorite(shop.id)} className={`text-sm ${favorites.has(shop.id) ? "text-amber-400" : "text-slate-200 hover:text-amber-300"}`}>★</button>
                    </td>
                    <td className="p-2">
                      <Link href={`/report/${encodeURIComponent(shop.id)}`} className="text-slate-800 font-medium hover:text-[#003D6B] hover:underline">{shop.name}</Link>
                    </td>
                    <td className="p-2 text-slate-400 truncate max-w-[200px] hidden xl:table-cell">{shop.address}</td>
                    <td className="p-2 text-center">
                      {shop.rating > 0 ? <><Stars rating={shop.rating} /> <span className="text-slate-600 font-semibold ml-0.5">{shop.rating}</span></> : <span className="text-slate-300">-</span>}
                    </td>
                    <td className="p-2 text-center text-slate-600 font-medium">{shop.totalReviews > 0 ? shop.totalReviews.toLocaleString() : "-"}</td>
                    <td className="p-2 text-center hidden md:table-cell">
                      {shop.prevTotalReviews ? <MomBadge cur={shop.totalReviews} prev={shop.prevTotalReviews} label="口コミ" /> : <span className="text-slate-300">-</span>}
                    </td>
                    <td className="p-2 text-center hidden lg:table-cell">
                      {shop.prevSearchTotal ? <MomBadge cur={shop.searchTotal || 0} prev={shop.prevSearchTotal} label="検索" /> : <span className="text-slate-300">-</span>}
                    </td>
                    <td className="p-2 text-center hidden lg:table-cell">
                      {shop.prevMapTotal ? <MomBadge cur={shop.mapTotal || 0} prev={shop.prevMapTotal} label="マップ" /> : <span className="text-slate-300">-</span>}
                    </td>
                    <td className="p-2 text-center text-slate-400">{shop.period}</td>
                    <td className="p-2 text-center">
                      {shop.analyzed ? <span className="text-emerald-500 text-[10px] font-bold">済</span> : <span className="text-slate-300 text-[10px]">未</span>}
                    </td>
                    <td className="p-2 text-center">
                      <Link href={`/report/${encodeURIComponent(shop.id)}`} className="text-slate-300 hover:text-[#003D6B]">→</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ページネーション */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-1.5 mt-4 mb-8">
            <PageBtn disabled={page <= 1} onClick={() => setPage(page - 1)}>← 前へ</PageBtn>
            {generatePageNumbers(page, totalPages).map((p, i) =>
              p === -1 ? <span key={`d${i}`} className="text-slate-300 text-sm px-1">…</span>
                : <PageBtn key={p} active={p === page} onClick={() => setPage(p)}>{p}</PageBtn>
            )}
            <PageBtn disabled={page >= totalPages} onClick={() => setPage(page + 1)}>次へ →</PageBtn>
          </div>
        )}

        <footer className="text-center py-6 text-[11px] text-slate-300">© {new Date().getFullYear()} SPOTLIGHT NAVIGATOR by 株式会社Chubby</footer>

        {/* トースト */}
        {toast && (
          <div className="fixed bottom-6 right-6 z-50 bg-[#003D6B] text-white px-6 py-3 rounded-xl shadow-lg text-sm font-medium animate-fade-in flex items-center gap-2">
            <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}

// ── サブコンポーネント ──

function ShopCard({ shop, checked, onToggle, isFavorite, onToggleFav, isAlert }: {
  shop: ShopListItem; checked: boolean; onToggle: () => void; isFavorite: boolean; onToggleFav: () => void; isAlert: boolean;
}) {
  const ratingBadge =
    shop.rating >= 4.5 ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
    shop.rating >= 4.0 ? "bg-blue-50 text-blue-700 border-blue-200" :
    shop.rating >= 3.5 ? "bg-amber-50 text-amber-700 border-amber-200" :
    shop.rating > 0 ? "bg-red-50 text-red-700 border-red-200" : "bg-slate-50 text-slate-400 border-slate-200";

  return (
    <div className={`group bg-white rounded-xl border shadow-sm p-4 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 ${isAlert ? "border-red-200 bg-red-50/30" : "border-slate-100"}`}>
      <div className="flex items-start gap-2 mb-2">
        <input type="checkbox" checked={checked} onChange={onToggle} onClick={(e) => e.stopPropagation()}
          className="mt-1 w-3.5 h-3.5 rounded border-slate-300 flex-shrink-0 cursor-pointer" />
        <button onClick={onToggleFav} className={`mt-0.5 text-sm flex-shrink-0 ${isFavorite ? "text-amber-400" : "text-slate-200 hover:text-amber-300"}`}>★</button>
        <Link href={`/report/${encodeURIComponent(shop.id)}`} className="min-w-0 flex-1 block">
          <h3 className="text-sm font-bold text-slate-800 truncate group-hover:text-[#003D6B] transition-colors">{shop.name}</h3>
          <p className="text-[10px] text-slate-400 truncate mt-0.5">{shop.address}</p>
        </Link>
        {isAlert && <span className="text-[10px] text-red-500 font-bold flex-shrink-0" title="要注意">⚠</span>}
        <Link href={`/report/${encodeURIComponent(shop.id)}`} className="flex-shrink-0">
          <svg className="w-4 h-4 text-slate-200 group-hover:text-[#003D6B] transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap ml-[52px]">
        {shop.rating > 0 && (
          <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${ratingBadge}`}>
            <Stars rating={shop.rating} /> {shop.rating}
          </span>
        )}
        {shop.totalReviews > 0 && (
          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-50 text-slate-500 border border-slate-100">
            {shop.totalReviews.toLocaleString()}件
          </span>
        )}
        {shop.prevTotalReviews !== undefined && shop.prevTotalReviews > 0 && (
          <MomBadge cur={shop.totalReviews} prev={shop.prevTotalReviews} label="口コミ" />
        )}
        {shop.prevSearchTotal !== undefined && shop.prevSearchTotal > 0 && (
          <MomBadge cur={shop.searchTotal || 0} prev={shop.prevSearchTotal} label="検索" />
        )}
        {shop.prevMapTotal !== undefined && shop.prevMapTotal > 0 && (
          <MomBadge cur={shop.mapTotal || 0} prev={shop.prevMapTotal} label="マップ" />
        )}
        {shop.analyzed && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-50 text-purple-500 border border-purple-100">AI済</span>}
        <span className="px-2 py-0.5 rounded-full text-[10px] text-slate-400 bg-slate-50 ml-auto">{shop.period}</span>
      </div>
    </div>
  );
}

function PageBtn({ children, active, disabled, onClick }: { children: React.ReactNode; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`min-w-[32px] h-8 px-2.5 rounded-lg text-xs font-medium transition-all ${
        active ? "bg-[#003D6B] text-white shadow-sm" : disabled ? "bg-slate-50 text-slate-300 cursor-not-allowed" : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
      }`}>{children}</button>
  );
}

function generatePageNumbers(current: number, total: number): number[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: number[] = [1];
  if (current > 3) pages.push(-1);
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) pages.push(i);
  if (current < total - 2) pages.push(-1);
  pages.push(total);
  return pages;
}
