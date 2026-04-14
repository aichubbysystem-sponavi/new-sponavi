"use client";

import { useState, useEffect, useCallback } from "react";
import { useShop } from "@/components/shop-provider";
import { supabase } from "@/lib/supabase";
import api from "@/lib/api";

interface NAPResult {
  shop_id: string;
  shop_name: string;
  db_name: string;
  db_address: string;
  db_phone: string;
  gbp_name: string;
  gbp_address: string;
  gbp_phone: string;
  name_match: boolean;
  address_match: boolean;
  phone_match: boolean;
  status: string;
  detail: string;
  checked_at: string;
}

type FilterType = "all" | "ng" | "name" | "address" | "phone";

export default function CitationPage() {
  const { apiConnected, shops } = useShop();
  const [results, setResults] = useState<NAPResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [searchText, setSearchText] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // 保存済みNAPチェック結果を読み込み
  const fetchResults = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/api/report/nap-check");
      setResults(Array.isArray(res.data) ? res.data : []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchResults(); }, [fetchResults]);

  // NAP一括チェック実行（10店舗ずつバッチ分割）
  const handleCheck = async () => {
    setChecking(true);
    setError("");
    // 全店舗IDを取得
    const { data: allShops } = await supabase.from("shops").select("id").not("gbp_location_name", "is", null);
    const allIds = (allShops || []).map((s: any) => s.id);
    if (allIds.length === 0) { setError("GBP接続済みの店舗がありません"); setChecking(false); return; }

    let totalOk = 0, totalNg = 0, totalErrors = 0;
    const batchSize = 10;
    for (let i = 0; i < allIds.length; i += batchSize) {
      const batch = allIds.slice(i, i + batchSize);
      setProgress(`NAP整合性チェック中... ${i}/${allIds.length}店舗完了`);
      try {
        const res = await api.post("/api/report/nap-check", { shopIds: batch }, { timeout: 55000 });
        totalOk += res.data.ok || 0;
        totalNg += res.data.ng || 0;
        totalErrors += res.data.errors || 0;
      } catch { totalErrors += batch.length; }
    }
    setProgress(`完了: ${allIds.length}店舗チェック（OK: ${totalOk} / NG: ${totalNg} / エラー: ${totalErrors}）`);
    await fetchResults();
    setChecking(false);
  };

  // フィルタリング
  const filtered = results.filter((r) => {
    if (filterType === "ng" && r.status === "OK") return false;
    if (filterType === "name" && r.name_match) return false;
    if (filterType === "address" && r.address_match) return false;
    if (filterType === "phone" && r.phone_match) return false;
    if (searchText) {
      return r.shop_name.toLowerCase().includes(searchText.toLowerCase());
    }
    return true;
  });

  // 統計
  const totalOK = results.filter((r) => r.status === "OK").length;
  const totalNG = results.filter((r) => r.status !== "OK" && r.status !== "エラー" && r.status !== "GBP取得エラー").length;
  const nameNG = results.filter((r) => !r.name_match && r.gbp_name).length;
  const addrNG = results.filter((r) => !r.address_match && r.gbp_address).length;
  const phoneNG = results.filter((r) => !r.phone_match && r.db_phone && r.gbp_phone).length;
  const lastChecked = results.length > 0 ? results[0].checked_at : null;

  return (
    <div className="animate-fade-in">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-slate-800">NAP整合性チェック</h1>
        <p className="text-sm text-slate-500 mt-1">管理DB vs GBP — 店舗名・住所・電話番号の一括照合</p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-700">{error}</div>}
      {progress && !error && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 mb-4 text-sm text-emerald-700">{progress}</div>
      )}

      {!apiConnected ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">Go APIに接続し、店舗を登録すると利用できます</p>
        </div>
      ) : (
        <>
          {/* KPI */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
              <p className="text-[11px] font-medium text-slate-400 mb-1">チェック済み</p>
              <p className="text-2xl font-bold text-[#003D6B]">{results.length}<span className="text-xs font-normal text-slate-400 ml-1">店舗</span></p>
            </div>
            <div className="bg-emerald-50 rounded-xl p-4 shadow-sm border border-emerald-100">
              <p className="text-[11px] font-medium text-emerald-500 mb-1">OK</p>
              <p className="text-2xl font-bold text-emerald-600">{totalOK}</p>
            </div>
            <div className="bg-red-50 rounded-xl p-4 shadow-sm border border-red-100">
              <p className="text-[11px] font-medium text-red-500 mb-1">NG</p>
              <p className="text-2xl font-bold text-red-600">{totalNG}</p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
              <p className="text-[11px] font-medium text-slate-400 mb-1">店名NG / 住所NG</p>
              <p className="text-lg font-bold text-slate-700">{nameNG} / {addrNG}</p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
              <p className="text-[11px] font-medium text-slate-400 mb-1">電話NG</p>
              <p className="text-2xl font-bold text-purple-600">{phoneNG}</p>
            </div>
          </div>

          {/* アクションバー */}
          <div className="flex items-center justify-between mb-5">
            <div className="text-xs text-slate-400">
              {lastChecked && `最終チェック: ${new Date(lastChecked).toLocaleString("ja-JP")}`}
            </div>
            <button onClick={handleCheck} disabled={checking}
              className={`px-5 py-2.5 rounded-lg text-sm font-semibold ${checking ? "bg-slate-200 text-slate-400" : "bg-[#003D6B] hover:bg-[#002a4a]"}`}
              style={{ color: checking ? undefined : "#fff" }}>
              {checking ? "チェック中..." : "NAP一括チェック実行"}
            </button>
          </div>

          {/* フィルタ */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-3 mb-4">
            <div className="flex flex-wrap items-center gap-2">
              <input type="text" placeholder="店舗名で検索..." value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                className="flex-1 min-w-[180px] pl-3 pr-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#003D6B]/20" />
              <div className="flex border border-slate-200 rounded-lg overflow-hidden">
                {([["all", "すべて"], ["ng", "NGのみ"], ["name", "店名NG"], ["address", "住所NG"], ["phone", "電話NG"]] as [FilterType, string][]).map(([key, label]) => (
                  <button key={key} onClick={() => setFilterType(key)}
                    className={`px-3 py-1.5 text-xs font-semibold transition ${filterType === key ? "bg-[#003D6B] text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}>
                    {label}
                  </button>
                ))}
              </div>
              <span className="text-xs text-slate-400">{filtered.length}件</span>
            </div>
          </div>

          {/* 結果テーブル */}
          {loading ? (
            <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
              <p className="text-slate-400 text-sm">読み込み中...</p>
            </div>
          ) : results.length === 0 ? (
            <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
              <p className="text-slate-400 text-sm mb-2">NAPチェック結果がありません</p>
              <p className="text-slate-300 text-xs">「NAP一括チェック」ボタンでGBP接続済み店舗のNAP整合性を一括チェックします</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    <th className="text-left p-3 text-slate-500 font-medium">店舗名</th>
                    <th className="text-center p-3 text-slate-500 font-medium w-16">店名</th>
                    <th className="text-center p-3 text-slate-500 font-medium w-16">住所</th>
                    <th className="text-center p-3 text-slate-500 font-medium w-16">電話</th>
                    <th className="text-center p-3 text-slate-500 font-medium">ステータス</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.shop_id}
                      className={`border-b border-slate-50 hover:bg-slate-50 cursor-pointer ${r.status !== "OK" ? "bg-red-50/30" : ""}`}
                      onClick={() => setExpandedId(expandedId === r.shop_id ? null : r.shop_id)}>
                      <td className="p-3 font-medium text-slate-800">{r.shop_name}</td>
                      <td className="p-3 text-center">
                        <span className={`text-sm ${r.name_match || !r.gbp_name ? "text-emerald-500" : "text-red-500"}`}>
                          {r.gbp_name ? (r.name_match ? "✓" : "✕") : "—"}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        <span className={`text-sm ${r.address_match || !r.gbp_address ? "text-emerald-500" : "text-red-500"}`}>
                          {r.gbp_address ? (r.address_match ? "✓" : "✕") : "—"}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        <span className={`text-sm ${r.phone_match || !r.db_phone || !r.gbp_phone ? "text-emerald-500" : "text-red-500"}`}>
                          {r.db_phone && r.gbp_phone ? (r.phone_match ? "✓" : "✕") : "—"}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          r.status === "OK" ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"
                        }`}>{r.status}</span>
                      </td>
                      <td className="p-3 text-slate-300 text-center">{expandedId === r.shop_id ? "▲" : "▼"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* 展開詳細 */}
              {expandedId && (() => {
                const r = filtered.find((x) => x.shop_id === expandedId);
                if (!r) return null;
                return (
                  <div className="p-4 bg-slate-50 border-t border-slate-200">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {[
                        { label: "店舗名", db: r.db_name, gbp: r.gbp_name, match: r.name_match },
                        { label: "住所", db: r.db_address, gbp: r.gbp_address, match: r.address_match },
                        { label: "電話番号", db: r.db_phone, gbp: r.gbp_phone, match: r.phone_match },
                      ].map((item) => (
                        <div key={item.label} className={`rounded-lg p-3 ${item.match ? "bg-emerald-50 border border-emerald-100" : "bg-red-50 border border-red-100"}`}>
                          <p className="text-[10px] font-semibold text-slate-500 mb-1">{item.label}</p>
                          <p className="text-xs text-slate-600 mb-0.5">DB: {item.db || <span className="text-slate-300">未設定</span>}</p>
                          <p className="text-xs text-slate-600">GBP: {item.gbp || <span className="text-slate-300">未設定</span>}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </>
      )}
    </div>
  );
}
