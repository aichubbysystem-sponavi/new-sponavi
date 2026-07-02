"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useShop } from "@/components/shop-provider";
import { supabase } from "@/lib/supabase";
import api from "@/lib/api";

interface AnalysisResult {
  shopId: string;
  shopName: string;
  status: string;
  reason?: string;
}

interface PersistedFailure {
  shopId: string;
  shopName: string;
  status: string;
  reason?: string;
  failedAt: string;
}

function loadPersistedFailures(): PersistedFailure[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem("analysis-failed-shops") || "[]"); } catch { return []; }
}

function savePersistedFailures(failures: PersistedFailure[]) {
  localStorage.setItem("analysis-failed-shops", JSON.stringify(failures));
}

function safeStr(val: unknown): string {
  if (val == null) return "";
  if (typeof val === "string") return val;
  if (typeof val === "object" && val !== null && "message" in val) return String((val as any).message);
  return JSON.stringify(val);
}

export default function ReviewAnalysisPage() {
  const { shops, apiConnected, favoriteShopIds, addToFavorites, removeFromFavorites } = useShop();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [results, setResults] = useState<AnalysisResult[]>([]);
  const [forceReanalyze, setForceReanalyze] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [persistedFailures, setPersistedFailures] = useState<PersistedFailure[]>(loadPersistedFailures);
  const cancelRef = useRef(false);

  // 対象月セレクタ: 直近6ヶ月の選択肢を生成
  const monthOptions = (() => {
    const opts: { value: string; label: string }[] = [];
    const now = new Date();
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const val = `${d.getFullYear()}/${d.getMonth() + 1}`;
      opts.push({ value: val, label: val });
    }
    return opts;
  })();
  const [targetMonth, setTargetMonth] = useState(monthOptions[0]?.value || "");

  // 対象月の分析済み店舗名を取得
  const [analyzedShopNames, setAnalyzedShopNames] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!targetMonth) return;
    (async () => {
      const { data } = await supabase
        .from("report_analysis")
        .select("shop_name")
        .eq("target_month", targetMonth);
      setAnalyzedShopNames(new Set((data || []).map((r: any) => r.shop_name)));
    })();
  }, [targetMonth, results]);

  const BATCH_SIZE = 15;

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
    cancelRef.current = false;
    setRunning(true);
    setError(null);
    setResults([]);

    const selectedShops = shops
      .filter((s) => selected.has(s.id))
      .map((s) => ({ id: s.id, name: s.name }));

    setProgress({ current: 0, total: selectedShops.length });

    // バッチ処理（BATCH_SIZE店舗ごとに冷却期間）
    const allResults: AnalysisResult[] = [];

    for (let i = 0; i < selectedShops.length; i++) {
      if (cancelRef.current) {
        setError(`中断しました (${i}/${selectedShops.length})`);
        break;
      }
      const shop = selectedShops[i];
      setProgress({ current: i, total: selectedShops.length });
      window.dispatchEvent(new Event("batch-activity"));
      try {
        // 280秒タイムアウト（大量口コミ店舗対応）
        const res = await Promise.race([
          api.post("/api/report/analyze", { shops: [shop], force: forceReanalyze, targetMonth }, { timeout: 280000 }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("タイムアウト（280秒）")), 285000)),
        ]);
        const data = res.data;
        allResults.push(...(data.results || []));
        setResults([...allResults]);
      } catch (err: any) {
        const rawReason = err?.response?.data?.error || err?.message || "通信エラー";
        const reason = typeof rawReason === "object" ? (rawReason?.message || JSON.stringify(rawReason)) : String(rawReason);
        allResults.push({ shopId: shop.id, shopName: shop.name, status: "error", reason });
        setResults([...allResults]);
        // 429の場合は30秒待機してから続行
        if (err?.response?.status === 429) {
          setError(`レート制限中...30秒後に再開 (${i + 1}/${selectedShops.length})`);
          await new Promise(r => setTimeout(r, 30000));
          setError(null);
        }
      }
      // レート制限回避: 店舗間3秒 + バッチ区切りで60秒冷却
      if (i < selectedShops.length - 1) {
        const isEndOfBatch = (i + 1) % BATCH_SIZE === 0;
        if (isEndOfBatch) {
          setError(`バッチ${Math.floor((i + 1) / BATCH_SIZE)}完了（${i + 1}/${selectedShops.length}）— 60秒冷却中...`);
          await new Promise(r => setTimeout(r, 60000));
          setError(null);
        } else {
          await new Promise(r => setTimeout(r, 3000));
        }
      }
    }

    // 失敗店舗をlocalStorageに永続化（日付付き）
    const failed = allResults.filter(r => r.status === "error" || r.status === "analysis_failed" || r.status === "db_error");
    if (failed.length > 0) {
      const now = new Date().toLocaleString("ja-JP");
      const newFailures = failed.map(f => ({ shopId: f.shopId, shopName: f.shopName, status: f.status, reason: f.reason, failedAt: now }));
      // 既存の失敗リストから今回成功した店舗を除去し、新しい失敗を追加
      const successIds = new Set(allResults.filter(r => r.status === "success").map(r => r.shopId));
      const updated = [
        ...persistedFailures.filter(p => !successIds.has(p.shopId) && !failed.some(f => f.shopId === p.shopId)),
        ...newFailures,
      ];
      setPersistedFailures(updated);
      savePersistedFailures(updated);
    } else if (allResults.some(r => r.status === "success")) {
      // 全成功の場合、成功した分を失敗リストから除去
      const successIds = new Set(allResults.filter(r => r.status === "success").map(r => r.shopId));
      const updated = persistedFailures.filter(p => !successIds.has(p.shopId));
      setPersistedFailures(updated);
      savePersistedFailures(updated);
    }

    setRunning(false);
    setProgress(null);
  }, [selected, shops, forceReanalyze, persistedFailures, targetMonth]);

  const successCount = results.filter((r) => r.status === "success").length;
  const failedResults = results.filter((r) => r.status === "error" || r.status === "analysis_failed" || r.status === "db_error");

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">口コミ分析</h1>
          <p className="text-sm text-slate-500 mt-1">
            GBPの口コミをAIで分析し、レポートの口コミ分析・AIコメントを自動生成します
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
            {favoriteShopIds.size > 0 && (
              <button
                onClick={() => setSelected(new Set(Array.from(favoriteShopIds).filter(id => shops.some(s => s.id === id))))}
                className="px-3 py-1.5 rounded-lg text-sm font-semibold border text-emerald-700 bg-emerald-50 border-emerald-300 hover:bg-emerald-100 cursor-pointer transition"
              >
                いつもの店舗 ({favoriteShopIds.size})
              </button>
            )}
            {(() => {
              const unanalyzed = shops.filter(s => !analyzedShopNames.has(s.name));
              return unanalyzed.length > 0 ? (
                <button
                  onClick={() => setSelected(new Set(unanalyzed.map(s => s.id)))}
                  className="px-3 py-1.5 rounded-lg text-sm font-semibold border text-orange-700 bg-orange-50 border-orange-300 hover:bg-orange-100 cursor-pointer transition"
                >
                  未分析のみ ({unanalyzed.length})
                </button>
              ) : null;
            })()}
            {selected.size > 0 && (() => {
              const selectedArr = Array.from(selected);
              const notInFav = selectedArr.filter(id => !favoriteShopIds.has(id));
              const inFav = selectedArr.filter(id => favoriteShopIds.has(id));
              return (
                <>
                  {notInFav.length > 0 && (
                    <button
                      onClick={() => addToFavorites(notInFav)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold border text-blue-700 bg-blue-50 border-blue-300 hover:bg-blue-100 cursor-pointer transition"
                    >
                      + いつもの店舗に追加 ({notInFav.length})
                    </button>
                  )}
                  {inFav.length > 0 && inFav.length === selectedArr.length && (
                    <button
                      onClick={() => removeFromFavorites(inFav)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold border text-red-600 bg-red-50 border-red-200 hover:bg-red-100 cursor-pointer transition"
                    >
                      - いつもの店舗から削除 ({inFav.length})
                    </button>
                  )}
                </>
              );
            })()}
            <span className="text-sm text-slate-500">
              {selected.size > 0 ? (
                <span className="text-emerald-600 font-semibold">{selected.size}店舗選択中</span>
              ) : (
                `${shops.length}店舗`
              )}
            </span>
            <span className="text-slate-300">|</span>
            <label className="flex items-center gap-1.5 text-sm text-slate-600">
              <span className="font-medium">対象月:</span>
              <select
                value={targetMonth}
                onChange={(e) => setTargetMonth(e.target.value)}
                disabled={running}
                className="border border-slate-200 rounded-md px-2 py-1 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#003D6B]"
              >
                {monthOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
          </div>
          <button
            data-run-analysis
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
              <>口コミ分析を実行</>
            )}
          </button>
          {running && (
            <button
              onClick={() => { cancelRef.current = true; }}
              className="px-4 py-2.5 rounded-lg text-sm font-semibold bg-red-500 text-white hover:bg-red-600 transition"
            >
              中断
            </button>
          )}
        </div>
        <label className="flex items-center gap-2 mt-2 ml-auto cursor-pointer">
          <input type="checkbox" checked={forceReanalyze} onChange={(e) => setForceReanalyze(e.target.checked)} className="w-3.5 h-3.5 rounded" />
          <span className="text-xs text-slate-500">分析済みも再分析する</span>
        </label>
      </div>

      {/* 永続化された失敗店舗リスト（リロードしても表示） */}
      {persistedFailures.length > 0 && failedResults.length === 0 && (
        <div className="bg-orange-50 rounded-xl p-4 shadow-sm border border-orange-200 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-orange-700">前回の分析失敗店舗（{persistedFailures.length}件）</h3>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  const failedIds = new Set(persistedFailures.map(p => p.shopId));
                  setSelected(failedIds);
                  setTimeout(() => {
                    const btn = document.querySelector("[data-run-analysis]") as HTMLButtonElement;
                    if (btn && !btn.disabled) btn.click();
                  }, 100);
                }}
                className="text-xs px-3 py-1 bg-orange-600 text-white rounded-lg hover:bg-orange-700 cursor-pointer"
              >
                失敗店舗だけ再実行
              </button>
              <button
                onClick={() => { setPersistedFailures([]); savePersistedFailures([]); }}
                className="text-xs px-3 py-1 bg-slate-200 text-slate-600 rounded-lg hover:bg-slate-300 cursor-pointer"
              >
                クリア
              </button>
            </div>
          </div>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {persistedFailures.map((p, i) => (
              <div key={i} className="flex items-center justify-between py-1 px-2 text-sm bg-white rounded gap-2">
                <span className="text-slate-700 truncate flex-1">{p.shopName}</span>
                {p.reason && <span className="text-[10px] text-red-400 truncate max-w-[250px]">{safeStr(p.reason)}</span>}
                <span className="text-[10px] text-orange-500 flex-shrink-0">{p.failedAt}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 今回の失敗店舗サマリー */}
      {failedResults.length > 0 && (
        <div className="bg-red-50 rounded-xl p-4 shadow-sm border border-red-200 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-red-700">失敗店舗（{failedResults.length}件）</h3>
            <button
              onClick={() => {
                const failedIds = new Set(failedResults.map(r => r.shopId));
                setSelected(failedIds);
                // 選択後に自動で分析実行
                setTimeout(() => {
                  const btn = document.querySelector("[data-run-analysis]") as HTMLButtonElement;
                  if (btn && !btn.disabled) btn.click();
                }, 100);
              }}
              className="text-xs px-3 py-1 bg-red-600 text-white rounded-lg hover:bg-red-700 cursor-pointer"
            >
              失敗店舗だけ再実行
            </button>
          </div>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {failedResults.map((r, i) => (
              <div key={i} className="flex items-center justify-between py-1 px-2 text-sm bg-white rounded">
                <span className="text-slate-700">{r.shopName}</span>
                <span className="text-xs text-red-500 font-medium">{r.status === "analysis_failed" ? "分析失敗" : r.status === "db_error" ? "DB保存エラー" : "エラー"}</span>
              </div>
            ))}
          </div>
        </div>
      )}

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
                {r.reason && <span className="text-[10px] text-red-400 truncate max-w-[300px]">{safeStr(r.reason)}</span>}
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
              <div className="min-w-0 flex-1 flex items-center gap-2">
                <p className="text-sm font-medium text-slate-800 truncate">{shop.name}</p>
                {analyzedShopNames.has(shop.name) ? (
                  <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-600 font-medium">済</span>
                ) : (
                  <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-400 font-medium">未</span>
                )}
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
