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
  const { shops } = useShop();
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
        body: JSON.stringify({ shopIds: targetShopIds }),
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
          const debugInfo = (data._debug || []).join(" | ");
          setError(`${targetShopIds.length}店舗を検索しましたが、口コミが0件でした。\n[debug] ${debugInfo}`);
        }
      } else {
        const err = await res.json().catch(() => ({ error: "不明なエラー" }));
        setError(`APIエラー: ${err?.error || res.status}`);
      }
    } catch (e: any) {
      setError(`通信エラー: ${e?.message || "タイムアウト"}`);
    }
    setLoading(false);
  }, [selectedShops, shops]);

  async function getAuthHeaders(): Promise<Record<string, string>> {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  // CSVダウンロード
  const downloadCSV = (type: "summary" | "details") => {
    let csv = "\uFEFF"; // BOM for Excel

    if (type === "summary") {
      csv += "言語,推定国,合計,★1,★2,★3,★4,★5,低評価(★1-3),低評価比率\n";
      for (const s of stats) {
        const pct = s.total > 0 ? (s.lowRatingCount / s.total * 100).toFixed(1) + "%" : "0%";
        csv += `${s.lang},${s.country},${s.total},${s.star1},${s.star2},${s.star3},${s.star4},${s.star5},${s.lowRatingCount},${pct}\n`;
      }
    } else {
      csv += "店舗名,投稿者,評価,言語,推定国,投稿日,コメント\n";
      const filtered = detailLangFilter === "all" ? details : details.filter(d => d.lang === detailLangFilter);
      for (const d of filtered) {
        const comment = d.comment.replace(/"/g, '""').replace(/\n/g, " ");
        csv += `"${d.shop_name}","${d.reviewer_name}",${d.star_rating},"${d.lang}","${d.country}","${d.create_time?.slice(0, 10) || ""}","${comment}"\n`;
      }
    }

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = type === "summary" ? "口コミ言語別集計.csv" : "低評価口コミ詳細.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredDetails = detailLangFilter === "all" ? details : details.filter(d => d.lang === detailLangFilter);
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
              <button onClick={() => downloadCSV("summary")}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700">
                集計CSV
              </button>
              <button onClick={() => downloadCSV("details")}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-orange-600 text-white hover:bg-orange-700">
                低評価CSV
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

      {/* 低評価口コミ詳細 */}
      {details.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-semibold text-red-700">低評価口コミ詳細（★1-3）— {filteredDetails.length}件</h3>
              <button onClick={() => setShowDetails(!showDetails)}
                className="text-xs text-slate-400 hover:text-slate-600">
                {showDetails ? "閉じる" : "表示"}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <select value={detailLangFilter} onChange={(e) => setDetailLangFilter(e.target.value)}
                className="px-2 py-1 border border-slate-200 rounded text-xs">
                <option value="all">全言語</option>
                {stats.filter(s => s.lowRatingCount > 0).map(s => (
                  <option key={s.lang} value={s.lang}>{s.lang}（{s.lowRatingCount}件）</option>
                ))}
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
