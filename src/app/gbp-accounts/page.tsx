"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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

interface ImportProgress {
  phase: "scanning" | "importing" | "done" | "cancelled" | "error";
  total: number;
  processed: number;
  imported: number;
  skipped: number;
  errors: number;
  currentShop: string;
  errorDetails: string[];
}

export default function GbpAccountsPage() {
  const { apiConnected, shops, refreshShops } = useShop();
  const [accounts, setAccounts] = useState<GbpAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [msgType, setMsgType] = useState<"success" | "error" | "info">("info");
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const abortRef = useRef(false);

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

  // owner_id を安全に取得
  const getDefaultOwnerId = async (): Promise<string> => {
    // 1. Go API から owner 一覧
    try {
      const ownerRes = await api.get("/api/owner", { timeout: 10000 });
      const owners = ownerRes.data?.owners || ownerRes.data || [];
      if (Array.isArray(owners) && owners.length > 0) {
        const id = owners[0].id || owners[0].ID;
        if (id) return id;
      }
    } catch {}
    // 2. 既存店舗から推定
    if (shops.length > 0) {
      try {
        const shopRes = await api.get(`/api/shop/${shops[0].id}`, { timeout: 10000 });
        const id = shopRes.data?.owner_id || shopRes.data?.OwnerID;
        if (id) return id;
      } catch {}
    }
    // 3. Supabaseから直接取得
    try {
      const { data } = await supabase.from("owners").select("id").limit(1).maybeSingle();
      if (data?.id) return data.id;
    } catch {}
    return "";
  };

  // 店舗インポート（改善版）
  const handleImport = async () => {
    if (importing) return;
    setImporting(true);
    abortRef.current = false;

    const prog: ImportProgress = {
      phase: "scanning",
      total: 0,
      processed: 0,
      imported: 0,
      skipped: 0,
      errors: 0,
      currentShop: "",
      errorDetails: [],
    };
    setProgress({ ...prog });

    try {
      // ===== Phase 1: スキャン（GBPロケーション一覧取得）=====
      showMsg("GBPアカウントからロケーション一覧を取得中...", "info");

      const accRes = await api.get("/api/gbp/account", { timeout: 60000 });
      const gbpAccounts = accRes.data || [];

      if (!Array.isArray(gbpAccounts) || gbpAccounts.length === 0) {
        showMsg("GBPアカウントが見つかりません。Googleアカウントが接続されているか確認してください。", "error");
        setImporting(false);
        setProgress(null);
        return;
      }

      // 全ロケーションをフラットに収集
      const allLocations: { loc: any; accName: string }[] = [];
      for (const gbpAcc of gbpAccounts) {
        const locations = gbpAcc.locations || [];
        const accName = gbpAcc.accountName || gbpAcc.name || "不明";
        for (const loc of locations) {
          allLocations.push({ loc, accName });
        }
      }

      if (allLocations.length === 0) {
        showMsg("ロケーションが0件です。GBPアカウントに店舗が登録されているか確認してください。", "error");
        setImporting(false);
        setProgress(null);
        return;
      }

      // 既存店舗名セットを構築（Supabaseから最新を取得）
      // フルパス（accounts/XXX/locations/YYY）とロケーションID（locations/YYY）の両方を登録
      const existingNames = new Set<string>();
      const existingShopNames = new Set<string>(); // 店舗名でもマッチ
      const extractLocId = (name: string) => {
        const m = name.match(/(locations\/[^/]+)$/);
        return m ? m[1] : "";
      };
      try {
        const { data: dbShops } = await supabase
          .from("shops")
          .select("gbp_location_name, name, gbp_shop_name")
          .not("gbp_location_name", "is", null);
        (dbShops || []).forEach(s => {
          existingNames.add(s.gbp_location_name);
          // locations/YYY 部分も登録（マッチ精度向上）
          const locId = extractLocId(s.gbp_location_name);
          if (locId) existingNames.add(locId);
          if (s.name) existingShopNames.add(s.name);
          if (s.gbp_shop_name) existingShopNames.add(s.gbp_shop_name);
        });
      } catch {}
      // Context のshopsも追加
      shops.forEach(s => {
        if (s.gbp_location_name) {
          existingNames.add(s.gbp_location_name);
          const locId = extractLocId(s.gbp_location_name);
          if (locId) existingNames.add(locId);
        }
        if (s.name) existingShopNames.add(s.name);
        if (s.gbp_shop_name) existingShopNames.add(s.gbp_shop_name);
      });

      // 新規 vs 既存を事前判定
      const newLocations: { loc: any; accName: string; fullLocName: string }[] = [];
      let preSkipped = 0;

      for (const { loc, accName } of allLocations) {
        const locName = loc.name || "";
        const fullLocName = locName.startsWith("accounts/") ? locName
          : locName.startsWith("locations/") ? `${accName}/${locName}` : locName;
        const locId = extractLocId(locName) || extractLocId(fullLocName);
        const title = loc.title || "";

        // フルパス、ロケーションID、店舗名のいずれかでマッチすればスキップ
        if (!locName
          || existingNames.has(locName)
          || existingNames.has(fullLocName)
          || (locId && existingNames.has(locId))
          || (title && existingShopNames.has(title))
        ) {
          preSkipped++;
        } else {
          newLocations.push({ loc, accName, fullLocName });
        }
      }

      prog.total = newLocations.length;
      prog.skipped = preSkipped;
      prog.phase = "importing";
      setProgress({ ...prog });

      if (newLocations.length === 0) {
        prog.phase = "done";
        setProgress({ ...prog });
        showMsg(`全${allLocations.length}店舗が登録済みです。新規店舗はありません。`, "success");
        setImporting(false);
        return;
      }

      showMsg(`${allLocations.length}店舗中 ${newLocations.length}件が新規。インポートを開始します...`, "info");

      // ===== Phase 2: owner_id取得 =====
      const defaultOwnerId = await getDefaultOwnerId();
      if (!defaultOwnerId) {
        showMsg("オーナーが未登録です。先に「顧客マスタ」からオーナーを登録してください。", "error");
        setImporting(false);
        setProgress(null);
        return;
      }

      // ===== Phase 3: 新規店舗を並列バッチ登録 =====
      const BATCH_SIZE = 5; // 5件並列で処理（速度とレート制限のバランス）

      for (let i = 0; i < newLocations.length; i += BATCH_SIZE) {
        if (abortRef.current) {
          prog.phase = "cancelled";
          setProgress({ ...prog });
          showMsg(`インポートを中断しました。${prog.imported}件追加済み / ${prog.errors}件エラー`, "info");
          break;
        }

        const batch = newLocations.slice(i, i + BATCH_SIZE);

        // バッチ内を並列実行（各リクエスト15秒タイムアウト）
        const results = await Promise.allSettled(
          batch.map(async ({ loc, fullLocName }) => {
            const res = await Promise.race([
              api.post("/api/shop", {
                name: loc.title || loc.name || "",
                gbp_location_name: fullLocName,
                gbp_shop_name: loc.title || "",
                owner_id: defaultOwnerId,
                state: loc.storefrontAddress?.administrativeArea || "未設定",
                city: loc.storefrontAddress?.locality || "未設定",
                address: (loc.storefrontAddress?.addressLines || []).join(" ") || "未設定",
                postal_code: (loc.storefrontAddress?.postalCode || "0000000").replace(/-/g, "").slice(0, 7).padEnd(7, "0"),
              }, { timeout: 15000 }),
              new Promise((_, reject) => setTimeout(() => reject(new Error("タイムアウト(15秒)")), 16000)),
            ]);
            return { title: loc.title || fullLocName, res };
          })
        );

        for (let j = 0; j < results.length; j++) {
          prog.processed++;
          const r = results[j];
          if (r.status === "fulfilled") {
            prog.imported++;
            prog.currentShop = batch[j].loc.title || batch[j].fullLocName;
          } else {
            prog.errors++;
            const errMsg = (r.reason as any)?.response?.data?.message || (r.reason as any)?.message || "不明なエラー";
            if (prog.errorDetails.length < 10) {
              prog.errorDetails.push(`${batch[j].loc.title || batch[j].fullLocName}: ${errMsg}`);
            }
          }
        }

        setProgress({ ...prog });

        // レート制限対策: バッチ間で少し待機（最後のバッチは不要）
        if (i + BATCH_SIZE < newLocations.length && !abortRef.current) {
          await new Promise(r => setTimeout(r, 800));
        }
      }

      // ===== Phase 4: 完了 =====
      if (prog.phase !== "cancelled") {
        prog.phase = "done";
        setProgress({ ...prog });
      }

      const summary = `インポート完了: ${prog.imported}件追加 / ${prog.skipped}件スキップ（既存） / ${prog.errors}件エラー`;
      showMsg(summary, prog.errors > 0 ? "error" : "success");

      // ShopProviderのデータを更新
      if (prog.imported > 0) {
        try { refreshShops(); } catch {}
      }
    } catch (e: any) {
      prog.phase = "error";
      setProgress({ ...prog });
      const detail = e?.response?.data?.message || e?.message || "不明なエラー";
      showMsg(`インポート失敗: ${detail}`, "error");
    }
    setImporting(false);
  };

  // キャンセル
  const handleCancel = () => {
    abortRef.current = true;
    showMsg("キャンセル中... 現在のバッチ完了後に停止します。", "info");
  };

  // 進捗率
  const progressPercent = progress && progress.total > 0
    ? Math.round((progress.processed / progress.total) * 100)
    : 0;

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">GBPアカウント管理</h1>
          <p className="text-sm text-slate-500 mt-1">Googleアカウントの接続・店舗インポート・新店舗自動検出</p>
        </div>
        <div className="flex gap-2">
          {importing ? (
            <button onClick={handleCancel}
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-red-600 text-white hover:bg-red-700">
              中断する
            </button>
          ) : (
            <>
              <button onClick={handleImport} disabled={loading}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
                新店舗を検出・インポート
              </button>
              <button onClick={handleAddAccount}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-[#003D6B] text-white hover:bg-[#002a4a]">
                + Googleアカウント追加
              </button>
            </>
          )}
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

      {/* 進捗バー */}
      {progress && progress.phase !== "done" && progress.phase !== "error" && (
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-slate-700">
              {progress.phase === "scanning" ? "スキャン中..." :
               progress.phase === "importing" ? "インポート中..." :
               progress.phase === "cancelled" ? "中断済み" : "処理中..."}
            </span>
            {progress.total > 0 && (
              <span className="text-sm font-bold text-[#003D6B]">{progressPercent}%</span>
            )}
          </div>
          {progress.total > 0 && (
            <>
              <div className="w-full bg-slate-100 rounded-full h-3 mb-3">
                <div
                  className="bg-[#003D6B] h-3 rounded-full transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <div className="grid grid-cols-4 gap-3 text-center">
                <div>
                  <p className="text-lg font-bold text-slate-800">{progress.processed}<span className="text-xs text-slate-400">/{progress.total}</span></p>
                  <p className="text-[10px] text-slate-500">処理済み</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-emerald-600">{progress.imported}</p>
                  <p className="text-[10px] text-slate-500">追加</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-slate-400">{progress.skipped}</p>
                  <p className="text-[10px] text-slate-500">スキップ（既存）</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-red-500">{progress.errors}</p>
                  <p className="text-[10px] text-slate-500">エラー</p>
                </div>
              </div>
              {progress.currentShop && (
                <p className="text-[10px] text-slate-400 mt-2 truncate">最新: {progress.currentShop}</p>
              )}
            </>
          )}
        </div>
      )}

      {/* 完了結果 */}
      {progress && (progress.phase === "done" || progress.phase === "cancelled") && progress.total > 0 && (
        <div className={`rounded-xl p-5 shadow-sm border mb-4 ${
          progress.phase === "cancelled" ? "bg-amber-50 border-amber-200" : "bg-emerald-50 border-emerald-200"
        }`}>
          <h3 className="text-sm font-bold mb-3 text-slate-700">
            {progress.phase === "cancelled" ? "インポート中断" : "インポート完了"}
          </h3>
          <div className="grid grid-cols-4 gap-3 text-center">
            <div>
              <p className="text-xl font-bold text-slate-800">{progress.processed}<span className="text-xs text-slate-400">/{progress.total}</span></p>
              <p className="text-[10px] text-slate-500">処理済み</p>
            </div>
            <div>
              <p className="text-xl font-bold text-emerald-600">{progress.imported}</p>
              <p className="text-[10px] text-slate-500">追加</p>
            </div>
            <div>
              <p className="text-xl font-bold text-slate-400">{progress.skipped}</p>
              <p className="text-[10px] text-slate-500">スキップ</p>
            </div>
            <div>
              <p className="text-xl font-bold text-red-500">{progress.errors}</p>
              <p className="text-[10px] text-slate-500">エラー</p>
            </div>
          </div>
          {progress.errorDetails.length > 0 && (
            <div className="mt-3 bg-white rounded-lg p-3 border border-red-100">
              <p className="text-xs font-semibold text-red-600 mb-1">エラー詳細:</p>
              {progress.errorDetails.map((e, i) => (
                <p key={i} className="text-[10px] text-red-500 truncate">{e}</p>
              ))}
              {progress.errors > 10 && (
                <p className="text-[10px] text-red-400 mt-1">...他{progress.errors - 10}件</p>
              )}
            </div>
          )}
          <button onClick={() => setProgress(null)} className="mt-3 text-xs text-slate-500 hover:text-slate-700">閉じる</button>
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
          <li>「新店舗を検出・インポート」→ 全アカウントをスキャンして未登録店舗を自動追加</li>
          <li>途中で中断しても、追加済みの店舗は保持されます（再実行で残りを追加可能）</li>
        </ol>
        <p className="text-[10px] text-slate-400 mt-3">※ 毎日自動で新店舗検出が実行されます（Cron Job）</p>
      </div>
    </div>
  );
}
