"use client";

/**
 * MEOマスタ同期と順位計測対象の管理パネル（システム管理ページ内）
 *
 * どちらの操作も「まず確認（dry-run）→ 内容を見てから適用」の2段階にしている。
 * 契約ステータスの同期は全店舗の解約フラグを触りうるし、
 * 順位計測フラグは誤ると122店舗分の課金につながるため、
 * ボタン一発で書き込みが走らないようにしている。
 */

import { useState } from "react";
import api from "@/lib/api";

type Change = { shopId: string; shopName: string; from: string; to: string };
type SyncResult = {
  dryRun: boolean;
  summary: Record<string, number>;
  changes?: Change[];
  unmatched?: { shopName: string; status: string }[];
  duplicatedInDb?: string[];
  duplicatedInMaster?: string[];
  failed?: { shopName: string; error: string }[];
};

const STATUS_LABEL: Record<string, string> = {
  active: "契約中",
  cancelled: "解約",
  paused: "停止中",
};

export default function ShopStatusPanel() {
  const [busy, setBusy] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [rankResult, setRankResult] = useState<{ dryRun: boolean; matched?: number; updated?: number; shops?: { id: string; name: string }[] } | null>(null);
  const [prefix, setPrefix] = useState("エミナルクリニック");
  const [error, setError] = useState<string | null>(null);

  async function runSync(apply: boolean) {
    setBusy(apply ? "sync-apply" : "sync-dry");
    setError(null);
    try {
      const res = await api.post("/api/report/sync-contract-status", { apply, force: false });
      setSyncResult(res.data);
    } catch (e: any) {
      setError(e?.response?.data?.error || "同期に失敗しました");
      if (e?.response?.data?.summary) setSyncResult(e.response.data);
    } finally {
      setBusy(null);
    }
  }

  async function runRank(apply: boolean, disabled: boolean) {
    if (!prefix.trim()) { setError("店舗名の先頭を入力してください"); return; }
    setBusy(apply ? "rank-apply" : "rank-dry");
    setError(null);
    try {
      const res = await api.post("/api/report/rank-tracking", { namePrefix: prefix.trim(), disabled, apply });
      setRankResult(res.data);
    } catch (e: any) {
      setError(e?.response?.data?.error || "設定に失敗しました");
    } finally {
      setBusy(null);
    }
  }

  const s = syncResult?.summary || {};

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>
      )}

      {/* MEOマスタ同期 */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
        <h3 className="text-sm font-semibold text-slate-500 mb-1">MEOマスタ同期（契約中 / 解約 / 停止中）</h3>
        <p className="text-xs text-slate-400 mb-4">
          スプレッドシートのB列を店舗に反映します。解約・停止中の店舗は、口コミ同期・パフォーマンス同期・月次AI分析の対象外になります。
        </p>
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => runSync(false)}
            disabled={!!busy}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50"
          >
            {busy === "sync-dry" ? "確認中..." : "① 差分を確認"}
          </button>
          <button
            onClick={() => runSync(true)}
            disabled={!!busy || !syncResult?.dryRun}
            title={!syncResult?.dryRun ? "先に「差分を確認」を実行してください" : ""}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#003D6B] text-white hover:bg-[#002a4a] disabled:opacity-40"
          >
            {busy === "sync-apply" ? "適用中..." : "② 適用する"}
          </button>
        </div>

        {syncResult && (
          <div className="text-sm space-y-3">
            <div className="flex flex-wrap gap-3 text-xs">
              <span className="px-2 py-1 bg-slate-50 rounded">マスタ {s.masterRows}件</span>
              <span className="px-2 py-1 bg-slate-50 rounded">DB {s.dbShops}件</span>
              <span className="px-2 py-1 bg-amber-50 text-amber-700 rounded font-semibold">変更 {s.changes}件</span>
              <span className="px-2 py-1 bg-red-50 text-red-600 rounded">解約 {s.cancelled}</span>
              <span className="px-2 py-1 bg-orange-50 text-orange-600 rounded">停止 {s.paused}</span>
              <span className="px-2 py-1 bg-emerald-50 text-emerald-600 rounded">復活 {s.reactivated}</span>
              {syncResult.dryRun === false && <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded font-semibold">更新済 {s.updated}</span>}
            </div>

            {(syncResult.changes?.length ?? 0) > 0 && (
              <details open className="border border-slate-200 rounded-lg">
                <summary className="px-3 py-2 text-xs font-semibold text-slate-600 cursor-pointer">
                  変更内容（{syncResult.changes!.length}件）
                </summary>
                <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
                  {syncResult.changes!.map((c) => (
                    <div key={c.shopId} className="px-3 py-1.5 text-xs flex justify-between gap-2">
                      <span className="text-slate-700 truncate">{c.shopName}</span>
                      <span className="text-slate-400 flex-shrink-0">
                        {STATUS_LABEL[c.from] || c.from} → <b className="text-slate-700">{STATUS_LABEL[c.to] || c.to}</b>
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            )}

            {(syncResult.unmatched?.length ?? 0) > 0 && (
              <details className="border border-amber-200 bg-amber-50/40 rounded-lg">
                <summary className="px-3 py-2 text-xs font-semibold text-amber-700 cursor-pointer">
                  DBに見つからなかった店舗（{syncResult.unmatched!.length}件）— 店舗名の表記を確認してください
                </summary>
                <div className="max-h-48 overflow-y-auto px-3 py-2 text-xs text-slate-600 space-y-1">
                  {syncResult.unmatched!.map((u) => (
                    <div key={u.shopName}>{u.shopName}（{STATUS_LABEL[u.status] || u.status}）</div>
                  ))}
                </div>
              </details>
            )}

            {((syncResult.duplicatedInDb?.length ?? 0) > 0 || (syncResult.duplicatedInMaster?.length ?? 0) > 0) && (
              <div className="text-xs text-amber-700 bg-amber-50 rounded-lg p-3">
                同名が複数あるため保留した店舗があります（DB {syncResult.duplicatedInDb?.length ?? 0}件 / マスタ {syncResult.duplicatedInMaster?.length ?? 0}件）。
                誤った店舗を解約にしないため、これらは変更していません。
              </div>
            )}

            {(syncResult.failed?.length ?? 0) > 0 && (
              <div className="text-xs text-red-700 bg-red-50 rounded-lg p-3">
                更新に失敗した店舗が {syncResult.failed!.length} 件あります。
              </div>
            )}
          </div>
        )}
      </div>

      {/* 順位計測の対象外 */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
        <h3 className="text-sm font-semibold text-slate-500 mb-1">順位計測の対象外設定</h3>
        <p className="text-xs text-slate-400 mb-4">
          対象外にした店舗は「いつもの店舗」に追加できず、実測APIでも拒否されます。誤った一括計測による課金を防ぎます。
        </p>
        <div className="flex flex-wrap gap-2 items-center mb-4">
          <input
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            placeholder="店舗名の先頭（3文字以上）"
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm w-64"
          />
          <button
            onClick={() => runRank(false, true)}
            disabled={!!busy}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50"
          >
            {busy === "rank-dry" ? "確認中..." : "① 対象を確認"}
          </button>
          <button
            onClick={() => runRank(true, true)}
            disabled={!!busy || !rankResult?.dryRun}
            title={!rankResult?.dryRun ? "先に「対象を確認」を実行してください" : ""}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#003D6B] text-white hover:bg-[#002a4a] disabled:opacity-40"
          >
            {busy === "rank-apply" ? "適用中..." : "② 対象外にする"}
          </button>
          <button
            onClick={() => runRank(true, false)}
            disabled={!!busy}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            対象に戻す
          </button>
        </div>

        {rankResult && (
          <div className="text-sm">
            <p className="text-xs mb-2">
              {rankResult.dryRun
                ? <>対象は <b>{rankResult.matched}件</b> です。内容を確認して「② 対象外にする」を押してください。</>
                : <><b>{rankResult.updated}件</b> を更新しました。</>}
            </p>
            {(rankResult.shops?.length ?? 0) > 0 && (
              <details className="border border-slate-200 rounded-lg">
                <summary className="px-3 py-2 text-xs font-semibold text-slate-600 cursor-pointer">対象店舗</summary>
                <div className="max-h-48 overflow-y-auto px-3 py-2 text-xs text-slate-600 space-y-1">
                  {rankResult.shops!.map((s2) => <div key={s2.id}>{s2.name}</div>)}
                </div>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
