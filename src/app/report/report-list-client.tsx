"use client";

import Link from "next/link";
import { useState, useMemo, useTransition } from "react";
import type { ShopListItem } from "@/lib/report-data";
import { syncReportData } from "./actions";

type SortKey = "name" | "rating" | "totalReviews" | "period";
type SortDir = "asc" | "desc";

const PER_PAGE = 30;

// 評価フィルタ選択肢
const RATING_FILTERS = [
  { label: "すべて", min: 0, max: 5 },
  { label: "★4.5+", min: 4.5, max: 5 },
  { label: "★4.0+", min: 4.0, max: 5 },
  { label: "★3.5+", min: 3.5, max: 5 },
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
  const [ratingFilter, setRatingFilter] = useState(0); // index into RATING_FILTERS
  const [syncing, startSync] = useTransition();
  const [lastSync, setLastSync] = useState<string | null>(null);

  // フィルタ＆ソート
  const filtered = useMemo(() => {
    let result = shops;

    // テキスト検索
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.address.toLowerCase().includes(q)
      );
    }

    // 評価フィルタ
    const rf = RATING_FILTERS[ratingFilter];
    if (rf.min > 0 || rf.max < 5) {
      result = result.filter(
        (s) => s.rating >= rf.min && s.rating < (rf.max === 5 ? 6 : rf.max)
      );
    }

    // ソート
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
  }, [shops, search, sortKey, sortDir, ratingFilter]);

  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const paged = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
    setPage(1);
  }

  function handleSync() {
    startSync(async () => {
      const result = await syncReportData();
      setLastSync(result.timestamp);
      window.location.reload();
    });
  }

  // 統計
  const shopsWithRating = shops.filter((s) => s.rating > 0);
  const avgRating =
    shopsWithRating.length > 0
      ? (shopsWithRating.reduce((s, sh) => s + sh.rating, 0) / shopsWithRating.length).toFixed(1)
      : "-";
  const totalReviews = shops.reduce((s, sh) => s + sh.totalReviews, 0);

  const sortArrow = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
        fontFamily: "'Noto Sans JP', sans-serif",
        color: "#fff",
      }}
    >
      {/* ヘッダー */}
      <header
        style={{
          background: "rgba(255,255,255,0.04)",
          backdropFilter: "blur(10px)",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          padding: "16px 0",
          position: "sticky",
          top: 0,
          zIndex: 50,
        }}
      >
        <div style={{ maxWidth: 1400, margin: "0 auto", padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: "linear-gradient(135deg, #e94560, #c73050)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 14,
                fontWeight: 900,
                letterSpacing: 1,
              }}
            >
              SN
            </div>
            <div>
              <h1 style={{ fontSize: 18, fontWeight: 900, letterSpacing: 1, lineHeight: 1.2 }}>
                <span style={{ color: "#e94560" }}>SPOTLIGHT</span> NAVIGATOR
              </h1>
              <p style={{ fontSize: 11, opacity: 0.5, letterSpacing: 0.5 }}>レポート管理システム</p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {source !== "spreadsheet" && (
              <span style={{ fontSize: 11, color: "#ffd54f", background: "rgba(255,213,79,0.12)", padding: "4px 14px", borderRadius: 20, border: "1px solid rgba(255,213,79,0.2)" }}>
                デモデータ
              </span>
            )}
            <button
              onClick={handleSync}
              disabled={syncing}
              style={{
                background: syncing
                  ? "rgba(255,255,255,0.08)"
                  : "linear-gradient(135deg, #e94560, #c73050)",
                color: "#fff",
                border: "none",
                padding: "8px 20px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: syncing ? "wait" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
                transition: "all 0.2s",
                opacity: syncing ? 0.6 : 1,
              }}
            >
              {syncing ? (
                <>
                  <span style={{ display: "inline-block", width: 14, height: 14, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                  取得中...
                </>
              ) : (
                <>↻ 反映する</>
              )}
            </button>
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "24px" }}>
        {/* 統計カード */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
          <KpiMini label="管理店舗数" value={shops.length.toLocaleString()} unit="店舗" accent="#4fc3f7" />
          <KpiMini label="平均評価" value={avgRating} unit="/ 5.0" accent="#ffd54f" />
          <KpiMini label="総口コミ数" value={totalReviews.toLocaleString()} unit="件" accent="#81c784" />
          <KpiMini label="表示中" value={filtered.length.toLocaleString()} unit={`/ ${shops.length}店舗`} accent="#ba68c8" />
        </div>

        {/* 検索 & フィルタ */}
        <div
          style={{
            background: "rgba(255,255,255,0.06)",
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.08)",
            padding: "16px 20px",
            marginBottom: 20,
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            alignItems: "center",
          }}
        >
          {/* 検索 */}
          <div style={{ flex: 1, minWidth: 240, position: "relative" }}>
            <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 14, opacity: 0.4 }}>🔍</span>
            <input
              type="text"
              placeholder="店舗名・住所で検索..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              style={{
                width: "100%",
                padding: "10px 14px 10px 36px",
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 8,
                color: "#fff",
                fontSize: 13,
                outline: "none",
              }}
            />
          </div>

          {/* 評価フィルタ */}
          <div style={{ display: "flex", gap: 4 }}>
            {RATING_FILTERS.map((rf, i) => (
              <button
                key={i}
                onClick={() => { setRatingFilter(i); setPage(1); }}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  border: "none",
                  cursor: "pointer",
                  transition: "all 0.15s",
                  background: ratingFilter === i ? "rgba(233,69,96,0.9)" : "rgba(255,255,255,0.06)",
                  color: ratingFilter === i ? "#fff" : "rgba(255,255,255,0.6)",
                }}
              >
                {rf.label}
              </button>
            ))}
          </div>

          {/* ソート */}
          <div style={{ display: "flex", gap: 4 }}>
            {([["name", "名前"], ["rating", "評価"], ["totalReviews", "口コミ"]] as [SortKey, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => toggleSort(key)}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  border: "none",
                  cursor: "pointer",
                  background: sortKey === key ? "rgba(79,195,247,0.2)" : "rgba(255,255,255,0.04)",
                  color: sortKey === key ? "#4fc3f7" : "rgba(255,255,255,0.5)",
                  transition: "all 0.15s",
                }}
              >
                {label}{sortArrow(key)}
              </button>
            ))}
          </div>
        </div>

        {/* 結果件数 */}
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 12, paddingLeft: 4 }}>
          {filtered.length}件の店舗{search && ` — 「${search}」で検索中`}
          {lastSync && <span style={{ marginLeft: 12 }}>最終反映: {new Date(lastSync).toLocaleTimeString("ja-JP")}</span>}
        </div>

        {/* 店舗一覧 */}
        {paged.length === 0 ? (
          <div style={{ textAlign: "center", padding: "80px 20px", color: "rgba(255,255,255,0.3)" }}>
            <p style={{ fontSize: 16, marginBottom: 6 }}>該当する店舗がありません</p>
            <p style={{ fontSize: 13 }}>検索条件を変更してください</p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
            {paged.map((shop) => (
              <ShopCard key={shop.id} shop={shop} />
            ))}
          </div>
        )}

        {/* ページネーション */}
        {totalPages > 1 && (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 6, marginTop: 28, marginBottom: 20 }}>
            <PageBtn disabled={page <= 1} onClick={() => setPage(page - 1)}>← 前へ</PageBtn>
            {generatePageNumbers(page, totalPages).map((p, i) =>
              p === -1 ? (
                <span key={`dot-${i}`} style={{ color: "rgba(255,255,255,0.3)", fontSize: 12, padding: "0 4px" }}>…</span>
              ) : (
                <PageBtn key={p} active={p === page} onClick={() => setPage(p)}>{p}</PageBtn>
              )
            )}
            <PageBtn disabled={page >= totalPages} onClick={() => setPage(page + 1)}>次へ →</PageBtn>
          </div>
        )}

        {/* フッター */}
        <footer style={{ textAlign: "center", padding: "32px 0", fontSize: 11, color: "rgba(255,255,255,0.2)" }}>
          © {new Date().getFullYear()} SPOTLIGHT NAVIGATOR by 株式会社Chubby
        </footer>
      </div>

      {/* スピナーアニメーション */}
      <style dangerouslySetInnerHTML={{ __html: `@keyframes spin { to { transform: rotate(360deg) } }` }} />
    </div>
  );
}

// ── サブコンポーネント ──

function KpiMini({ label, value, unit, accent }: { label: string; value: string; unit: string; accent: string }) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.05)",
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.06)",
        padding: "16px 20px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: 3, background: accent }} />
      <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontWeight: 500, marginBottom: 6 }}>{label}</p>
      <p style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ fontSize: 28, fontWeight: 900, color: accent, lineHeight: 1 }}>{value}</span>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>{unit}</span>
      </p>
    </div>
  );
}

function ShopCard({ shop }: { shop: ShopListItem }) {
  const ratingBg =
    shop.rating >= 4.5 ? "rgba(129,199,132,0.15)" :
    shop.rating >= 4.0 ? "rgba(79,195,247,0.15)" :
    shop.rating >= 3.5 ? "rgba(255,183,77,0.15)" :
    shop.rating > 0 ? "rgba(229,115,115,0.15)" : "rgba(255,255,255,0.05)";
  const ratingColor =
    shop.rating >= 4.5 ? "#81c784" :
    shop.rating >= 4.0 ? "#4fc3f7" :
    shop.rating >= 3.5 ? "#ffb74d" :
    shop.rating > 0 ? "#e57373" : "rgba(255,255,255,0.3)";

  return (
    <Link
      href={`/report/${encodeURIComponent(shop.id)}`}
      style={{
        display: "block",
        background: "rgba(255,255,255,0.05)",
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.06)",
        padding: "18px 20px",
        textDecoration: "none",
        color: "#fff",
        transition: "all 0.2s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(255,255,255,0.09)";
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = "0 8px 30px rgba(0,0,0,0.3)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "rgba(255,255,255,0.05)";
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: "linear-gradient(135deg, #e94560, #0f3460)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 16,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {shop.name.charAt(0)}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", margin: 0 }}>
            {shop.name}
          </h3>
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", margin: "2px 0 0" }}>
            {shop.address}
          </p>
        </div>
        <span style={{ fontSize: 16, color: "rgba(255,255,255,0.2)", flexShrink: 0 }}>›</span>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {shop.rating > 0 && (
          <span style={{ background: ratingBg, color: ratingColor, padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 700 }}>
            ★ {shop.rating}
          </span>
        )}
        {shop.totalReviews > 0 && (
          <span style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)", padding: "3px 10px", borderRadius: 20, fontSize: 12, fontWeight: 500 }}>
            口コミ {shop.totalReviews.toLocaleString()}件
          </span>
        )}
        <span style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.3)", padding: "3px 10px", borderRadius: 20, fontSize: 11 }}>
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
      style={{
        minWidth: 36,
        height: 36,
        padding: "0 10px",
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 600,
        border: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "all 0.15s",
        background: active ? "#e94560" : disabled ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.06)",
        color: active ? "#fff" : disabled ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.5)",
      }}
    >
      {children}
    </button>
  );
}

function generatePageNumbers(current: number, total: number): number[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: number[] = [1];
  if (current > 3) pages.push(-1);
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
    pages.push(i);
  }
  if (current < total - 2) pages.push(-1);
  pages.push(total);
  return pages;
}
