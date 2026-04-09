"use client";

import { useState, useCallback } from "react";
import { useShop } from "@/components/shop-provider";
import api from "@/lib/api";

interface AnalysisResult {
  shopId: string;
  shopName: string;
  status: string;
}

export default function ReviewAnalysisPage() {
  const { shops, apiConnected } = useShop();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [results, setResults] = useState<AnalysisResult[]>([]);
  const [forceReanalyze, setForceReanalyze] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === shops.length) setSelected(new Set());
    else setSelected(new Set(shops.map((s) => s.id)));
  };

  const runAnalysis = useCallback(async () => {
    if (selected.size === 0) return;
    setRunning(true);
    setError(null);
    setResults([]);

    const selectedShops = shops
      .filter((s) => selected.has(s.id))
      .map((s) => ({ id: s.id, name: s.name }));

    setProgress({ current: 0, total: selectedShops.length });

    // 1店舗ずつ処理（確実に進行）
    const allResults: AnalysisResult[] = [];

    for (let i = 0; i < selectedShops.length; i++) {
      const shop = selectedShops[i];
      setProgress({ current: i, total: selectedShops.length });
      try {
        const res = await api.post("/api/report/analyze", { shops: [shop], force: forceReanalyze }, { timeout: 60000 });
        const data = res.data;
        allResults.push(...(data.results || []));
        setResults([...allResults]);
      } catch (err: any) {
        allResults.push({ shopId: shop.id, shopName: shop.name, status: "error" });
        setResults([...allResults]);
        // 続行
      }
    }

    setRunning(false);
    setProgress(null);
  }, [selected, shops]);

  const successCount = results.filter((r) => r.status === "success").length;

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">口コミ分析</h1>
          <p className="text-sm text-slate-500 mt-1">
            GBPの口コミをAIで分析し、レポートのP10・P11を自動生成します
          </p>
        </div>
      </div>

      {!apiConnected && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
          Go APIに未接続です。口コミ分析にはGo APIとの接続が必要です。
        </div>
      )}

      {/* 操作バー */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 mb-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={selectAll}
              className="text-sm text-[#003D6B] hover:underline font-medium"
            >
              {selected.size === shops.length ? "全解除" : "全選択"}
            </button>
            <span className="text-sm text-slate-500">
              {selected.size > 0 ? (
                <span className="text-emerald-600 font-semibold">{selected.size}店舗選択中</span>
              ) : (
                `${shops.length}店舗`
              )}
            </span>
          </div>
          <button
            onClick={runAnalysis}
            disabled={running || selected.size === 0 || !apiConnected}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold transition-all ${
              running || selected.size === 0 || !apiConnected
                ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                : "bg-[#003D6B] text-white hover:bg-[#002a4a] shadow-sm"
            }`}
          >
            {running ? (
              <>
                <span className="inline-block w-4 h-4 border-2 border-slate-300 border-t-white rounded-full animate-spin" />
                分析中... ({progress?.current || 0}/{progress?.total || 0})
              </>
            ) : (
              <>🔍 口コミ分析を実行</>
            )}
          </button>
        </div>
        <label className="flex items-center gap-2 mt-2 ml-auto cursor-pointer">
          <input type="checkbox" checked={forceReanalyze} onChange={(e) => setForceReanalyze(e.target.checked)} className="w-3.5 h-3.5 rounded" />
          <span className="text-xs text-slate-500">分析済みも再分析する</span>
        </label>
      </div>

      {/* 進捗・結果 */}
      {(results.length > 0 || error) && (
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 mb-6">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">分析結果</h3>
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 mb-3">
              {error}
            </div>
          )}
          {successCount > 0 && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-700 mb-3">
              {successCount}店舗の口コミ分析が完了しました。レポートページに反映済みです。
            </div>
          )}
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {results.map((r, i) => (
              <div key={i} className="flex items-center justify-between py-1.5 px-2 text-sm">
                <span className="text-slate-600 truncate">{r.shopName}</span>
                <span
                  className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    r.status === "success" ? "bg-emerald-100 text-emerald-700"
                      : r.status === "already_done" ? "bg-blue-100 text-blue-600"
                      : r.status === "no_reviews" ? "bg-slate-100 text-slate-500"
                      : "bg-red-100 text-red-700"
                  }`}
                >
                  {r.status === "success" ? "完了" : r.status === "already_done" ? "分析済み" : r.status === "no_reviews" ? "口コミなし" : "失敗"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 店舗一覧 */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-0">
          {shops.map((shop) => (
            <label
              key={shop.id}
              className={`flex items-center gap-3 p-4 border-b border-r border-slate-50 cursor-pointer hover:bg-slate-50 transition-colors ${
                selected.has(shop.id) ? "bg-blue-50" : ""
              }`}
            >
              <input
                type="checkbox"
                checked={selected.has(shop.id)}
                onChange={() => toggleSelect(shop.id)}
                className="w-4 h-4 rounded border-slate-300 text-[#003D6B]"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800 truncate">{shop.name}</p>
              </div>
            </label>
          ))}
        </div>
        {shops.length === 0 && (
          <div className="p-12 text-center text-slate-400 text-sm">
            Go APIから店舗を取得できません。接続を確認してください。
          </div>
        )}
      </div>
    </div>
  );
}
