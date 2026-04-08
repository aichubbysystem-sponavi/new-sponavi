"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import FeatureCard from "@/components/feature-card";
import { fuzzyMatch } from "@/lib/normalize";
import api from "@/lib/api";
import type { Shop } from "@/lib/api-types";

interface ShopRow {
  id: string;
  name: string;
  owner: string;
  agent: string;
  area: string;
  phone: string;
  gbpConnected: boolean;
  gbpShopName: string;
  rating: number;
  status: "active" | "paused" | "churned";
}

export default function ShopManagementPage() {
  const [shops, setShops] = useState<ShopRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<keyof ShopRow>("name");
  const [sortAsc, setSortAsc] = useState(true);
  const [editShop, setEditShop] = useState<ShopRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ShopRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [gbpLocations, setGbpLocations] = useState<{ name: string; title: string }[]>([]);
  const [importSelected, setImportSelected] = useState<Set<string>>(new Set());
  const [importLoading, setImportLoading] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [gbpAccountName, setGbpAccountName] = useState("");

  const fetchData = useCallback(async () => {
    try {
      const res = await api.get("/api/shop");
      const data: Shop[] = Array.isArray(res.data) ? res.data : [];
      setShops(data.map((s) => ({
        id: s.id,
        name: s.name,
        owner: s.owner?.name || "",
        agent: s.owner?.agent?.name || "（直接契約）",
        area: (s.owner?.state || s.state || "") + (s.owner?.city || s.city || ""),
        phone: s.owner?.phone || s.phone || "",
        gbpConnected: !!s.gbp_location_name,
        gbpShopName: s.gbp_shop_name || "",
        rating: 0,
        status: "active" as const,
      })));
    } catch { setError("API接続エラー"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openImport = async () => {
    setShowImport(true);
    setImportMsg("");
    setImportSelected(new Set());
    setGbpLocations([]);
    setImportLoading(true);
    try {
      // オーナー一覧取得
      const ownerRes = await api.get("/api/owner");
      const owners = Array.isArray(ownerRes.data) ? ownerRes.data : [];
      if (owners.length === 0) { setImportMsg("オーナーを先に登録してください"); setImportLoading(false); return; }
      const oId = owners[0].id;
      setOwnerId(oId);
      // GBPアカウント名を取得（business_groupから）
      const ownerDetail = await api.get(`/api/owner/${oId}`);
      const bgGroups = ownerDetail.data?.business_groups || ownerDetail.data?.BusinessGroups || [];
      const accName = bgGroups[0]?.gbp_account_name || bgGroups[0]?.GbpAccountName || "";
      setGbpAccountName(accName);
      // 未紐付けロケーション取得
      const locRes = await api.get(`/api/owner/${oId}/location?is_associated=0`);
      const locs = Array.isArray(locRes.data) ? locRes.data : [];
      setGbpLocations(locs);
      if (locs.length === 0) setImportMsg("全てのGBPロケーションが紐付け済みです");
    } catch { setImportMsg("GBPロケーションの取得に失敗しました。GBPアカウントが紐付けられているか確認してください。"); }
    finally { setImportLoading(false); }
  };

  const handleImport = async () => {
    if (importSelected.size === 0 || !ownerId) return;
    setImportLoading(true); setImportMsg("");
    try {
      // locations/XXX → accounts/YYY/locations/XXX 形式に変換
      const allNames = Array.from(importSelected).map(name => {
        if (name.startsWith("accounts/")) return name;
        if (gbpAccountName && name.startsWith("locations/")) return `${gbpAccountName}/${name}`;
        return name;
      });
      // 20店舗ずつバッチ処理（タイムアウト対策）
      const batchSize = 20;
      let imported = 0;
      for (let i = 0; i < allNames.length; i += batchSize) {
        const batch = allNames.slice(i, i + batchSize);
        setImportMsg(`インポート中... ${imported}/${allNames.length}店舗完了`);
        await api.post(`/api/owner/${ownerId}/location/associate`, { location_names: batch }, { timeout: 60000 });
        imported += batch.length;
      }
      setImportMsg(`${imported}店舗をインポートしました！`);
      setImportSelected(new Set());
      await fetchData();
      setTimeout(() => setShowImport(false), 2000);
    } catch (e: any) {
      const detail = e?.response?.data ? JSON.stringify(e.response.data) : e?.message || "";
      setImportMsg(`インポートに失敗しました: ${detail}`);
    }
    finally { setImportLoading(false); }
  };

  const filtered = useMemo(() => {
    let r = shops.filter((row) => !searchQuery || fuzzyMatch(searchQuery, row.id, row.name, row.owner, row.agent, row.area, row.phone, row.gbpShopName));
    r.sort((a, b) => sortAsc ? String(a[sortKey]).localeCompare(String(b[sortKey]), "ja") : String(b[sortKey]).localeCompare(String(a[sortKey]), "ja"));
    return r;
  }, [shops, searchQuery, sortKey, sortAsc]);

  const hs = (k: keyof ShopRow) => { if (sortKey === k) setSortAsc(!sortAsc); else { setSortKey(k); setSortAsc(true); } };
  const si = (k: keyof ShopRow) => sortKey !== k ? "↕" : sortAsc ? "↑" : "↓";

  const counts = { total: shops.length, active: shops.filter(s => s.status === "active").length, gbp: shops.filter(s => s.gbpConnected).length };

  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">店舗管理</h1>
        <p className="text-slate-500 text-sm mt-1">全店舗の登録・編集・GBP紐付け・グループ管理</p>
      </div>

      <div className="grid grid-cols-5 gap-4 mb-6">
        {[
          { label: "全店舗", value: counts.total, color: "#003D6B" },
          { label: "稼働中", value: counts.active, color: "#16a34a" },
          { label: "GBP接続済", value: counts.gbp, color: "#3b82f6" },
          { label: "検索結果", value: filtered.length, color: "#8b5cf6" },
          { label: "データソース", value: "API", color: "#16a34a", isText: true },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
            <p className="text-xs text-slate-500">{s.label}</p>
            {"isText" in s ? <p className="text-sm font-bold mt-2" style={{ color: s.color }}>● APIリアルタイム</p> : <p className="text-2xl font-bold mt-1" style={{ color: s.color }}>{s.value}</p>}
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm mb-4">
        <div className="flex items-center gap-3">
          <div className="flex-1 relative">
            <input className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#003D6B]/30" placeholder="店舗名・ID・オーナー・エリア・電話番号で検索（全角/半角OK）" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            {searchQuery && <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-lg">×</button>}
          </div>
          <button onClick={openImport} className="bg-emerald-600 text-xs px-4 py-2 rounded-lg hover:bg-emerald-700 flex-shrink-0" style={{ color: "#fff" }}>GBPから店舗インポート</button>
        </div>
        {searchQuery && <p className="text-xs text-slate-500 mt-2">「{searchQuery}」— {filtered.length}件</p>}
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="bg-white rounded-xl p-12 border border-slate-200 text-center"><p className="text-slate-500">APIからデータを読み込み中...</p></div>
      ) : (
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-slate-200">
                <th className="text-left py-3 px-2 cursor-pointer" onClick={() => hs("id")}>ID {si("id")}</th>
                <th className="text-left py-3 px-2 cursor-pointer" onClick={() => hs("name")}>店舗名 {si("name")}</th>
                <th className="text-left py-3 px-2 cursor-pointer" onClick={() => hs("owner")}>オーナー {si("owner")}</th>
                <th className="text-center py-3 px-2 cursor-pointer" onClick={() => hs("area")}>エリア {si("area")}</th>
                <th className="text-left py-3 px-2">電話番号</th>
                <th className="text-center py-3 px-2">GBP</th>
                <th className="text-center py-3 px-2">ステータス</th>
                <th className="text-center py-3 px-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} className="py-12 text-center text-slate-400">
                  {shops.length === 0 ? "店舗が登録されていません" : "該当する店舗が見つかりません"}
                </td></tr>
              ) : filtered.map((shop) => (
                <tr key={shop.id} className="border-b border-slate-100 hover:bg-slate-50 transition">
                  <td className="py-3 px-2 text-[#003D6B] font-mono text-xs">{shop.id.substring(0, 12)}...</td>
                  <td className="py-3 px-2 font-medium text-[#003D6B]">{shop.name}</td>
                  <td className="py-3 px-2 text-slate-600 text-xs">
                    <div>{shop.owner}</div>
                    {shop.agent !== "（直接契約）" && <div className="text-[10px] text-slate-400">via {shop.agent}</div>}
                  </td>
                  <td className="py-3 px-2 text-center text-slate-600 text-xs">{shop.area}</td>
                  <td className="py-3 px-2 text-slate-500 text-xs">{shop.phone}</td>
                  <td className="py-3 px-2 text-center text-xs">
                    {shop.gbpConnected ? <span className="text-green-600">● 接続済</span> : <span className="text-slate-400">○ 未接続</span>}
                  </td>
                  <td className="py-3 px-2 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      shop.status === "active" ? "bg-green-50 text-green-700" :
                      shop.status === "paused" ? "bg-yellow-50 text-yellow-700" :
                      "bg-red-50 text-red-700"
                    }`}>
                      {shop.status === "active" ? "稼働中" : shop.status === "paused" ? "一時停止" : "解約済"}
                    </span>
                  </td>
                  <td className="py-3 px-2 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => setEditShop(shop)} className="text-[10px] px-2 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 transition">編集</button>
                      <button onClick={() => setDeleteTarget(shop)} className="text-[10px] px-2 py-1 bg-red-50 text-red-600 rounded hover:bg-red-100 transition">削除</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 編集モーダル */}
      {editShop && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setEditShop(null)}>
          <div className="bg-white rounded-xl p-6 w-[500px] max-h-[80vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">店舗情報を編集</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">店舗名</label>
                <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={editShop.name} onChange={(e) => setEditShop({ ...editShop, name: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">電話番号</label>
                <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={editShop.phone} onChange={(e) => setEditShop({ ...editShop, phone: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">ステータス</label>
                <select className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={editShop.status} onChange={(e) => setEditShop({ ...editShop, status: e.target.value as ShopRow["status"] })}>
                  <option value="active">稼働中</option>
                  <option value="paused">一時停止</option>
                  <option value="churned">解約済</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  try {
                    await api.put(`/api/shop/${editShop.id}`, { name: editShop.name, phone: editShop.phone });
                    await fetchData();
                    setEditShop(null);
                  } catch { setError("更新に失敗しました"); }
                  finally { setSaving(false); }
                }}
                className="flex-1 bg-[#003D6B] text-white py-2 rounded-lg text-sm font-medium hover:bg-[#002a4a] transition disabled:opacity-50"
              >
                {saving ? "保存中..." : "保存"}
              </button>
              <button onClick={() => setEditShop(null)} className="px-4 py-2 border border-slate-200 rounded-lg text-sm hover:bg-slate-50 transition">キャンセル</button>
            </div>
          </div>
        </div>
      )}

      {/* 削除確認モーダル */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setDeleteTarget(null)}>
          <div className="bg-white rounded-xl p-6 w-[400px] shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-red-600 mb-2">店舗を削除</h3>
            <p className="text-sm text-slate-600 mb-1">以下の店舗を削除しますか？</p>
            <p className="text-sm font-bold text-slate-800 mb-4">{deleteTarget.name}</p>
            <p className="text-xs text-red-500 mb-6">この操作は取り消せません。関連するデータも全て削除されます。</p>
            <div className="flex gap-2">
              <button
                disabled={saving}
                onClick={async () => {
                  setSaving(true); setError("");
                  try {
                    await api.delete(`/api/shop/${deleteTarget.id}`);
                    await fetchData();
                    setDeleteTarget(null);
                  } catch (e: any) {
                    const detail = e?.response?.data?.message || e?.response?.data ? JSON.stringify(e.response.data) : "不明なエラー";
                    setError(`削除に失敗しました: ${detail}`);
                    setDeleteTarget(null);
                  } finally { setSaving(false); }
                }}
                className="flex-1 bg-red-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-red-700 transition disabled:opacity-50"
              >
                {saving ? "削除中..." : "削除する"}
              </button>
              <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 border border-slate-200 rounded-lg text-sm hover:bg-slate-50 transition">キャンセル</button>
            </div>
          </div>
        </div>
      )}

      {/* GBPインポートモーダル */}
      {showImport && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowImport(false)}>
          <div className="bg-white rounded-xl p-6 w-[600px] max-h-[80vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-2">GBPから店舗をインポート</h3>
            <p className="text-xs text-slate-500 mb-4">GBPに登録されている店舗を選択してインポートします。店舗名・住所・電話番号がGBPから自動取得されます。</p>

            {importMsg && (
              <div className={`p-3 rounded-lg mb-4 text-sm ${importMsg.includes("失敗") || importMsg.includes("先に") ? "bg-red-50 text-red-700 border border-red-200" : "bg-emerald-50 text-emerald-700 border border-emerald-200"}`}>
                {importMsg}
              </div>
            )}

            {importLoading ? (
              <div className="py-12 text-center text-slate-500 text-sm">GBPロケーションを読み込み中...</div>
            ) : gbpLocations.length > 0 ? (
              <>
                <div className="flex items-center justify-between mb-3">
                  <button
                    onClick={() => {
                      if (importSelected.size === gbpLocations.length) setImportSelected(new Set());
                      else setImportSelected(new Set(gbpLocations.map(l => l.name)));
                    }}
                    className="text-xs text-[#003D6B] hover:underline font-medium"
                  >
                    {importSelected.size === gbpLocations.length ? "全解除" : `全選択 (${gbpLocations.length}件)`}
                  </button>
                  <span className="text-xs text-slate-400">{importSelected.size}件選択中</span>
                </div>
                <div className="border border-slate-200 rounded-lg overflow-hidden mb-4 max-h-[400px] overflow-y-auto">
                  {gbpLocations.map((loc) => (
                    <label key={loc.name} className={`flex items-center gap-3 px-4 py-3 border-b border-slate-50 cursor-pointer hover:bg-slate-50 transition ${importSelected.has(loc.name) ? "bg-blue-50" : ""}`}>
                      <input
                        type="checkbox"
                        checked={importSelected.has(loc.name)}
                        onChange={() => {
                          const next = new Set(importSelected);
                          if (next.has(loc.name)) next.delete(loc.name); else next.add(loc.name);
                          setImportSelected(next);
                        }}
                        className="w-4 h-4 rounded border-slate-300"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-800">{loc.title}</p>
                        <p className="text-[10px] text-slate-400 truncate">{loc.name}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </>
            ) : null}

            <div className="flex justify-end gap-3">
              <button onClick={() => setShowImport(false)} className="text-sm px-4 py-2 rounded-lg border border-slate-200 hover:bg-slate-50">閉じる</button>
              {gbpLocations.length > 0 && (
                <button
                  onClick={handleImport}
                  disabled={importSelected.size === 0 || importLoading}
                  className="text-sm px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"
                  style={{ color: "#fff" }}
                >
                  {importLoading ? "インポート中..." : `${importSelected.size}店舗をインポート`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <h2 className="text-lg font-bold mb-4">機能一覧</h2>
      <div className="grid grid-cols-2 gap-4">
        <FeatureCard title="店舗の登録・編集・削除" description="GBPロケーションとの紐付け、優先度設定も管理。" icon="🏠" />
        <FeatureCard title="店舗グループ管理" description="系列店・エリア別など任意のグループで分類。" icon="📂" />
        <FeatureCard title="GBPアカウント・ロケーション関連付け" description="GoogleアカウントとGBPロケーションを紐付け。" icon="🔗" />
        <FeatureCard title="店舗ダッシュボード" description="店舗ごとのKPI一覧画面。" icon="📊" />
        <FeatureCard title="全店舗一覧・検索・フィルタ" description="500+店舗を各条件で絞り込み検索。" icon="🔍" />
        <FeatureCard title="店舗切り替え" description="代理店→オーナー→店舗をドリルダウンで切り替え。" icon="🔄" />
      </div>
    </div>
  );
}
