"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import FeatureCard from "@/components/feature-card";
import { fuzzyMatch } from "@/lib/normalize";
import api from "@/lib/api";
import type { Shop, Owner } from "@/lib/api-types";

interface MasterRow { shopId: string; shopName: string; ownerName: string; agentName: string; city: string; state: string; phone: string; gbpConnected: boolean; }

export default function CustomerMasterPage() {
  const [shops, setShops] = useState<MasterRow[]>([]);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<keyof MasterRow>("shopName");
  const [sortAsc, setSortAsc] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showOwnerModal, setShowOwnerModal] = useState(false);
  const [formData, setFormData] = useState({ owner_id: "", name: "", postal_code: "", state: "", city: "", address: "", building: "", phone: "" });
  const [ownerForm, setOwnerForm] = useState({ name: "", postal_code: "", state: "", city: "", address: "", building: "", phone: "" });
  const [submitting, setSubmitting] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [shopRes, ownerRes] = await Promise.all([api.get("/api/shop"), api.get("/api/owner")]);
      const shopData: Shop[] = Array.isArray(shopRes.data) ? shopRes.data : [];
      const ownerData: Owner[] = Array.isArray(ownerRes.data) ? ownerRes.data : [];
      setOwners(ownerData);
      setShops(shopData.map((s) => ({ shopId: s.id, shopName: s.name, ownerName: s.owner?.name || "", agentName: s.owner?.agent?.name || "（直接契約）", city: s.owner?.city || s.city || "", state: s.owner?.state || s.state || "", phone: s.owner?.phone || s.phone || "", gbpConnected: !!s.gbp_location_name })));
    } catch { setError("API接続エラー"); } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCreate = async () => {
    if (!formData.name || !formData.owner_id) { setError("店舗名とオーナーは必須です"); return; }
    setSubmitting(true); setError("");
    try {
      const res = await api.post("/api/shop", formData);
      if (res.data?.id) {
        setShowModal(false);
        setFormData({ owner_id: "", name: "", postal_code: "", state: "", city: "", address: "", building: "", phone: "" });
        setSuccess("店舗を登録しました");
        setTimeout(() => setSuccess(""), 3000);
        await fetchData();
      }
    } catch (e: unknown) {
      if (e && typeof e === "object" && "response" in e) {
        const axiosErr = e as { response?: { data?: Record<string, string> } };
        const data = axiosErr.response?.data;
        if (data && typeof data === "object") {
          const msgs = Object.values(data).join("、");
          setError(msgs);
        } else {
          setError("店舗の登録に失敗しました");
        }
      } else {
        setError("店舗の登録に失敗しました");
      }
    }
    finally { setSubmitting(false); }
  };

  const handleCreateOwner = async () => {
    if (!ownerForm.name) { setError("オーナー名は必須です"); return; }
    setSubmitting(true); setError("");
    try {
      const res = await api.post("/api/owner", ownerForm);
      if (res.data?.id) {
        setShowOwnerModal(false);
        setOwnerForm({ name: "", postal_code: "", state: "", city: "", address: "", building: "", phone: "" });
        setSuccess("オーナーを登録しました");
        setTimeout(() => setSuccess(""), 3000);
        await fetchData();
      }
    } catch { setError("オーナーの登録に失敗しました"); }
    finally { setSubmitting(false); }
  };

  const handleDelete = async (shopId: string, shopName: string) => {
    if (!confirm(`「${shopName}」を削除しますか？`)) return;
    try {
      await api.delete(`/api/shop/${shopId}`);
      setSuccess(`「${shopName}」を削除しました`);
      setTimeout(() => setSuccess(""), 3000);
      await fetchData();
    } catch { setError("削除に失敗しました"); }
  };

  const filtered = useMemo(() => {
    let r = shops.filter((row) => !searchQuery || fuzzyMatch(searchQuery, row.shopId, row.shopName, row.ownerName, row.agentName, row.city, row.state, row.phone));
    r.sort((a, b) => sortAsc ? String(a[sortKey]).localeCompare(String(b[sortKey]), "ja") : String(b[sortKey]).localeCompare(String(a[sortKey]), "ja"));
    return r;
  }, [shops, searchQuery, sortKey, sortAsc]);

  const hs = (k: keyof MasterRow) => { if (sortKey === k) setSortAsc(!sortAsc); else { setSortKey(k); setSortAsc(true); } };
  const si = (k: keyof MasterRow) => sortKey !== k ? "↕" : sortAsc ? "↑" : "↓";

  return (<div className="animate-fade-in">
    <div className="mb-6"><h1 className="text-2xl font-bold">顧客マスタ</h1><p className="text-slate-500 text-sm mt-1">shop_idで全システムを統合管理</p></div>
    <div className="grid grid-cols-4 gap-4 mb-6">
      <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm"><p className="text-xs text-slate-500">全店舗</p><p className="text-2xl font-bold text-[#003D6B] mt-1">{shops.length}</p></div>
      <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm"><p className="text-xs text-slate-500">GBP接続済</p><p className="text-2xl font-bold text-green-600 mt-1">{shops.filter(s => s.gbpConnected).length}</p></div>
      <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm"><p className="text-xs text-slate-500">検索結果</p><p className="text-2xl font-bold text-blue-600 mt-1">{filtered.length}</p></div>
      <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm"><p className="text-xs text-slate-500">データソース</p><p className="text-sm font-bold text-green-600 mt-2">● APIリアルタイム</p></div>
    </div>
    <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm mb-4"><div className="flex items-center gap-3">
      <div className="flex-1 relative"><input className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#003D6B]/30" placeholder="店舗名・ID・オーナー・エリア・電話で検索（全角/半角OK）" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
        {searchQuery && <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-lg">×</button>}</div>
      <button onClick={() => setShowOwnerModal(true)} className="bg-emerald-600 text-xs px-4 py-2 rounded-lg hover:bg-emerald-700" style={{ color: "#fff" }}>+ オーナー追加</button>
      <button onClick={() => { setShowModal(true); if (owners.length > 0 && !formData.owner_id) setFormData({...formData, owner_id: owners[0].id}); }} className="bg-[#003D6B] text-xs px-4 py-2 rounded-lg hover:bg-[#002a4a]" style={{ color: "#fff" }}>+ 店舗登録</button>
    </div>{searchQuery && <p className="text-xs text-slate-500 mt-2">「{searchQuery}」— {filtered.length}件</p>}</div>
    {success && <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4 text-sm text-green-700">{success}</div>}
    {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4 text-sm text-red-700">{error}</div>}
    {showModal && (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowModal(false)}>
        <div className="bg-white rounded-xl p-6 w-[500px] shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <h3 className="text-lg font-bold mb-4">新規店舗登録</h3>
          <div className="space-y-3">
            <div><label className="text-xs text-slate-500 block mb-1">オーナー *</label>
              <select className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={formData.owner_id} onChange={(e) => setFormData({...formData, owner_id: e.target.value})}>
                <option value="">選択してください</option>
                {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select></div>
            <div><label className="text-xs text-slate-500 block mb-1">店舗名 *</label>
              <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="例: サンプル食堂 渋谷店" value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-slate-500 block mb-1">郵便番号</label>
                <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="1500001" value={formData.postal_code} onChange={(e) => setFormData({...formData, postal_code: e.target.value})} /></div>
              <div><label className="text-xs text-slate-500 block mb-1">電話番号</label>
                <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="03-1234-5678" value={formData.phone} onChange={(e) => setFormData({...formData, phone: e.target.value})} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-slate-500 block mb-1">都道府県</label>
                <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="東京都" value={formData.state} onChange={(e) => setFormData({...formData, state: e.target.value})} /></div>
              <div><label className="text-xs text-slate-500 block mb-1">市区町村</label>
                <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="渋谷区" value={formData.city} onChange={(e) => setFormData({...formData, city: e.target.value})} /></div>
            </div>
            <div><label className="text-xs text-slate-500 block mb-1">住所</label>
              <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="渋谷1-1-1" value={formData.address} onChange={(e) => setFormData({...formData, address: e.target.value})} /></div>
            <div><label className="text-xs text-slate-500 block mb-1">建物名</label>
              <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="サンプルビル3F" value={formData.building} onChange={(e) => setFormData({...formData, building: e.target.value})} /></div>
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <button onClick={() => setShowModal(false)} className="text-sm px-4 py-2 rounded-lg border border-slate-200 hover:bg-slate-50">キャンセル</button>
            <button onClick={handleCreate} disabled={submitting} className="text-sm px-4 py-2 rounded-lg bg-[#003D6B] hover:bg-[#002a4a] disabled:opacity-50" style={{ color: "#fff" }}>{submitting ? "登録中..." : "登録する"}</button>
          </div>
        </div>
      </div>
    )}
    {showOwnerModal && (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowOwnerModal(false)}>
        <div className="bg-white rounded-xl p-6 w-[440px] shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <h3 className="text-lg font-bold mb-4">新規オーナー登録</h3>
          <div className="space-y-3">
            <div><label className="text-xs text-slate-500 block mb-1">オーナー名 *</label>
              <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="例: 株式会社〇〇" value={ownerForm.name} onChange={(e) => setOwnerForm({...ownerForm, name: e.target.value})} /></div>
            <div><label className="text-xs text-slate-500 block mb-1">メモ</label>
              <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="備考（任意）" value={ownerForm.building} onChange={(e) => setOwnerForm({...ownerForm, building: e.target.value})} /></div>
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <button onClick={() => setShowOwnerModal(false)} className="text-sm px-4 py-2 rounded-lg border border-slate-200 hover:bg-slate-50">キャンセル</button>
            <button onClick={handleCreateOwner} disabled={submitting} className="text-sm px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50" style={{ color: "#fff" }}>{submitting ? "登録中..." : "登録する"}</button>
          </div>
        </div>
      </div>
    )}
    {loading ? <div className="bg-white rounded-xl p-12 border border-slate-200 text-center"><p className="text-slate-500">APIからデータを読み込み中...</p></div> : (
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm mb-6"><table className="w-full text-sm"><thead><tr className="border-b-2 border-slate-200">
        <th className="text-left py-3 px-2 cursor-pointer" onClick={() => hs("shopId")}>shop_id {si("shopId")}</th>
        <th className="text-left py-3 px-2 cursor-pointer" onClick={() => hs("shopName")}>店舗名 {si("shopName")}</th>
        <th className="text-left py-3 px-2 cursor-pointer" onClick={() => hs("ownerName")}>オーナー {si("ownerName")}</th>
        <th className="text-left py-3 px-2 cursor-pointer" onClick={() => hs("agentName")}>代理店 {si("agentName")}</th>
        <th className="text-left py-3 px-2 cursor-pointer" onClick={() => hs("city")}>エリア {si("city")}</th>
        <th className="text-left py-3 px-2">電話</th>
        <th className="text-center py-3 px-2">GBP</th>
        <th className="text-center py-3 px-2">状態</th>
        <th className="text-center py-3 px-2">操作</th>
      </tr></thead><tbody>
        {filtered.length === 0 ? <tr><td colSpan={9} className="py-12 text-center text-slate-400">{shops.length === 0 ? "店舗が登録されていません" : "該当なし"}</td></tr> : filtered.map((row) => (
          <tr key={row.shopId} className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer">
            <td className="py-3 px-2 text-[#003D6B] font-mono text-xs">{row.shopId}</td>
            <td className="py-3 px-2 font-medium text-[#003D6B]">{row.shopName}</td>
            <td className="py-3 px-2 text-slate-600 text-xs">{row.ownerName}</td>
            <td className="py-3 px-2 text-slate-500 text-xs">{row.agentName}</td>
            <td className="py-3 px-2 text-slate-600 text-xs">{row.state}{row.city}</td>
            <td className="py-3 px-2 text-slate-500 text-xs">{row.phone}</td>
            <td className="py-3 px-2 text-center text-xs">{row.gbpConnected ? <span className="text-green-600">● 接続済</span> : <span className="text-slate-400">○ 未接続</span>}</td>
            <td className="py-3 px-2 text-center text-xs text-green-600 font-medium">● 稼働</td>
            <td className="py-3 px-2 text-center"><button onClick={() => handleDelete(row.shopId, row.shopName)} className="text-xs text-red-400 hover:text-red-600">削除</button></td>
          </tr>))}
      </tbody></table></div>)}
    <h2 className="text-lg font-bold mb-4">機能一覧</h2>
    <div className="grid grid-cols-2 gap-4">
      <FeatureCard title="顧客マスタ（shop_id統合管理）" description="全システム共通のshop_idで500+店舗を統合管理。" icon="🗂️" />
      <FeatureCard title="スプレッドシート一括更新" description="マスタ変更時に100+シートをSheets APIで一括更新。" icon="📊" />
      <FeatureCard title="解約時自動バックアップ・復元" description="解約ステータス変更→GBP自動バックアップ→復元。" icon="🔄" />
    </div>
  </div>);
}
