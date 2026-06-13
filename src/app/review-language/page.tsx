"use client";

import { useState, useEffect, useCallback } from "react";
import { useShop } from "@/components/shop-provider";
import { supabase } from "@/lib/supabase";
import api from "@/lib/api";

interface LangStat {
  lang: string;
  country: string;
  total: number;
  star1: number;
  star2: number;
  star3: number;
  star4: number;
  star5: number;
  lowRatingCount: number;
}

interface ReviewDetail {
  shop_name: string;
  reviewer_name: string;
  star_rating: number;
  comment: string;
  lang: string;
  country: string;
  create_time: string;
}

interface GbpAccount {
  name: string;
  label: string;
  shopNames: string[];
  shopIds: string[];
}

interface ShopOption {
  id: string;
  name: string;
}

export default function ReviewLanguagePage() {
  const { shops, selectedShopId, shopFilterMode } = useShop();
  const [accounts, setAccounts] = useState<GbpAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string>("all");
  const [loading, setLoading] = useState(false);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [stats, setStats] = useState<LangStat[]>([]);
  const [details, setDetails] = useState<ReviewDetail[]>([]);
  const [totalReviews, setTotalReviews] = useState(0);
  const [totalLowRating, setTotalLowRating] = useState(0);
  const [shopCount, setShopCount] = useState(0);
  const [showDetails, setShowDetails] = useState(false);
  const [detailLangFilter, setDetailLangFilter] = useState<string>("all");
  const [error, setError] = useState<string | null>(null);
  const [selectedShops, setSelectedShops] = useState<Set<string>>(new Set());
  const [shopSearch, setShopSearch] = useState("");

  // 対象月セレクタ（直近6ヶ月 + 全期間）
  const monthOptions = (() => {
    const opts: { value: string; label: string }[] = [{ value: "", label: "全期間" }];
    const now = new Date();
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const val = `${d.getFullYear()}/${d.getMonth() + 1}`;
      opts.push({ value: val, label: val });
    }
    return opts;
  })();
  const [targetMonth, setTargetMonth] = useState("");

  // GBPアカウント一覧を取得 → Go APIの店舗名にマッチング
  useEffect(() => {
    if (shops.length === 0) return;
    (async () => {
      try {
        const res = await api.get("/api/gbp/account", { timeout: 15000 });
        const data = Array.isArray(res.data) ? res.data : [];
        // Go API店舗名のセット（reviewsテーブルのshop_nameと一致する名前）
        const goShopNamesList = shops.map(s => s.name);
        const goShopNamesSet = new Set(goShopNamesList);
        // GBP店舗名→Go API店舗名のマッチング（完全一致 or 大文字小文字無視）
        // GBP店舗名→Go APIの{id, name}をマッチング
        const goShopMap = new Map(shops.map(s => [s.name.toLowerCase(), { id: s.id, name: s.name }]));
        const matchGoShop = (gbpTitle: string): ShopOption | null => {
          return goShopMap.get(gbpTitle.toLowerCase()) || null;
        };
        const accs: GbpAccount[] = data.map((acc: any) => {
          const gbpTitles: string[] = (acc.locations || []).map((loc: any) => loc.title || "").filter(Boolean);
          const matched = gbpTitles.map(matchGoShop).filter(Boolean) as ShopOption[];
          return {
            name: acc.name || "",
            label: acc.email || acc.accountName || acc.name || "",
            shopNames: matched.map(m => m.name),
            shopIds: matched.map(m => m.id),
          };
        });
        setAccounts(accs);
      } catch {}
      setLoadingAccounts(false);
    })();
  }, [shops]);

  // アカウント変更時: 全店舗を選択状態に
  const currentAccountShopOptions: ShopOption[] = selectedAccount === "all"
    ? shops.map(s => ({ id: s.id, name: s.name }))
    : (() => {
        const acc = accounts.find(a => a.name === selectedAccount);
        if (!acc) return [];
        return acc.shopIds.map((id, i) => ({ id, name: acc.shopNames[i] || id }));
      })();

  useEffect(() => {
    setSelectedShops(new Set(currentAccountShopOptions.map(s => s.id)));
    setShopSearch("");
  }, [selectedAccount, accounts.length]);

  // グローバル店舗セレクタで1店舗選択時 → その店舗だけ選択して自動分析
  const [autoRunShopId, setAutoRunShopId] = useState<string>("");
  useEffect(() => {
    if (!selectedShopId || shopFilterMode !== "single" || shops.length === 0) return;
    if (selectedShopId === autoRunShopId) return; // 同じ店舗なら再実行しない
    const match = shops.find(s => s.id === selectedShopId);
    if (match) {
      setSelectedShops(new Set([match.id]));
      setAutoRunShopId(selectedShopId);
    }
  }, [selectedShopId, shopFilterMode, shops.length, autoRunShopId]);

  const toggleShop = (id: string) => {
    setSelectedShops(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const fetchStats = useCallback(async () => {
    // 選択された店舗IDで検索
    const targetShopIds = Array.from(selectedShops);
    const targetShopNames = targetShopIds; // エラーメッセージ用

    if (targetShopNames.length === 0) {
      setError("対象店舗が見つかりません。口コミ同期が必要です。");
      return;
    }

    setLoading(true);
    setError(null);
    setStats([]);
    setDetails([]);
    try {
      const headers = await getAuthHeaders();

      const res = await fetch("/api/report/review-language-stats", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ shopIds: targetShopIds, targetMonth }),
        signal: AbortSignal.timeout(120000),
      });
      if (res.ok) {
        const data = await res.json();
        const allStats = (data.stats || []).sort((a: LangStat, b: LangStat) => b.total - a.total);
        setStats(allStats);
        setDetails((data.details || []).sort((a: ReviewDetail, b: ReviewDetail) => a.star_rating - b.star_rating));
        setTotalReviews(data.totalReviews || 0);
        setTotalLowRating(data.totalLowRating || 0);
        setShopCount(data.shopCount || 0);
        if ((data.totalReviews || 0) === 0) {
          setError(`${targetShopIds.length}店舗を検索しましたが、口コミが0件でした。口コミ管理ページで同期してください。`);
        }
      } else {
        const err = await res.json().catch(() => ({ error: "不明なエラー" }));
        setError(`APIエラー: ${err?.error || res.status}`);
      }
    } catch (e: any) {
      setError(`通信エラー: ${e?.message || "タイムアウト"}`);
    }
    setLoading(false);
  }, [selectedShops, shops, targetMonth]);

  // グローバル店舗変更後に自動でfetchStats実行
  useEffect(() => {
    if (autoRunShopId && selectedShops.size > 0 && !loading) {
      fetchStats();
    }
  }, [autoRunShopId]);

  // 対象月変更時に自動再実行（既に分析結果がある場合のみ）
  const [prevMonth, setPrevMonth] = useState(targetMonth);
  useEffect(() => {
    if (targetMonth !== prevMonth) {
      setPrevMonth(targetMonth);
      if (stats.length > 0 && !loading) {
        fetchStats();
      }
    }
  }, [targetMonth]);

  async function getAuthHeaders(): Promise<Record<string, string>> {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  // Excelダウンロード（3セクション横並び + デザイン付き）
  const downloadExcel = async () => {
    const XLSX = (await import("xlsx-js-style")).default;
    const totalLang = stats.reduce((s, st) => s + st.total, 0);
    const totalLow = stats.reduce((s, st) => s + st.lowRatingCount, 0);
    const sorted = [...details].sort((a, b) => (b.create_time || "").localeCompare(a.create_time || ""));
    const complaints = sorted.filter(d => d.star_rating >= 1 && d.star_rating <= 2);

    // スタイル定義
    const headerFill = { fgColor: { rgb: "0F3460" } };
    const headerFont = { color: { rgb: "FFFFFF" }, bold: true, sz: 10 };
    const titleStyle = { font: { bold: true, sz: 12, color: { rgb: "0F3460" } }, alignment: { horizontal: "center" as const }, fill: { fgColor: { rgb: "E8EDF3" } }, border: { bottom: { style: "thin" as const, color: { rgb: "0F3460" } } } };
    const hdrStyle = { font: headerFont, fill: headerFill, alignment: { horizontal: "center" as const }, border: { bottom: { style: "thin" as const, color: { rgb: "CCCCCC" } } } };
    const cellStyle = { font: { sz: 10 }, border: { bottom: { style: "thin" as const, color: { rgb: "EEEEEE" } } } };
    const numStyle = { ...cellStyle, alignment: { horizontal: "center" as const } };
    const redStyle = { ...numStyle, font: { sz: 10, color: { rgb: "C0392B" }, bold: true } };
    const totalRowStyle = { font: { sz: 10, bold: true }, fill: { fgColor: { rgb: "FFF3E0" } }, alignment: { horizontal: "center" as const }, border: { top: { style: "thin" as const, color: { rgb: "0F3460" } }, bottom: { style: "thin" as const, color: { rgb: "0F3460" } } } };

    const ws: any = {};
    const merges: any[] = [];

    // ── ヘルパー関数 ──
    const ec = (r: number, c: number) => XLSX.utils.encode_cell({ r, c });
    const setCell = (r: number, c: number, v: any, s?: any) => { ws[ec(r, c)] = { v, t: typeof v === "number" ? "n" : "s", s: s || cellStyle }; };

    // ═══ セクション1: 口コミ一覧 (列A-G, col 0-6) ═══
    const C1 = 0;
    merges.push({ s: { r: 0, c: C1 }, e: { r: 0, c: C1 + 6 } });
    setCell(0, C1, "口コミ一覧", titleStyle);
    const hdr1 = ["投稿日", "投稿者", "評価", "口コミ", "返信", "言語", "推定国"];
    hdr1.forEach((h, i) => setCell(1, C1 + i, h, hdrStyle));
    sorted.forEach((d, ri) => {
      const r = ri + 2;
      setCell(r, C1, d.create_time?.slice(0, 10) || "", cellStyle);
      setCell(r, C1 + 1, d.reviewer_name || "", cellStyle);
      setCell(r, C1 + 2, d.star_rating, numStyle);
      setCell(r, C1 + 3, (d.comment || "").replace(/\n/g, " ").slice(0, 500), cellStyle);
      setCell(r, C1 + 4, "", cellStyle);
      setCell(r, C1 + 5, d.lang, cellStyle);
      setCell(r, C1 + 6, d.country, cellStyle);
    });

    // ═══ セクション2: 国別サマリー (列I-S, col 8-18) ═══
    const C2 = 8;
    merges.push({ s: { r: 0, c: C2 }, e: { r: 0, c: C2 + 10 } });
    setCell(0, C2, "国別サマリー", titleStyle);
    const hdr2 = ["推定国", "合計件数", "合計比率", "★5", "★4", "★3", "★2", "★1", "低評価(★1-3)", "低評価比率", "低評価内シェア"];
    hdr2.forEach((h, i) => setCell(1, C2 + i, h, hdrStyle));
    stats.forEach((s, ri) => {
      const r = ri + 2;
      setCell(r, C2, s.country, cellStyle);
      setCell(r, C2 + 1, s.total, numStyle);
      setCell(r, C2 + 2, totalLang > 0 ? Math.round(s.total / totalLang * 100) + "%" : "0%", numStyle);
      setCell(r, C2 + 3, s.star5 || 0, numStyle);
      setCell(r, C2 + 4, s.star4 || 0, numStyle);
      setCell(r, C2 + 5, s.star3 || 0, numStyle);
      setCell(r, C2 + 6, s.star2 || 0, numStyle);
      setCell(r, C2 + 7, s.star1 || 0, numStyle);
      setCell(r, C2 + 8, s.lowRatingCount, redStyle);
      setCell(r, C2 + 9, s.total > 0 ? Math.round(s.lowRatingCount / s.total * 100) + "%" : "0%", redStyle);
      setCell(r, C2 + 10, totalLow > 0 ? Math.round(s.lowRatingCount / totalLow * 100) + "%" : "0%", numStyle);
    });
    // 合計行
    const tRow = stats.length + 2;
    const t = stats.reduce((a, s) => ({ s5: a.s5 + s.star5, s4: a.s4 + s.star4, s3: a.s3 + s.star3, s2: a.s2 + s.star2, s1: a.s1 + s.star1, low: a.low + s.lowRatingCount }), { s5: 0, s4: 0, s3: 0, s2: 0, s1: 0, low: 0 });
    setCell(tRow, C2, "合計", totalRowStyle);
    setCell(tRow, C2 + 1, totalLang, totalRowStyle);
    setCell(tRow, C2 + 2, "100%", totalRowStyle);
    [t.s5, t.s4, t.s3, t.s2, t.s1].forEach((v, i) => setCell(tRow, C2 + 3 + i, v, totalRowStyle));
    setCell(tRow, C2 + 8, t.low, { ...totalRowStyle, font: { ...totalRowStyle.font, color: { rgb: "C0392B" } } });
    setCell(tRow, C2 + 9, totalLang > 0 ? Math.round(t.low / totalLang * 100) + "%" : "0%", totalRowStyle);
    setCell(tRow, C2 + 10, "100%", totalRowStyle);

    // ═══ セクション3: クレーム詳細 (列U-Z, col 20-25) ═══
    const C3 = 20;
    merges.push({ s: { r: 0, c: C3 }, e: { r: 0, c: C3 + 5 } });
    setCell(0, C3, "クレーム詳細(★1-2)", { ...titleStyle, font: { ...titleStyle.font, color: { rgb: "C0392B" } } });
    const hdr3 = ["推定国", "投稿日", "投稿者", "評価", "口コミ内容", "日本語訳"];
    hdr3.forEach((h, i) => setCell(1, C3 + i, h, hdrStyle));
    complaints.forEach((d, ri) => {
      const r = ri + 2;
      const comment = d.comment || "";
      const origMatch = comment.match(/\(Original\)\s*([\s\S]+)/i);
      const transMatch = comment.match(/\(Translated by Google\)\s*([\s\S]*?)(?:\(Original\)|$)/i);
      const original = origMatch ? origMatch[1].trim() : comment.replace(/\(Translated by Google\)/i, "").trim();
      const translation = transMatch ? transMatch[1].trim() : "";
      setCell(r, C3, d.country, cellStyle);
      setCell(r, C3 + 1, d.create_time?.slice(0, 10) || "", cellStyle);
      setCell(r, C3 + 2, d.reviewer_name || "", cellStyle);
      setCell(r, C3 + 3, d.star_rating, redStyle);
      setCell(r, C3 + 4, original.replace(/\n/g, " ").slice(0, 500), cellStyle);
      setCell(r, C3 + 5, translation.replace(/\n/g, " ").slice(0, 500), cellStyle);
    });

    // ── ワークシート設定 ──
    const maxRow = Math.max(sorted.length + 2, stats.length + 3, complaints.length + 2);
    ws["!ref"] = `A1:${ec(maxRow, 25)}`;
    ws["!merges"] = merges;
    ws["!cols"] = [
      { wch: 11 }, { wch: 16 }, { wch: 5 }, { wch: 50 }, { wch: 5 }, { wch: 10 }, { wch: 10 }, // A-G
      { wch: 2 }, // H(空)
      { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 5 }, { wch: 5 }, { wch: 5 }, { wch: 5 }, { wch: 5 }, { wch: 9 }, { wch: 8 }, { wch: 10 }, // I-S
      { wch: 2 }, // T(空)
      { wch: 10 }, { wch: 11 }, { wch: 16 }, { wch: 5 }, { wch: 50 }, { wch: 50 }, // U-Z
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "口コミ【国別】");
    const monthLabel = targetMonth ? targetMonth.replace("/", "-") : "全期間";
    XLSX.writeFile(wb, `口コミ国別分析_${monthLabel}.xlsx`);
  };

  const complaintDetails = details.filter(d => d.star_rating >= 1 && d.star_rating <= 2);
  const filteredDetails = detailLangFilter === "all" ? complaintDetails : complaintDetails.filter(d => d.lang === detailLangFilter);
  const accLabel = selectedAccount === "all" ? "全アカウント" : accounts.find(a => a.name === selectedAccount)?.label || "";

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">口コミ国別分析</h1>
          <p className="text-sm text-slate-500 mt-1">
            GBPアカウントごとに口コミの言語（国）別集計・低評価分析を行います
          </p>
        </div>
      </div>

      {/* アカウント選択 + 実行 */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 mb-6">
        <div className="flex items-center gap-4 flex-wrap">
          <label className="text-sm font-medium text-slate-700">GBPアカウント:</label>
          <select
            value={selectedAccount}
            onChange={(e) => setSelectedAccount(e.target.value)}
            disabled={loading || loadingAccounts}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#003D6B] min-w-[250px]"
          >
            <option value="all">全アカウント（{shops.length}店舗）</option>
            {accounts.map((acc) => (
              <option key={acc.name} value={acc.name}>
                {acc.label.replace(/\(.*?\)/, "").trim()}（{acc.shopNames.length}店舗）
              </option>
            ))}
          </select>
          <label className="text-sm font-medium text-slate-700">対象月:</label>
          <select
            value={targetMonth}
            onChange={(e) => setTargetMonth(e.target.value)}
            disabled={loading}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#003D6B]"
          >
            {monthOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button
            onClick={fetchStats}
            disabled={loading}
            className={`px-6 py-2 rounded-lg text-sm font-semibold transition-all ${
              loading ? "bg-slate-200 text-slate-400 cursor-not-allowed" : "bg-[#003D6B] text-white hover:bg-[#002a4a]"
            }`}
          >
            {loading ? "分析中..." : "分析実行"}
          </button>
          {stats.length > 0 && (
            <div className="flex gap-2 ml-auto">
              <button onClick={downloadExcel}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700">
                Excelダウンロード
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 店舗選択パネル */}
      {currentAccountShopOptions.length > 0 && (
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-slate-700">対象店舗（{selectedShops.size}/{currentAccountShopOptions.length}）</span>
              <button onClick={() => setSelectedShops(new Set(currentAccountShopOptions.map(s => s.id)))}
                className="text-xs text-blue-600 hover:underline">全選択</button>
              <button onClick={() => setSelectedShops(new Set())}
                className="text-xs text-slate-400 hover:underline">全解除</button>
            </div>
            <input
              type="text"
              placeholder="店舗名で検索..."
              value={shopSearch}
              onChange={(e) => setShopSearch(e.target.value)}
              className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs w-64 focus:outline-none focus:ring-1 focus:ring-[#003D6B]"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-0 max-h-48 overflow-y-auto border border-slate-100 rounded-lg">
            {currentAccountShopOptions
              .filter(s => !shopSearch || s.name.toLowerCase().includes(shopSearch.toLowerCase()))
              .map((s) => (
              <label key={s.id} className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-blue-50 border-b border-r border-slate-50 ${selectedShops.has(s.id) ? "bg-blue-50/50" : ""}`}>
                <input type="checkbox" checked={selectedShops.has(s.id)} onChange={() => toggleShop(s.id)} className="w-3.5 h-3.5 rounded" />
                <span className="truncate text-slate-700">{s.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* エラー表示 */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 mb-6">
          {error}
        </div>
      )}

      {/* サマリーカード */}
      {stats.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500">対象店舗</p>
            <p className="text-2xl font-bold text-slate-800">{shopCount}</p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500">口コミ総数（コメント付きのみ）</p>
            <p className="text-2xl font-bold text-slate-800">{totalReviews.toLocaleString()}</p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500">低評価（★1-3）</p>
            <p className="text-2xl font-bold text-red-600">{totalLowRating.toLocaleString()}</p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500">検出言語数</p>
            <p className="text-2xl font-bold text-blue-600">{stats.length}</p>
          </div>
        </div>
      )}

      {/* 言語別集計テーブル */}
      {stats.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 mb-6">
          <div className="p-4 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-700">{accLabel} — 言語別口コミ集計</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left py-2.5 px-4 text-xs font-semibold text-slate-500">言語</th>
                <th className="text-left py-2.5 px-3 text-xs font-semibold text-slate-500">推定国</th>
                <th className="text-right py-2.5 px-3 text-xs font-semibold text-slate-500">合計</th>
                <th className="text-right py-2.5 px-3 text-xs font-semibold text-slate-500">★1</th>
                <th className="text-right py-2.5 px-3 text-xs font-semibold text-slate-500">★2</th>
                <th className="text-right py-2.5 px-3 text-xs font-semibold text-slate-500">★3</th>
                <th className="text-right py-2.5 px-3 text-xs font-semibold text-slate-500">★4</th>
                <th className="text-right py-2.5 px-3 text-xs font-semibold text-slate-500">★5</th>
                <th className="text-right py-2.5 px-3 text-xs font-semibold text-red-500">低評価</th>
                <th className="text-right py-2.5 px-3 text-xs font-semibold text-red-500">低評価率</th>
                <th className="text-right py-2.5 px-3 text-xs font-semibold text-slate-500">構成比</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => (
                <tr key={s.lang} className="border-b border-slate-50 hover:bg-blue-50/30">
                  <td className="py-2 px-4 font-medium text-slate-800">{s.lang}</td>
                  <td className="py-2 px-3 text-slate-500">{s.country}</td>
                  <td className="py-2 px-3 text-right font-semibold">{s.total.toLocaleString()}</td>
                  <td className="py-2 px-3 text-right text-red-700">{s.star1 || "-"}</td>
                  <td className="py-2 px-3 text-right text-red-500">{s.star2 || "-"}</td>
                  <td className="py-2 px-3 text-right text-orange-500">{s.star3 || "-"}</td>
                  <td className="py-2 px-3 text-right text-slate-500">{s.star4 || "-"}</td>
                  <td className="py-2 px-3 text-right text-emerald-600">{s.star5 || "-"}</td>
                  <td className="py-2 px-3 text-right font-semibold text-red-600">{s.lowRatingCount || "-"}</td>
                  <td className="py-2 px-3 text-right text-red-500">{s.total > 0 ? (s.lowRatingCount / s.total * 100).toFixed(1) + "%" : "-"}</td>
                  <td className="py-2 px-3 text-right text-slate-400">{totalReviews > 0 ? (s.total / totalReviews * 100).toFixed(1) + "%" : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 店舗別 言語内訳 */}
      {stats.length > 0 && details.length > 0 && (() => {
        // 店舗ごとの言語集計を計算
        const shopLangMap = new Map<string, { total: number; langs: Map<string, number>; lowRating: number }>();
        for (const d of details) {
          if (!shopLangMap.has(d.shop_name)) shopLangMap.set(d.shop_name, { total: 0, langs: new Map(), lowRating: 0 });
          const entry = shopLangMap.get(d.shop_name)!;
          entry.total++;
          entry.langs.set(d.lang, (entry.langs.get(d.lang) || 0) + 1);
          if (d.star_rating >= 1 && d.star_rating <= 3) entry.lowRating++;
        }
        // 検出された主要言語（日本語以外）の列を動的に決定
        const allLangs = Array.from(new Set(details.map(d => d.lang))).filter(l => l !== "不明");
        const jpLang = "日本語";
        const foreignLangs = allLangs.filter(l => l !== jpLang);
        // インバウンド比率でソート
        const shopRows = Array.from(shopLangMap.entries()).map(([name, data]) => {
          const jpCount = data.langs.get(jpLang) || 0;
          const foreignCount = data.total - jpCount - (data.langs.get("不明") || 0);
          const foreignPct = data.total > 0 ? foreignCount / data.total * 100 : 0;
          return { name, total: data.total, jpCount, foreignCount, foreignPct, lowRating: data.lowRating, langs: data.langs };
        }).sort((a, b) => b.foreignPct - a.foreignPct || b.total - a.total);

        return (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 mb-6">
          <div className="p-4 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-700">店舗別 言語内訳（インバウンド比率順）</h3>
          </div>
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0">
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left py-2.5 px-3 text-xs font-semibold text-slate-500 sticky left-0 bg-slate-50">店舗名</th>
                  <th className="text-right py-2.5 px-2 text-xs font-semibold text-slate-500">合計</th>
                  <th className="text-right py-2.5 px-2 text-xs font-semibold text-slate-500">日本語</th>
                  {foreignLangs.map(l => (
                    <th key={l} className="text-right py-2.5 px-2 text-xs font-semibold text-blue-600">{l}</th>
                  ))}
                  <th className="text-right py-2.5 px-2 text-xs font-semibold text-blue-700">インバウンド比率</th>
                  <th className="text-right py-2.5 px-2 text-xs font-semibold text-red-500">低評価</th>
                </tr>
              </thead>
              <tbody>
                {shopRows.map((row) => (
                  <tr key={row.name} className="border-b border-slate-50 hover:bg-blue-50/30">
                    <td className="py-1.5 px-3 text-xs text-slate-700 whitespace-nowrap sticky left-0 bg-white">{row.name}</td>
                    <td className="py-1.5 px-2 text-right text-xs font-semibold">{row.total}</td>
                    <td className="py-1.5 px-2 text-right text-xs">{row.jpCount || "-"}</td>
                    {foreignLangs.map(l => {
                      const c = row.langs.get(l) || 0;
                      return <td key={l} className={`py-1.5 px-2 text-right text-xs ${c > 0 ? "text-blue-700 font-semibold" : "text-slate-300"}`}>{c || "-"}</td>;
                    })}
                    <td className={`py-1.5 px-2 text-right text-xs font-bold ${row.foreignPct > 20 ? "text-blue-700" : row.foreignPct > 5 ? "text-blue-500" : "text-slate-400"}`}>
                      {row.foreignPct > 0 ? row.foreignPct.toFixed(1) + "%" : "-"}
                    </td>
                    <td className={`py-1.5 px-2 text-right text-xs ${row.lowRating > 0 ? "text-red-600 font-semibold" : "text-slate-300"}`}>{row.lowRating || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        );
      })()}

      {/* 低評価口コミ詳細 */}
      {details.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-semibold text-red-700">クレーム詳細（★1-2）— {filteredDetails.length}件</h3>
              <button onClick={() => setShowDetails(!showDetails)}
                className="text-xs text-slate-400 hover:text-slate-600">
                {showDetails ? "閉じる" : "表示"}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <select value={detailLangFilter} onChange={(e) => setDetailLangFilter(e.target.value)}
                className="px-2 py-1 border border-slate-200 rounded text-xs">
                <option value="all">全言語</option>
                {Array.from(new Set(complaintDetails.map(d => d.lang))).map(lang => {
                  const cnt = complaintDetails.filter(d => d.lang === lang).length;
                  return (<option key={lang} value={lang}>{lang}（{cnt}件）</option>);
                })}
              </select>
            </div>
          </div>
          {showDetails && (
            <div className="max-h-[600px] overflow-y-auto">
              {filteredDetails.map((d, i) => (
                <div key={i} className="border-b border-slate-50 p-3 hover:bg-red-50/30">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                      d.star_rating <= 2 ? "bg-red-100 text-red-700" : "bg-orange-100 text-orange-700"
                    }`}>★{d.star_rating}</span>
                    <span className="text-xs text-slate-500">{d.lang}</span>
                    <span className="text-xs text-slate-400">|</span>
                    <span className="text-xs text-slate-600 font-medium">{d.shop_name}</span>
                    <span className="text-xs text-slate-400 ml-auto">{d.create_time?.slice(0, 10)}</span>
                    <span className="text-[10px] text-slate-400">{d.reviewer_name}</span>
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed">{d.comment.slice(0, 300)}{d.comment.length > 300 ? "..." : ""}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 空状態 */}
      {!loading && stats.length === 0 && (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">アカウントを選択して「分析実行」を押してください</p>
          <p className="text-slate-300 text-xs mt-1">口コミデータから言語を自動判定し、国別の集計を行います</p>
        </div>
      )}
    </div>
  );
}
