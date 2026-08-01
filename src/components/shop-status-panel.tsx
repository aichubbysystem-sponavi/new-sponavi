"use client";

/**
 * MEOマスタ同期と順位計測対象の管理パネル（システム管理ページ内）
 *
 * 【設計方針】
 * 1. 今どうなっているか（現在の状態）を常に画面上部に出す。
 *    これが無いと、実行した結果が正しいのか判断できない。
 * 2. 「確認しただけ（未反映）」と「反映した」を色と見出しではっきり分ける。
 *    どちらも同じ見た目だと、押したのか押していないのか分からなくなる。
 * 3. 反映後は、何を変えたかを結果として残す。
 * 4. 計測対象外の店舗は一覧で常時見られるようにし、個別に戻せるようにする。
 *    一括で124件に設定した後、中身を確認する手段が無いと不安が残る。
 *
 * どちらの操作も「まず確認 → 内容を見てから適用」の2段階。
 * 契約同期は全店舗の解約フラグを触りうるし、順位計測フラグは
 * 誤ると100件超の課金につながるため、ボタン一発では書き込まない。
 */

import { useCallback, useEffect, useState } from "react";
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
type Counts = { total: number; active: number; cancelled: number; paused: number; rankDisabled: number };
type Shop = { id: string; name: string };

const STATUS_LABEL: Record<string, string> = { active: "契約中", cancelled: "解約", paused: "停止中" };
const STATUS_COLOR: Record<string, string> = {
  active: "text-emerald-600",
  cancelled: "text-red-600",
  paused: "text-orange-600",
};

function nowLabel() {
  return new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

/** 見出し付きの結果ボックス。確認(未反映)と反映済みで色を変える */
function ResultBox({ applied, title, children }: { applied: boolean; title: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-lg border p-4 ${applied ? "border-emerald-300 bg-emerald-50/60" : "border-blue-200 bg-blue-50/50"}`}>
      <p className={`text-xs font-bold mb-3 ${applied ? "text-emerald-700" : "text-blue-700"}`}>
        {applied ? "✓ " : "👁 "}{title}
      </p>
      {children}
    </div>
  );
}

export default function ShopStatusPanel() {
  const [busy, setBusy] = useState<string | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncAt, setSyncAt] = useState<string>("");
  const [rankResult, setRankResult] = useState<{ applied: boolean; count: number; shops?: Shop[]; label: string } | null>(null);
  const [disabledShops, setDisabledShops] = useState<Shop[]>([]);
  const [filter, setFilter] = useState("");
  const [keyword, setKeyword] = useState("エミナル");
  const [error, setError] = useState<string | null>(null);

  const loadState = useCallback(async () => {
    try {
      const [c, d] = await Promise.all([
        api.get("/api/report/sync-contract-status"),
        api.get("/api/report/rank-tracking"),
      ]);
      setCounts(c.data?.counts || null);
      setDisabledShops(d.data?.shops || []);
    } catch {
      /* 表示だけなので失敗しても操作は続けられる */
    }
  }, []);

  useEffect(() => { loadState(); }, [loadState]);

  async function runSync(apply: boolean) {
    setBusy(apply ? "sync-apply" : "sync-dry");
    setError(null);
    try {
      const res = await api.post("/api/report/sync-contract-status", { apply, force: false });
      setSyncResult(res.data);
      setSyncAt(nowLabel());
      if (apply) await loadState();
    } catch (e: any) {
      setError(e?.response?.data?.error || "同期に失敗しました");
      if (e?.response?.data?.summary) setSyncResult(e.response.data);
    } finally {
      setBusy(null);
    }
  }

  async function runRankBulk(apply: boolean, disabled: boolean) {
    if (!keyword.trim()) { setError("対象の文字列を入力してください"); return; }
    setBusy(`rank-${apply ? "apply" : "dry"}`);
    setError(null);
    try {
      const res = await api.post("/api/report/rank-tracking", { namePrefix: keyword.trim(), disabled, apply });
      const d = res.data;
      setRankResult({
        applied: apply,
        count: apply ? (d.updated ?? 0) : (d.matched ?? 0),
        shops: d.shops,
        label: disabled ? "計測対象外" : "計測対象",
      });
      if (apply) await loadState();
    } catch (e: any) {
      setError(e?.response?.data?.error || "設定に失敗しました");
    } finally {
      setBusy(null);
    }
  }

  async function restoreOne(shop: Shop) {
    setBusy(`restore-${shop.id}`);
    setError(null);
    try {
      await api.post("/api/report/rank-tracking", { shopIds: [shop.id], disabled: false });
      await loadState();
      setRankResult({ applied: true, count: 1, label: "計測対象", shops: [shop] });
    } catch (e: any) {
      setError(e?.response?.data?.error || "戻せませんでした");
    } finally {
      setBusy(null);
    }
  }

  const s = syncResult?.summary || {};
  const visibleDisabled = filter
    ? disabledShops.filter((x) => x.name.toLowerCase().includes(filter.toLowerCase()))
    : disabledShops;

  return (
    <div className="space-y-5">
      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>}

      {/* 現在の状態 */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
        <h3 className="text-sm font-semibold text-slate-500 mb-3">現在の状態</h3>
        {!counts ? (
          <p className="text-xs text-slate-400">読み込み中...</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {[
              { label: "全店舗", value: counts.total, cls: "text-slate-700" },
              { label: "契約中", value: counts.active, cls: "text-emerald-600" },
              { label: "解約", value: counts.cancelled, cls: "text-red-600" },
              { label: "停止中", value: counts.paused, cls: "text-orange-600" },
              { label: "計測対象外", value: counts.rankDisabled, cls: "text-slate-500" },
            ].map((m) => (
              <div key={m.label} className="border border-slate-100 rounded-lg p-3 text-center">
                <p className="text-[10px] text-slate-400 mb-0.5">{m.label}</p>
                <p className={`text-xl font-bold ${m.cls}`}>{m.value}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* MEOマスタ同期 */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
        <h3 className="text-sm font-semibold text-slate-500 mb-1">MEOマスタ同期（契約中 / 解約 / 停止中）</h3>
        <p className="text-xs text-slate-400 mb-4">
          スプレッドシートのB列を店舗に反映します。解約・停止中の店舗は、口コミ同期・パフォーマンス同期・月次AI分析の対象外になります。
        </p>
        <div className="flex gap-2 mb-4">
          <button onClick={() => runSync(false)} disabled={!!busy}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50">
            {busy === "sync-dry" ? "確認中..." : "① 差分を確認"}
          </button>
          <button onClick={() => runSync(true)} disabled={!!busy || !syncResult?.dryRun}
            title={!syncResult?.dryRun ? "先に「差分を確認」を実行してください" : ""}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#003D6B] text-white hover:bg-[#002a4a] disabled:opacity-40">
            {busy === "sync-apply" ? "適用中..." : "② 適用する"}
          </button>
        </div>

        {syncResult && (
          <ResultBox
            applied={syncResult.dryRun === false}
            title={syncResult.dryRun
              ? `確認しました（${syncAt}）— まだ反映していません`
              : `反映しました（${syncAt}）— ${s.updated ?? 0}件を更新`}
          >
            <div className="flex flex-wrap gap-2 text-[11px] mb-3">
              <span className="px-2 py-1 bg-white border border-slate-200 rounded">マスタ {s.masterRows}件</span>
              <span className="px-2 py-1 bg-white border border-slate-200 rounded">DB {s.dbShops}件</span>
              <span className="px-2 py-1 bg-white border border-slate-200 rounded">解約 {s.cancelled}</span>
              <span className="px-2 py-1 bg-white border border-slate-200 rounded">停止 {s.paused}</span>
              <span className="px-2 py-1 bg-white border border-slate-200 rounded">契約中に戻す {s.reactivated}</span>
            </div>

            {(syncResult.changes?.length ?? 0) > 0 ? (
              <div className="border border-slate-200 rounded-lg bg-white">
                <p className="px-3 py-2 text-[11px] font-semibold text-slate-600 border-b border-slate-100">
                  {syncResult.dryRun ? "反映される内容" : "反映した内容"}（{syncResult.changes!.length}件）
                </p>
                <div className="max-h-56 overflow-y-auto divide-y divide-slate-50">
                  {syncResult.changes!.map((c) => (
                    <div key={c.shopId} className="px-3 py-1.5 text-xs flex justify-between gap-3">
                      <span className="text-slate-700 truncate">{c.shopName}</span>
                      <span className="flex-shrink-0 text-slate-400">
                        <span className={STATUS_COLOR[c.from]}>{STATUS_LABEL[c.from] || c.from}</span>
                        {" → "}
                        <b className={STATUS_COLOR[c.to]}>{STATUS_LABEL[c.to] || c.to}</b>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500">変更が必要な店舗はありませんでした（マスタとDBは一致しています）。</p>
            )}

            {(syncResult.unmatched?.length ?? 0) > 0 && (
              <details className="mt-3 border border-amber-200 bg-white rounded-lg">
                <summary className="px-3 py-2 text-[11px] font-semibold text-amber-700 cursor-pointer">
                  反映できなかった店舗（{syncResult.unmatched!.length}件）— DBに同じ名前が見つかりません
                </summary>
                <div className="max-h-48 overflow-y-auto px-3 py-2 text-xs text-slate-600 space-y-1">
                  {syncResult.unmatched!.map((u) => (
                    <div key={u.shopName} className="flex justify-between gap-2">
                      <span className="truncate">{u.shopName}</span>
                      <span className={`flex-shrink-0 ${STATUS_COLOR[u.status]}`}>{STATUS_LABEL[u.status] || u.status}</span>
                    </div>
                  ))}
                </div>
                <p className="px-3 pb-2 text-[10px] text-slate-400">
                  シートとDBで店舗名の表記が違う可能性があります。解約のものが含まれる場合は個別に確認してください。
                </p>
              </details>
            )}

            {((syncResult.duplicatedInDb?.length ?? 0) > 0 || (syncResult.duplicatedInMaster?.length ?? 0) > 0) && (
              <p className="mt-3 text-[11px] text-amber-700 bg-white border border-amber-200 rounded-lg p-3">
                同名が複数あるため保留しました（DB {syncResult.duplicatedInDb?.length ?? 0}件 / マスタ {syncResult.duplicatedInMaster?.length ?? 0}件）。
                誤った店舗を解約にしないため変更していません。
              </p>
            )}

            {(syncResult.failed?.length ?? 0) > 0 && (
              <p className="mt-3 text-[11px] text-red-700 bg-white border border-red-200 rounded-lg p-3">
                更新に失敗した店舗が {syncResult.failed!.length} 件あります。
              </p>
            )}
          </ResultBox>
        )}
      </div>

      {/* 順位計測の対象外 */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
        <h3 className="text-sm font-semibold text-slate-500 mb-1">順位計測の対象外設定</h3>
        <p className="text-xs text-slate-400 mb-4">
          対象外にした店舗は「いつもの店舗」に追加できず、実測APIでも拒否されます。多地点順位チェックの一括計測・座標取得・KW取得からも除かれます。
        </p>

        <div className="flex flex-wrap gap-2 items-center mb-4">
          <input value={keyword} onChange={(e) => setKeyword(e.target.value)}
            placeholder="店舗名に含む文字列（3文字以上）"
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm w-60" />
          <button onClick={() => runRankBulk(false, true)} disabled={!!busy}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50">
            {busy === "rank-dry" ? "確認中..." : "① 対象を確認"}
          </button>
          <button onClick={() => runRankBulk(true, true)} disabled={!!busy || !(rankResult && !rankResult.applied)}
            title={!(rankResult && !rankResult.applied) ? "先に「対象を確認」を実行してください" : ""}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#003D6B] text-white hover:bg-[#002a4a] disabled:opacity-40">
            {busy === "rank-apply" ? "適用中..." : "② 対象外にする"}
          </button>
          <button onClick={() => runRankBulk(true, false)} disabled={!!busy}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            この条件をまとめて対象に戻す
          </button>
        </div>

        {rankResult && (
          <div className="mb-4">
            <ResultBox
              applied={rankResult.applied}
              title={rankResult.applied
                ? `反映しました — ${rankResult.count}件を${rankResult.label}に変更`
                : `確認しました — 対象は${rankResult.count}件です。まだ反映していません`}
            >
              {(rankResult.shops?.length ?? 0) > 0 && (
                <div className="max-h-40 overflow-y-auto text-xs text-slate-600 space-y-0.5 bg-white border border-slate-200 rounded-lg p-2">
                  {rankResult.shops!.map((x) => <div key={x.id}>{x.name}</div>)}
                </div>
              )}
            </ResultBox>
          </div>
        )}

        {/* 現在の対象外一覧（適用後も確認・個別解除できる） */}
        <div className="border border-slate-200 rounded-lg">
          <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold text-slate-600">
              現在の計測対象外（{disabledShops.length}件）
            </p>
            {disabledShops.length > 0 && (
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="絞り込み"
                className="px-2 py-1 border border-slate-200 rounded text-xs w-40" />
            )}
          </div>
          {disabledShops.length === 0 ? (
            <p className="px-3 py-4 text-xs text-slate-400 text-center">対象外の店舗はありません</p>
          ) : (
            <div className="max-h-64 overflow-y-auto divide-y divide-slate-50">
              {visibleDisabled.map((x) => (
                <div key={x.id} className="px-3 py-1.5 text-xs flex items-center justify-between gap-2">
                  <span className="text-slate-700 truncate">{x.name}</span>
                  <button onClick={() => restoreOne(x)} disabled={!!busy}
                    className="flex-shrink-0 px-2 py-0.5 rounded border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40">
                    {busy === `restore-${x.id}` ? "..." : "対象に戻す"}
                  </button>
                </div>
              ))}
              {visibleDisabled.length === 0 && (
                <p className="px-3 py-4 text-xs text-slate-400 text-center">「{filter}」に一致する店舗はありません</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
