"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useShop } from "@/components/shop-provider";
import { useRole } from "@/components/role-provider";
import { supabase } from "@/lib/supabase";
import api from "@/lib/api";
import { can, PERMISSION_DENIED_HINT } from "@/lib/permissions";

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
  const { role } = useRole();
  const canPaid = can(role, "PAID_OP"); // AI分析実行（社長のみ・API課金）
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
    if (selected.size === 0 || !canPaid) return;
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
  }, [selected, shops, forceReanalyze, persistedFailures, targetMonth, canPaid]);

  // ── Batchモード（Anthropic Batch API・トークン半額）──
  // 投入→（最大1時間程度）→「結果を取り込む」で反映。品質は同期版と同一（同じモデル・同じ照合ゲート）
  interface BatchRow {
    id: string;
    anthropic_batch_id: string | null;
    round: number;
    status: string;
    item_total: number;
    created_at: string;
    stateCounts: Record<string, number>;
  }
  const [batchRows, setBatchRows] = useState<BatchRow[]>([]);
  const [batchHasActive, setBatchHasActive] = useState(false);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [batchPolling, setBatchPolling] = useState(false);
  const [batchMsg, setBatchMsg] = useState<string | null>(null);

  const fetchBatchStatus = useCallback(async () => {
    try {
      const res = await api.get("/api/report/analyze-batch", { timeout: 30000 });
      setBatchRows(res.data?.batches || []);
      setBatchHasActive(!!res.data?.hasActive);
    } catch { /* 表示用なので握る */ }
  }, []);

  useEffect(() => { fetchBatchStatus(); }, [fetchBatchStatus]);

  const runBatchSubmit = useCallback(async () => {
    if (selected.size === 0 || !canPaid) return;
    cancelRef.current = false;
    setBatchSubmitting(true);
    setBatchMsg(null);
    setError(null);
    const selectedShops = shops.filter((s) => selected.has(s.id)).map((s) => ({ id: s.id, name: s.name }));
    const CHUNK = 10; // 1回のPOSTでデータ準備する店舗数（Claudeは呼ばないため冷却不要）
    let submitted = 0, skipped = 0, failed = 0, pendingSkipped = 0;
    for (let i = 0; i < selectedShops.length; i += CHUNK) {
      if (cancelRef.current) { setBatchMsg(`中断しました（投入済み${submitted}店舗）`); break; }
      const chunk = selectedShops.slice(i, i + CHUNK);
      setBatchMsg(`データ準備・投入中... ${Math.min(i + CHUNK, selectedShops.length)}/${selectedShops.length}店舗`);
      try {
        const res = await api.post(
          "/api/report/analyze",
          { shops: chunk, force: forceReanalyze, targetMonth, batchPrepare: true },
          { timeout: 280000 },
        );
        submitted += res.data?.submitted || 0;
        const rs = (res.data?.results || []) as AnalysisResult[];
        skipped += rs.filter((r) => r.status !== "prepared").length;
        pendingSkipped += rs.filter((r) => r.status === "batch_pending").length;
      } catch (err: any) {
        failed += chunk.length;
        setError(safeStr(err?.response?.data?.error || err?.message || "投入エラー"));
      }
    }
    if (!cancelRef.current) {
      const pendNote = pendingSkipped > 0 ? `・結果待ちのため除外${pendingSkipped}件（二重投入防止）` : "";
      setBatchMsg(`投入完了: ${submitted}店舗（対象外スキップ${skipped}件${pendNote}${failed > 0 ? `・失敗${failed}件` : ""}）。結果は通常1時間以内に「結果を取り込む」で反映できます`);
    }
    setBatchSubmitting(false);
    fetchBatchStatus();
  }, [selected, shops, forceReanalyze, targetMonth, canPaid, fetchBatchStatus]);

  const runBatchPoll = useCallback(async () => {
    if (!canPaid) return;
    setBatchPolling(true);
    setBatchMsg(null);
    try {
      const res = await api.post("/api/report/analyze-batch", {}, { timeout: 280000 });
      const d = res.data || {};
      if (d.lockBusy) {
        setBatchMsg(d.message || "別の取り込みが実行中です。完了までお待ちください");
      } else {
        setBatchMsg(
          `取り込み: 保存${d.saved || 0}件${d.blanked ? `（うち照合違反で一部空欄${d.blanked}件）` : ""} / 失敗${d.failed || 0}件 / 再生成へ${d.retried || 0}件 / 未完了${d.stillProcessing || 0}バッチ${d.deadBatches ? ` / 対象外${d.deadBatches}バッチ` : ""}`,
        );
      }
      if ((d.saved || 0) > 0) setResults((r) => [...r]); // 分析済みバッジを更新
    } catch (err: any) {
      setError(safeStr(err?.response?.data?.error || err?.message || "取り込みエラー"));
    }
    setBatchPolling(false);
    fetchBatchStatus();
  }, [canPaid, fetchBatchStatus]);

  // 失敗・取り残しアイテムの再投入（復旧操作）
  const runBatchRescue = useCallback(async () => {
    if (!canPaid) return;
    setBatchPolling(true);
    setBatchMsg(null);
    try {
      const res = await api.post("/api/report/analyze-batch", { action: "rescue" }, { timeout: 280000 });
      const d = res.data || {};
      setBatchMsg(d.rescued > 0
        ? `失敗分を再投入しました: ${d.rescued}件。約1時間後に「結果を取り込む」を押してください`
        : "再投入できる失敗アイテムはありません");
    } catch (err: any) {
      setError(safeStr(err?.response?.data?.error || err?.message || "再投入エラー"));
    }
    setBatchPolling(false);
    fetchBatchStatus();
  }, [canPaid, fetchBatchStatus]);

  // 未完了バッチがある間は90秒ごとに状況を自動更新（取り込みは手動 or ボタン）
  useEffect(() => {
    if (!batchHasActive) return;
    const t = setInterval(fetchBatchStatus, 90000);
    return () => clearInterval(t);
  }, [batchHasActive, fetchBatchStatus]);

  // 失敗アイテムの有無（救済ボタンの表示判定）
  const batchFailedCount = batchRows.reduce((n, b) => n + (b.stateCounts?.["failed"] || 0), 0);

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
            disabled={running || batchSubmitting || selected.size === 0 || !apiConnected || !canPaid}
            title={!canPaid ? PERMISSION_DENIED_HINT.PAID_OP : undefined}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
              running || selected.size === 0 || !apiConnected || !canPaid
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
          <button
            onClick={runBatchSubmit}
            disabled={running || batchSubmitting || selected.size === 0 || !apiConnected || !canPaid}
            title={!canPaid ? PERMISSION_DENIED_HINT.PAID_OP : "Anthropic Batch APIで一括生成（トークン半額）。結果は通常1時間以内に反映"}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
              running || batchSubmitting || selected.size === 0 || !apiConnected || !canPaid
                ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                : "bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm"
            }`}
          >
            {batchSubmitting ? (
              <>
                <span className="inline-block w-4 h-4 border-2 border-slate-300 border-t-white rounded-full animate-spin" />
                投入中...
              </>
            ) : (
              <>Batchで一括投入（半額）</>
            )}
          </button>
          {(running || batchSubmitting) && (
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

      {/* Batchモードの状況パネル */}
      {(batchMsg || batchRows.length > 0) && (
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 mb-6">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <h3 className="text-sm font-semibold text-slate-600">
              Batch分析の状況
              {batchHasActive && <span className="ml-2 text-xs text-emerald-600">処理中のバッチあり（通常1時間以内に完了）</span>}
            </h3>
            <div className="flex gap-2">
              {batchFailedCount > 0 && (
                <button
                  onClick={runBatchRescue}
                  disabled={batchPolling || !canPaid}
                  title="取り込みに失敗した店舗を新しいバッチとして投入し直します"
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    batchPolling || !canPaid
                      ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                      : "bg-orange-600 text-white hover:bg-orange-700 cursor-pointer"
                  }`}
                >
                  失敗{batchFailedCount}件を再投入
                </button>
              )}
              <button
                onClick={runBatchPoll}
                disabled={batchPolling || !canPaid}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  batchPolling || !canPaid
                    ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                    : "bg-[#003D6B] text-white hover:bg-[#002a4a] cursor-pointer"
                }`}
              >
                {batchPolling ? "取り込み中..." : "結果を取り込む"}
              </button>
            </div>
          </div>
          {batchMsg && <p className="text-xs text-slate-600 mb-2">{batchMsg}</p>}
          {batchRows.length > 0 && (
            <div className="space-y-1">
              {batchRows.slice(0, 8).map((b) => {
                const c = b.stateCounts || {};
                const done = (c["succeeded"] || 0) + (c["blanked"] || 0);
                return (
                  <div key={b.id} className="flex items-center gap-3 text-xs text-slate-500">
                    <span className={`inline-block w-2 h-2 rounded-full ${
                      b.status === "submitted" ? "bg-amber-400 animate-pulse" :
                      b.status === "processed" ? "bg-emerald-500" : "bg-red-400"
                    }`} />
                    <span>{new Date(b.created_at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                    <span>{b.round > 0 ? `再生成R${b.round}` : "初回"}</span>
                    <span>{b.item_total}店舗</span>
                    <span>
                      {b.status === "submitted" ? "生成中" :
                       b.status === "processed" ? `完了（保存${done}${c["failed"] ? `・失敗${c["failed"]}` : ""}${c["pending"] ? `・別ラウンドへ${c["pending"]}` : ""}）` :
                       b.status === "submit_failed" ? "投入失敗" : b.status}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

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
