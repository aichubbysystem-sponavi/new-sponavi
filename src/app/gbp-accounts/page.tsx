"use client";

import { useState, useEffect, useCallback } from "react";
import { useShop } from "@/components/shop-provider";
import { supabase } from "@/lib/supabase";
import api from "@/lib/api";

interface GbpAccount {
  id: string;
  account_id: string;
  email: string;
  type: number;
  created_at: string;
  location_count?: number;
}

export default function GbpAccountsPage() {
  const { apiConnected, shops } = useShop();
  const [accounts, setAccounts] = useState<GbpAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [importing, setImporting] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<any>(null);
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncProgress, setSyncProgress] = useState("");

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    // Go APIからアカウント一覧取得（system.accountsテーブル）
    try {
      const res = await api.get("/api/google/account");
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

    // フォールバック: Supabaseから直接取得
    try {
      const { data } = await supabase
        .from("system_oauth_tokens")
        .select("*")
        .order("created_at", { ascending: true });
      if (data && data.length > 0) {
        setAccounts(data.map((d: any, i: number) => ({
          id: String(i),
          account_id: d.account_id || "",
          email: d.email || d.google_email || `接続済みアカウント${i + 1}`,
          type: d.type || 1,
          created_at: d.created_at || "",
        })));
      } else {
        // DBにトークンがあれば接続済みとして表示
        setAccounts([{
          id: "0",
          account_id: "",
          email: "接続済みアカウント（Go API経由で管理）",
          type: 1,
          created_at: "",
        }]);
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
        setMsg("新しいタブでGoogleログイン画面が開きます。認証完了後、このページを更新してください。");
      } else {
        setMsg("OAuth URLの取得に失敗しました。Go APIが稼働しているか確認してください。");
      }
    } catch (e: any) {
      setMsg(`エラー: ${e?.response?.data?.message || e?.message || "OAuth URL取得失敗"}`);
    }
  };

  // アカウントの店舗をインポート
  const handleImport = async (accountEmail: string) => {
    setImporting(accountEmail);
    setImportResult(null);
    try {
      // GBPアカウント一覧（locationsネスト済み）を取得
      const accRes = await api.get("/api/gbp/account", { timeout: 120000 });
      const gbpAccounts = accRes.data || [];

      let totalImported = 0;
      let totalSkipped = 0;
      let totalErrors = 0;
      const existingNames = new Set(shops.map(s => s.gbp_location_name).filter(Boolean));

      // 既存店舗からowner_idを取得（必須フィールド）
      let defaultOwnerId = "";
      try {
        const ownerRes = await api.get("/api/owner", { timeout: 10000 });
        const owners = ownerRes.data?.owners || ownerRes.data || [];
        if (Array.isArray(owners) && owners.length > 0) {
          defaultOwnerId = owners[0].id || owners[0].ID || "";
        }
      } catch {}
      // owner_idが取れなければ既存店舗から推定
      if (!defaultOwnerId && shops.length > 0) {
        try {
          const shopRes = await api.get(`/api/shop/${shops[0].id}`, { timeout: 10000 });
          defaultOwnerId = shopRes.data?.owner_id || shopRes.data?.OwnerID || "";
        } catch {}
      }

      for (const gbpAcc of gbpAccounts) {
        const locations = gbpAcc.locations || [];
        if (locations.length === 0) continue;

        setMsg(`インポート中: ${gbpAcc.accountName || gbpAcc.name}（${locations.length}店舗）...`);

        // 5店舗ずつバッチ処理（レート制限対策: 60req/分）
        for (let i = 0; i < locations.length; i += 5) {
          if (i > 0) await new Promise(r => setTimeout(r, 6000)); // 6秒待機
          setMsg(`インポート中: ${gbpAcc.accountName || gbpAcc.name}（${i}/${locations.length}店舗完了）`);
          const batch = locations.slice(i, i + 5);
          for (const loc of batch) {
            const locName = loc.name || "";
            // locations/XXX形式を accounts/YYY/locations/XXX に変換
            const fullLocName = locName.startsWith("accounts/") ? locName
              : locName.startsWith("locations/") ? `${gbpAcc.name}/${locName}` : locName;

            if (existingNames.has(locName) || existingNames.has(fullLocName)) {
              totalSkipped++;
              continue;
            }

            try {
              await api.post("/api/shop", {
                name: loc.title || locName,
                gbp_location_name: fullLocName,
                gbp_shop_name: loc.title || "",
                owner_id: defaultOwnerId,
                state: loc.storefrontAddress?.administrativeArea || "未設定",
                city: loc.storefrontAddress?.locality || "未設定",
                address: (loc.storefrontAddress?.addressLines || []).join(" ") || "未設定",
                postal_code: (loc.storefrontAddress?.postalCode || "0000000").replace(/-/g, "").slice(0, 7).padEnd(7, "0"),
              });
              totalImported++;
              existingNames.add(locName);
              existingNames.add(fullLocName);
            } catch { totalErrors++; }
          }
        }
      }

      setImportResult({ imported: totalImported, skipped: totalSkipped, errors: totalErrors });
      setMsg(`インポート完了: ${totalImported}件追加 / ${totalSkipped}件スキップ（既存） / ${totalErrors}件エラー`);
    } catch (e: any) {
      setMsg(`インポート失敗: ${e?.message || "エラー"}`);
    }
    setImporting(null);
  };

  // 全アカウント一括同期（新店舗検出）
  const handleSyncAll = async () => {
    setSyncingAll(true);
    setSyncProgress("新店舗を検出中...");
    try {
      await handleImport("all");
    } catch {}
    setSyncingAll(false);
    setSyncProgress("");
  };

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">GBPアカウント管理</h1>
          <p className="text-sm text-slate-500 mt-1">Googleアカウントの接続・店舗インポート・新店舗自動検出</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleSyncAll} disabled={syncingAll}
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
            {syncingAll ? "同期中..." : "新店舗を検出"}
          </button>
          <button onClick={handleAddAccount}
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-[#003D6B] text-white hover:bg-[#002a4a]">
            + Googleアカウント追加
          </button>
        </div>
      </div>

      {msg && (
        <div className={`p-3 rounded-lg mb-4 text-sm ${msg.includes("失敗") || msg.includes("エラー") ? "bg-red-50 text-red-600 border border-red-200" : "bg-emerald-50 text-emerald-600 border border-emerald-200"}`}>
          {msg}
          {msg.includes("更新してください") && (
            <button onClick={() => { fetchAccounts(); setMsg(""); }}
              className="ml-3 px-3 py-1 rounded text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700">
              更新する
            </button>
          )}
        </div>
      )}

      {syncProgress && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-sm text-blue-700">{syncProgress}</div>
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
                <div className="flex gap-2">
                  <button onClick={() => handleImport(acc.email)} disabled={importing === acc.email}
                    className="px-4 py-2 rounded-lg text-xs font-semibold bg-blue-50 text-blue-600 hover:bg-blue-100 disabled:opacity-50">
                    {importing === acc.email ? "インポート中..." : "店舗インポート"}
                  </button>
                </div>
              </div>
              {importResult && importing === null && (
                <div className="mt-3 bg-slate-50 rounded-lg p-3 text-xs text-slate-600">
                  追加: {importResult.imported}件 / スキップ: {importResult.skipped}件 / エラー: {importResult.errors}件
                </div>
              )}
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
          <li>「店舗インポート」→ そのアカウントで管理している全店舗をシステムに登録</li>
          <li>「新店舗を検出」→ 全アカウントをスキャンして未登録の新店舗を自動追加</li>
        </ol>
        <p className="text-[10px] text-slate-400 mt-3">※ 毎日自動で新店舗検出が実行されます（Cron Job）</p>
      </div>
    </div>
  );
}
