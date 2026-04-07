"use client";

import Link from "next/link";
import { useState, useMemo, useTransition } from "react";
import type { ShopListItem } from "@/lib/report-data";
import { syncReportData } from "./actions";

type SortKey = "name" | "rating" | "totalReviews" | "period";
type SortDir = "asc" | "desc";

const PER_PAGE = 30;

const RATING_FILTERS = [
  { label: "すべて", min: 0, max: 6 },
  { label: "★4.5+", min: 4.5, max: 6 },
  { label: "★4.0+", min: 4.0, max: 6 },
  { label: "★3.5+", min: 3.5, max: 6 },
  { label: "★3.5未満", min: 0, max: 3.5 },
];

export default function ReportListClient({
  shops,
  source,
}: {
  shops: ShopListItem[];
  source: "spreadsheet" | "mock";
}) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const [ratingFilter, setRatingFilter] = useState(0);
  const [syncing, startSync] = useTransition();
  const [lastSync, setLastSync] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let result = shops;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (s) => s.name.toLowerCase().includes(q) || s.address.toLowerCase().includes(q)
      );
    }
    const rf = RATING_FILTERS[ratingFilter];
    if (rf.min > 0 || rf.max < 6) {
      result = result.filter((s) => s.rating >= rf.min && s.rating < rf.max);
    }
    result = [...result].sort((a, b) => {
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
  }, [shops, search, sortKey, sortDir, ratingFilter]);

  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const paged = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "name" ? "asc" : "desc"); }
    setPage(1);
  }

  function handleSync() {
    startSync(async () => {
      const result = await syncReportData();
      setLastSync(result.timestamp);
      window.location.reload();
    });
  }

  const shopsWithRating = shops.filter((s) => s.rating > 0);
  const avgRating = shopsWithRating.length > 0
    ? (shopsWithRating.reduce((s, sh) => s + sh.rating, 0) / shopsWithRating.length).toFixed(1)
    : "-";
  const totalReviews = shops.reduce((s, sh) => s + sh.totalReviews, 0);
  const sortArrow = (key: SortKey) => sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  return (
    <div className="min-h-screen bg-[#f1f5f9]" style={{ fontFamily: "'Segoe UI', 'Hiragino Sans', 'Meiryo', sans-serif" }}>
      {/* ヘッダー */}
      <header className="bg-[#E6EEFF] shadow-sm border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-[1440px] mx-auto px-6 h-[60px] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold text-[#003D6B] tracking-wide">SPOTLIGHT NAVIGATOR</h1>
            <span className="text-xs text-slate-500 bg-white/60 px-2.5 py-0.5 rounded-full">レポート管理</span>
          </div>
          <div className="flex items-center gap-3">
            {source !== "spreadsheet" && (
              <span className="text-xs text-amber-700 bg-amber-100 px-3 py-1 rounded-full font-medium">デモデータ</span>
            )}
            {lastSync && (
              <span className="text-xs text-slate-400">最終反映: {new Date(lastSync).toLocaleTimeString("ja-JP")}</span>
            )}
            <button
              onClick={handleSync}
              disabled={syncing}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                syncing
                  ? "bg-slate-200 text-slate-400 cursor-wait"
                  : "bg-[#003D6B] text-white hover:bg-[#002a4a] shadow-sm"
              }`}
            >
              {syncing ? (
                <>
                  <span className="inline-block w-3.5 h-3.5 border-2 border-slate-300 border-t-slate-500 rounded-full animate-spin" />
                  取得中...
                </>
              ) : (
                <>↻ 反映する</>
              )}
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-[1440px] mx-auto px-6 py-6">
        {/* KPIカード */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
            <p className="text-xs font-medium text-slate-400 mb-1">管理店舗数</p>
            <p className="text-2xl font-bold text-[#003D6B]">{shops.length.toLocaleString()}<span className="text-xs font-normal text-slate-400 ml-1">店舗</span></p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
            <p className="text-xs font-medium text-slate-400 mb-1">平均評価</p>
            <p className="text-2xl font-bold text-amber-500">{avgRating}<span className="text-xs font-normal text-slate-400 ml-1">/ 5.0</span></p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
            <p className="text-xs font-medium text-slate-400 mb-1">総口コミ数</p>
            <p className="text-2xl font-bold text-emerald-600">{totalReviews.toLocaleString()}<span className="text-xs font-normal text-slate-400 ml-1">件</span></p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
            <p className="text-xs font-medium text-slate-400 mb-1">表示中</p>
            <p className="text-2xl font-bold text-purple-600">{filtered.length.toLocaleString()}<span className="text-xs font-normal text-slate-400 ml-1">/ {shops.length}店舗</span></p>
          </div>
        </div>

        {/* 検索 & フィルタ */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 mb-6">
          <div className="flex flex-col lg:flex-row gap-3 items-center">
            {/* 検索入力 */}
            <div className="relative flex-1 w-full">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="店舗名・住所で検索..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#003D6B]/20 focus:border-[#003D6B]/40 transition-all"
              />
            </div>

            {/* 評価フィルタ */}
            <div className="flex gap-1.5 flex-shrink-0">
              {RATING_FILTERS.map((rf, i) => (
                <button
                  key={i}
                  onClick={() => { setRatingFilter(i); setPage(1); }}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                    ratingFilter === i
                      ? "bg-[#003D6B] text-white shadow-sm"
                      : "bg-slate-50 text-slate-500 hover:bg-slate-100"
                  }`}
                >
                  {rf.label}
                </button>
              ))}
            </div>

            {/* 並べ替え */}
            <div className="flex gap-1.5 flex-shrink-0">
              {([["name", "名前"], ["rating", "評価"], ["totalReviews", "口コミ"]] as [SortKey, string][]).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => toggleSort(key)}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                    sortKey === key
                      ? "bg-blue-50 text-[#003D6B] border border-blue-200"
                      : "bg-slate-50 text-slate-500 hover:bg-slate-100"
                  }`}
                >
                  {label}{sortArrow(key)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 件数表示 */}
        <div className="flex items-center justify-between mb-3 px-1">
          <p className="text-xs text-slate-400">
            {filtered.length}件の店舗{search && ` — 「${search}」で検索中`}
          </p>
          {totalPages > 1 && (
            <p className="text-xs text-slate-400">{page} / {totalPages} ページ</p>
          )}
        </div>

        {/* 店舗カード一覧 */}
        {paged.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-20 text-center">
            <p className="text-slate-400 text-sm mb-1">該当する店舗がありません</p>
            <p className="text-slate-300 text-xs">検索条件を変更してください</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
            {paged.map((shop) => (
              <ShopCard key={shop.id} shop={shop} />
            ))}
          </div>
        )}

        {/* ページネーション */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-1.5 mt-6 mb-8">
            <PageBtn disabled={page <= 1} onClick={() => setPage(page - 1)}>← 前へ</PageBtn>
            {generatePageNumbers(page, totalPages).map((p, i) =>
              p === -1 ? (
                <span key={`dot-${i}`} className="text-slate-300 text-sm px-1">…</span>
              ) : (
                <PageBtn key={p} active={p === page} onClick={() => setPage(p)}>{p}</PageBtn>
              )
            )}
            <PageBtn disabled={page >= totalPages} onClick={() => setPage(page + 1)}>次へ →</PageBtn>
          </div>
        )}

        {/* フッター */}
        <footer className="text-center py-8 text-xs text-slate-300">
          © {new Date().getFullYear()} SPOTLIGHT NAVIGATOR by 株式会社Chubby
        </footer>
      </div>
    </div>
  );
}

// ── サブコンポーネント ──

function ShopCard({ shop }: { shop: ShopListItem }) {
  const ratingBadge =
    shop.rating >= 4.5 ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
    shop.rating >= 4.0 ? "bg-blue-50 text-blue-700 border-blue-200" :
    shop.rating >= 3.5 ? "bg-amber-50 text-amber-700 border-amber-200" :
    shop.rating > 0 ? "bg-red-50 text-red-700 border-red-200" :
    "bg-slate-50 text-slate-400 border-slate-200";

  return (
    <Link
      href={`/report/${encodeURIComponent(shop.id)}`}
      className="group bg-white rounded-xl border border-slate-100 shadow-sm p-5 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 block"
    >
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#003D6B] to-[#005a9e] flex items-center justify-center text-white text-sm font-bold flex-shrink-0 shadow-sm">
          {shop.name.charAt(0)}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-slate-800 truncate group-hover:text-[#003D6B] transition-colors">
            {shop.name}
          </h3>
          <p className="text-[11px] text-slate-400 truncate mt-0.5">{shop.address}</p>
        </div>
        <svg className="w-4 h-4 text-slate-200 group-hover:text-[#003D6B] transition-colors flex-shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {shop.rating > 0 && (
          <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-semibold border ${ratingBadge}`}>
            ★ {shop.rating}
          </span>
        )}
        {shop.totalReviews > 0 && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-50 text-slate-500 border border-slate-100">
            {shop.totalReviews.toLocaleString()}件
          </span>
        )}
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] text-slate-400 bg-slate-50">
          {shop.period}
        </span>
      </div>
    </Link>
  );
}

function PageBtn({ children, active, disabled, onClick }: { children: React.ReactNode; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`min-w-[36px] h-9 px-3 rounded-lg text-sm font-medium transition-all ${
        active
          ? "bg-[#003D6B] text-white shadow-sm"
          : disabled
            ? "bg-slate-50 text-slate-300 cursor-not-allowed"
            : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
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
