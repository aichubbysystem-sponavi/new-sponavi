"use client";

import Link from "next/link";
import { useState, useMemo } from "react";
import type { ShopListItem } from "@/lib/report-data";

type SortKey = "name" | "rating" | "totalReviews" | "period";
type SortDir = "asc" | "desc";

const PER_PAGE = 24;

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

  // フィルタ＆ソート
  const filtered = useMemo(() => {
    let result = shops;

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.address.toLowerCase().includes(q)
      );
    }

    result = [...result].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = a.name.localeCompare(b.name, "ja");
          break;
        case "rating":
          cmp = a.rating - b.rating;
          break;
        case "totalReviews":
          cmp = a.totalReviews - b.totalReviews;
          break;
        case "period":
          cmp = a.period.localeCompare(b.period, "ja");
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return result;
  }, [shops, search, sortKey, sortDir]);

  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const paged = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  // ソートトグル
  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
    setPage(1);
  }

  // 統計
  const avgRating =
    shops.length > 0
      ? (
          shops.reduce((s, sh) => s + sh.rating, 0) /
          shops.filter((s) => s.rating > 0).length
        ).toFixed(1)
      : "0";
  const totalReviews = shops.reduce((s, sh) => s + sh.totalReviews, 0);

  const sortArrow = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  return (
    <div className="min-h-screen bg-[#f1f5f9]">
      {/* ヘッダー */}
      <header className="bg-[#003D6B] text-white shadow-lg">
        <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center text-sm font-bold">
              SN
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-wide">
                SPOTLIGHT NAVIGATOR
              </h1>
              <p className="text-xs text-white/60">レポート管理</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {source !== "spreadsheet" && (
              <span className="text-xs bg-amber-500/20 text-amber-200 px-3 py-1 rounded-full border border-amber-400/30">
                デモデータ
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-[1400px] mx-auto px-6 py-6">
        {/* 統計カード */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard label="管理店舗数" value={shops.length.toLocaleString()} unit="店舗" color="blue" />
          <StatCard label="平均評価" value={avgRating} unit="/ 5.0" color="amber" />
          <StatCard label="総口コミ数" value={totalReviews.toLocaleString()} unit="件" color="green" />
          <StatCard
            label="レポート対象"
            value={filtered.length.toLocaleString()}
            unit={`/ ${shops.length}`}
            color="purple"
          />
        </div>

        {/* 検索＆フィルタ */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-6">
          <div className="flex flex-col md:flex-row gap-3 items-center">
            <div className="relative flex-1 w-full">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                type="text"
                placeholder="店舗名・住所で検索..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#003D6B]/30 focus:border-[#003D6B]/50"
              />
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <SortButton
                label={`店舗名${sortArrow("name")}`}
                active={sortKey === "name"}
                onClick={() => toggleSort("name")}
              />
              <SortButton
                label={`評価${sortArrow("rating")}`}
                active={sortKey === "rating"}
                onClick={() => toggleSort("rating")}
              />
              <SortButton
                label={`口コミ数${sortArrow("totalReviews")}`}
                active={sortKey === "totalReviews"}
                onClick={() => toggleSort("totalReviews")}
              />
            </div>
          </div>
        </div>

        {/* 店舗一覧 */}
        {paged.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-16 text-center">
            <p className="text-slate-400 text-sm">
              該当する店舗が見つかりません
            </p>
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
          <div className="flex items-center justify-center gap-2 mt-6 mb-8">
            <PaginationButton
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              前へ
            </PaginationButton>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              let p: number;
              if (totalPages <= 7) {
                p = i + 1;
              } else if (page <= 4) {
                p = i + 1;
              } else if (page >= totalPages - 3) {
                p = totalPages - 6 + i;
              } else {
                p = page - 3 + i;
              }
              return (
                <PaginationButton
                  key={p}
                  active={p === page}
                  onClick={() => setPage(p)}
                >
                  {p}
                </PaginationButton>
              );
            })}
            <PaginationButton
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              次へ
            </PaginationButton>
          </div>
        )}

        {/* フッター */}
        <footer className="text-center py-6 text-xs text-slate-400">
          © {new Date().getFullYear()} SPOTLIGHT NAVIGATOR by 株式会社Chubby
        </footer>
      </div>
    </div>
  );
}

// ── サブコンポーネント ──

function StatCard({
  label,
  value,
  unit,
  color,
}: {
  label: string;
  value: string;
  unit: string;
  color: "blue" | "amber" | "green" | "purple";
}) {
  const colorMap = {
    blue: "bg-blue-50 border-blue-100 text-blue-700",
    amber: "bg-amber-50 border-amber-100 text-amber-700",
    green: "bg-green-50 border-green-100 text-green-700",
    purple: "bg-purple-50 border-purple-100 text-purple-700",
  };
  const valueColor = {
    blue: "text-[#003D6B]",
    amber: "text-amber-600",
    green: "text-green-600",
    purple: "text-purple-600",
  };

  return (
    <div
      className={`rounded-xl border p-4 ${colorMap[color]} transition-all hover:shadow-sm`}
    >
      <p className="text-xs font-medium opacity-70 mb-1">{label}</p>
      <p className="flex items-baseline gap-1.5">
        <span className={`text-2xl font-bold ${valueColor[color]}`}>
          {value}
        </span>
        <span className="text-xs opacity-60">{unit}</span>
      </p>
    </div>
  );
}

function ShopCard({ shop }: { shop: ShopListItem }) {
  const ratingColor =
    shop.rating >= 4.5
      ? "bg-green-100 text-green-700"
      : shop.rating >= 4.0
        ? "bg-blue-100 text-blue-700"
        : shop.rating >= 3.5
          ? "bg-amber-100 text-amber-700"
          : shop.rating > 0
            ? "bg-red-100 text-red-700"
            : "bg-slate-100 text-slate-500";

  return (
    <Link
      href={`/report/${encodeURIComponent(shop.id)}`}
      className="group bg-white rounded-xl border border-slate-200 shadow-sm p-5 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 block"
    >
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-lg bg-[#003D6B] flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
          {shop.name.charAt(0)}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-800 truncate group-hover:text-[#003D6B] transition-colors">
            {shop.name}
          </h3>
          <p className="text-xs text-slate-400 truncate mt-0.5">
            {shop.address}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {shop.rating > 0 && (
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${ratingColor}`}
          >
            ★ {shop.rating}
          </span>
        )}
        {shop.totalReviews > 0 && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
            {shop.totalReviews.toLocaleString()}件
          </span>
        )}
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs text-slate-400 bg-slate-50">
          {shop.period}
        </span>
        <svg
          className="w-4 h-4 text-slate-300 group-hover:text-[#003D6B] ml-auto transition-colors"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5l7 7-7 7"
          />
        </svg>
      </div>
    </Link>
  );
}

function SortButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
        active
          ? "bg-[#003D6B] text-white"
          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
      }`}
    >
      {label}
    </button>
  );
}

function PaginationButton({
  children,
  active,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`min-w-[36px] h-9 px-3 rounded-lg text-sm font-medium transition-colors ${
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
