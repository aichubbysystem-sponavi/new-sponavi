"use client";

import { useState, useEffect, useCallback } from "react";
import { useShop } from "@/components/shop-provider";
import api from "@/lib/api";

interface GbpAccount {
  id: string;
  account_id: string;
  email: string;
  type: number;
  created_at: string;
  location_count?: number;
}

/** POST /api/report/gbp-sync のレスポンス（lib/gbp-shop-sync.ts の SyncSummary と対応） */
interface SyncResult {
  scanned: number;
  accounts: number;
  usableTokens: number;
  added: string[];
  linked: string[];
  linkable: string[];
  updated: number;
  renamed: { shopId: string; shopName: string; locationId: string; oldGbpName: string; newGbpName: string }[];
  conflicts: { locationId: string; title: string; reason: string }[];
  pendingInserts: string[];
  insertBlockedReason: "cron" | "threshold" | null;
  insertThreshold: number;
  errors: string[];
}

export default function GbpAccountsPage() {
  const { refreshShops } = useShop();
  const [accounts, setAccounts] = useState<GbpAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [msgType, setMsgType] = useState<"success" | "error" | "info">("info");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);

  const showMsg = (text: string, type: "success" | "error" | "info" = "info") => {
    setMsg(text);
    setMsgType(type);
  };

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/api/google/account", { timeout: 15000 });
      const apiData = res.data || [];
      if (Array.isArray(apiData) && apiData.length > 0) {
        setAccounts(apiData.map((a: any, i: number) => ({
          id: a.id || String(i),
          account_id: a.account_id || a.google_account_id || "",
          email: a.email || a.google_email || a.name || `アカウント${i + 1}`,
          type: a.type || 0,
          created_at: a.created_at || "",
        })));
        setLoading(false);
        return;
      }
    } catch {}

    // フォールバック: サーバーAPI経由で取得（トークンをクライアントへ露出させない / C-1対策）
    try {
      const fb = await api.get("/api/report/oauth-accounts", { timeout: 15000 });
      const list = fb.data?.accounts || [];
      if (Array.isArray(list) && list.length > 0) {
        setAccounts(list.map((d: any, i: number) => ({
          id: String(i),
          account_id: d.account_id || "",
          email: d.email || d.google_email || `接続済みアカウント${i + 1}`,
          type: d.type || 1,
          created_at: d.created_at || "",
        })));
      } else {
        setAccounts([]);
      }
    } catch { setAccounts([]); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  // OAuth認証URL取得→新しいタブで開く
  const handleAddAccount = async () => {
    try {
      const res = await api.get("/api/google/oauth");
      const authUrl = res.data?.url || res.data?.auth_url || res.data;
      if (typeof authUrl === "string" && authUrl.startsWith("http")) {
        window.open(authUrl, "_blank");
        showMsg("新しいタブでGoogleログイン画面が開きます。認証完了後、下の「更新する」ボタンを押してください。", "info");
      } else {
        showMsg("OAuth URLの取得に失敗しました。Go APIが稼働しているか確認してください。", "error");
      }
    } catch (e: any) {
      showMsg(`エラー: ${e?.response?.data?.message || e?.message || "OAuth URL取得失敗"}`, "error");
    }
  };

  /**
   * 新店舗の検出・インポート + GBP店名の同期
   *
   * サーバー側の /api/report/gbp-sync に一本化している。理由:
   *  - Go APIの /api/shop 経由でPOSTすると gbp_location_name が保存されず、
   *    追加された店舗がGBPと紐付かない状態になっていた（2026-08-08 実データで確認）
   *  - クライアントからGoogle APIを直接叩けないため、アカウントの取りこぼしが起きていた
   *    （旧実装は先頭5アカウントのみスキャン。実際は9アカウント存在する）
   */
  const handleImport = async (confirmBulkImport = false) => {
    if (importing) return;
    setImporting(true);
    setResult(null);
    showMsg('全GBPアカウントをスキャンしています。1〜2分かかることがあります...', 'info');

    try {
      // サーバー側の maxDuration(300秒) より長くする。
      // 短くすると「クライアントは失敗表示・サーバーは正常完了」という食い違いが起きる
      const res = await api.post('/api/report/gbp-sync', { confirmBulkImport }, { timeout: 320000 });
      const data = res.data as SyncResult;
      setResult(data);

      const parts = [
        `新規追加 ${data.added.length}件`,
        `紐付け修復 ${data.linked.length}件`,
        `情報更新 ${data.updated}件`,
        `店名変更検出 ${data.renamed.length}件`,
      ];
      if (data.pendingInserts.length > 0) parts.push(`登録保留 ${data.pendingInserts.length}件`);
      const hasProblem = data.errors.length > 0 || data.conflicts.length > 0 || data.pendingInserts.length > 0;
      showMsg(
        `同期完了（${data.accounts}アカウント / ${data.scanned}ロケーション）: ${parts.join(" / ")}`,
        hasProblem ? "error" : "success",
      );

      if (data.added.length > 0 || data.linked.length > 0 || data.updated > 0) {
        try { refreshShops(); } catch {}
      }
    } catch (e: any) {
      if (e?.code === "ECONNABORTED" || !e?.response) {
        // 接続が切れただけでサーバー側は完走している可能性がある。
        // 「失敗した」と断定すると再実行を促してしまうので、確認を促す文言にする
        showMsg(
          "応答を受け取れませんでした。サーバー側では処理が完了している可能性があります。"
          + "ページを再読み込みして顧客マスタを確認してください（同期は何度実行しても安全です）",
          "error",
        );
      } else {
        const detail = e?.response?.data?.error || e?.response?.data?.message || e?.message || "不明なエラー";
        showMsg(`同期に失敗しました: ${detail}`, "error");
      }
    } finally {
      setImporting(false);
    }
  };


  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">GBPアカウント管理</h1>
          <p className="text-sm text-slate-500 mt-1">Googleアカウントの接続・店舗インポート・新店舗自動検出</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => handleImport(false)} disabled={loading || importing}
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
            {importing ? "同期中..." : "新店舗を検出・インポート"}
          </button>
          <button onClick={handleAddAccount} disabled={importing}
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-[#003D6B] text-white hover:bg-[#002a4a] disabled:opacity-50">
            + Googleアカウント追加
          </button>
        </div>
      </div>

      {/* メッセージ */}
      {msg && (
        <div className={`p-3 rounded-lg mb-4 text-sm border flex items-center justify-between ${
          msgType === "error" ? "bg-red-50 text-red-600 border-red-200" :
          msgType === "success" ? "bg-emerald-50 text-emerald-600 border-emerald-200" :
          "bg-blue-50 text-blue-600 border-blue-200"
        }`}>
          <span>{msg}</span>
          <div className="flex gap-2 ml-3 flex-shrink-0">
            {msg.includes("更新") && msg.includes("ボタン") && (
              <button onClick={() => { fetchAccounts(); setMsg(""); }}
                className="px-3 py-1 rounded text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700">
                更新する
              </button>
            )}
            <button onClick={() => setMsg("")} className="text-xs opacity-60 hover:opacity-100">✕</button>
          </div>
        </div>
      )}

      {/* 実行中 */}
      {importing && (
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-4 h-4 border-2 border-[#003D6B] border-t-transparent rounded-full animate-spin" />
            <span className="text-sm font-semibold text-slate-700">全GBPアカウントをスキャン中...</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            アカウント数によっては1〜2分かかります。このページを離れても処理はサーバー側で続行されます。
          </p>
        </div>
      )}

      {/* 同期結果 */}
      {result && !importing && (
        <div className={`rounded-xl p-5 shadow-sm border mb-4 ${
          result.errors.length > 0 || result.conflicts.length > 0
            ? "bg-amber-50 border-amber-200" : "bg-emerald-50 border-emerald-200"
        }`}>
          <h3 className="text-sm font-bold mb-3 text-slate-700">
            同期結果（{result.accounts}アカウント / {result.scanned}ロケーション）
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-center">
            <div>
              <p className="text-xl font-bold text-emerald-600">{result.added.length}</p>
              <p className="text-[10px] text-slate-500">新規追加</p>
            </div>
            <div>
              <p className="text-xl font-bold text-amber-600">{result.pendingInserts.length}</p>
              <p className="text-[10px] text-slate-500">登録保留</p>
            </div>
            <div>
              <p className="text-xl font-bold text-blue-600">{result.linked.length}</p>
              <p className="text-[10px] text-slate-500">紐付け修復</p>
            </div>
            <div>
              <p className="text-xl font-bold text-slate-700">{result.updated}</p>
              <p className="text-[10px] text-slate-500">情報更新</p>
            </div>
            <div>
              <p className="text-xl font-bold text-orange-600">{result.renamed.length}</p>
              <p className="text-[10px] text-slate-500">店名変更を検出</p>
            </div>
            <div>
              <p className="text-xl font-bold text-red-500">{result.errors.length + result.conflicts.length}</p>
              <p className="text-[10px] text-slate-500">要確認</p>
            </div>
          </div>

          {result.pendingInserts.length > 0 && (
            <div className="mt-3 bg-white rounded-lg p-3 border-2 border-amber-300">
              <p className="text-xs font-bold text-amber-700 mb-1">
                未登録の店舗を{result.pendingInserts.length}件検出しました（まだ登録していません）
              </p>
              <p className="text-[10px] text-slate-500 mb-2">
                {result.insertBlockedReason === "threshold"
                  ? `1回の登録が${result.insertThreshold}件を超えるため、確認のため保留しました。`
                    + `新しいGBPアカウントが見えるようになった等、状況が変わった可能性があります。`
                    + `下の一覧が全て自社で管理する店舗であることを確認してから登録してください。`
                  : `無人実行では店舗を登録しません。内容を確認して登録してください。`}
              </p>
              <div className="max-h-56 overflow-y-auto border border-slate-100 rounded p-2 mb-2">
                {result.pendingInserts.map((n, i) => (
                  <p key={i} className="text-[10px] text-slate-600">{n}</p>
                ))}
              </div>
              <button
                onClick={() => {
                  if (!confirm(
                    `${result.pendingInserts.length}件を顧客マスタに登録します。\n\n`
                    + `※ 自社で管理していない店舗が含まれていないか、上の一覧を確認してください。\n`
                    + `※ 登録後に取り消すには1件ずつ削除する必要があります。`,
                  )) return;
                  handleImport(true);
                }}
                disabled={importing}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {result.pendingInserts.length}件をすべて登録する
              </button>
            </div>
          )}

          {result.renamed.length > 0 && (
            <div className="mt-3 bg-white rounded-lg p-3 border border-orange-100">
              <p className="text-xs font-semibold text-orange-600 mb-1">GBP側で店名が変わっていた店舗</p>
              <p className="text-[10px] text-slate-400 mb-2">
                システム上の店舗名は各種データの結合キーのため変更していません（投稿用シート等が動かなくなるため）。
                GBP上の名前は「GBP現在名」として顧客マスタに表示・検索できます。
              </p>
              {result.renamed.slice(0, 30).map((r, i) => (
                <p key={i} className="text-[10px] text-slate-600">
                  <span className="text-slate-400">{r.oldGbpName}</span> → <span className="font-medium">{r.newGbpName}</span>
                </p>
              ))}
              {result.renamed.length > 30 && (
                <p className="text-[10px] text-slate-400 mt-1">...他{result.renamed.length - 30}件</p>
              )}
            </div>
          )}

          {result.added.length > 0 && (
            <div className="mt-3 bg-white rounded-lg p-3 border border-emerald-100">
              <p className="text-xs font-semibold text-emerald-600 mb-1">新規追加した店舗</p>
              {result.added.slice(0, 30).map((n, i) => <p key={i} className="text-[10px] text-slate-600">{n}</p>)}
              {result.added.length > 30 && <p className="text-[10px] text-slate-400 mt-1">...他{result.added.length - 30}件</p>}
            </div>
          )}

          {result.linked.length > 0 && (
            <div className="mt-3 bg-white rounded-lg p-3 border border-blue-100">
              <p className="text-xs font-semibold text-blue-600 mb-1">GBP未連携だった店舗を紐付けました</p>
              {result.linked.slice(0, 30).map((n, i) => <p key={i} className="text-[10px] text-slate-600">{n}</p>)}
              {result.linked.length > 30 && <p className="text-[10px] text-slate-400 mt-1">...他{result.linked.length - 30}件</p>}
            </div>
          )}

          {result.conflicts.length > 0 && (
            <div className="mt-3 bg-white rounded-lg p-3 border border-amber-100">
              <p className="text-xs font-semibold text-amber-700 mb-1">自動処理を見送った店舗（要確認）</p>
              {result.conflicts.slice(0, 20).map((c, i) => (
                <p key={i} className="text-[10px] text-slate-600">{c.title}: {c.reason}</p>
              ))}
              {result.conflicts.length > 20 && <p className="text-[10px] text-slate-400 mt-1">...他{result.conflicts.length - 20}件</p>}
            </div>
          )}

          {result.errors.length > 0 && (
            <div className="mt-3 bg-white rounded-lg p-3 border border-red-100">
              <p className="text-xs font-semibold text-red-600 mb-1">エラー（GBPを全件見えていない可能性があります）</p>
              {result.errors.slice(0, 20).map((e, i) => <p key={i} className="text-[10px] text-red-500">{e}</p>)}
              {result.errors.length > 20 && <p className="text-[10px] text-red-400 mt-1">...他{result.errors.length - 20}件</p>}
            </div>
          )}

          <button onClick={() => setResult(null)} className="mt-3 text-xs text-slate-500 hover:text-slate-700">閉じる</button>
        </div>
      )}

      {/* アカウント一覧 */}
      {loading ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">読み込み中...</p>
        </div>
      ) : accounts.length === 0 ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm mb-2">接続済みのGoogleアカウントがありません</p>
          <p className="text-slate-300 text-xs">「+ Googleアカウント追加」ボタンでGBP管理アカウントを接続してください</p>
        </div>
      ) : (
        <div className="space-y-3">
          {accounts.map((acc) => (
            <div key={acc.id} className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-800">{acc.email}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${acc.type === 1 ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"}`}>
                      {acc.type === 1 ? "PRIMARY" : `type=${acc.type}`}
                    </span>
                  </div>
                  {acc.account_id && (
                    <p className="text-[10px] text-slate-400 mt-0.5 font-mono">{acc.account_id}</p>
                  )}
                  {acc.created_at && (
                    <p className="text-[10px] text-slate-400">接続日: {new Date(acc.created_at).toLocaleDateString("ja-JP")}</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 説明 */}
      <div className="mt-6 bg-slate-50 rounded-xl p-5 border border-slate-200">
        <h3 className="text-sm font-semibold text-slate-600 mb-2">使い方</h3>
        <ol className="text-xs text-slate-500 space-y-1.5 list-decimal pl-4">
          <li>「+ Googleアカウント追加」→ GBP管理に使っているGoogleアカウントでログイン</li>
          <li>認証完了後、このページを更新 → アカウントが一覧に表示</li>
          <li>「新店舗を検出・インポート」→ 全アカウントをスキャンして未登録店舗を自動追加＋GBP上の店名を同期</li>
          <li>GBPで店名が変わった店舗は「店名変更を検出」に出ます。顧客マスタの「店名変更あり」からも確認できます</li>
        </ol>
        <p className="text-[10px] text-slate-400 mt-3">※ 毎日自動で新店舗検出が実行されます（Cron Job）</p>
        <p className="text-[10px] text-slate-400 mt-1">
          ※ システム上の店舗名は変更しません。口コミ・レポート・投稿用シートが全て店舗名で紐付いており、
          書き換えると過去データが行方不明になり自動投稿が止まるためです。GBP上の名前は別項目（GBP現在名）で保持します。
        </p>
      </div>
    </div>
  );
}
