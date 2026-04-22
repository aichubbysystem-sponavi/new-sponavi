"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { fuzzyMatch } from "@/lib/normalize";
import api from "@/lib/api";
import type { Shop, Owner } from "@/lib/api-types";

// モーダルをbody直下にレンダリング（fixedが確実に効く）
function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[9999]" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>,
    document.body
  );
}

interface MasterRow {
  shopId: string; shopName: string; ownerName: string; agentName: string;
  city: string; state: string; phone: string; gbpConnected: boolean;
  service: "meo" | "pmax" | "both" | "none";
  reviewCount: number;
  status: "active" | "paused" | "churned";
}

type FilterService = "all" | "meo" | "pmax" | "both" | "none";

export default function CustomerMasterPage() {
  const [shops, setShops] = useState<MasterRow[]>([]);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterService, setFilterService] = useState<FilterService>("all");
  const [filterGbp, setFilterGbp] = useState<"all" | "connected" | "disconnected">("all");
  const [sortKey, setSortKey] = useState<keyof MasterRow>("shopName");
  const [sortAsc, setSortAsc] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showOwnerModal, setShowOwnerModal] = useState(false);
  const [formData, setFormData] = useState({ owner_id: "", name: "", postal_code: "", state: "", city: "", address: "", building: "", phone: "" });
  const [ownerForm, setOwnerForm] = useState({ name: "", postal_code: "", state: "", city: "", address: "", building: "", phone: "" });
  const [submitting, setSubmitting] = useState(false);
  const [customerData, setCustomerData] = useState<Map<string, { name: string; service: "meo" | "pmax" | "both" | "none" }>>(new Map());

  // ── 店舗編集モーダル ──
  const [editShop, setEditShop] = useState<MasterRow | null>(null);
  const [saving, setSaving] = useState(false);

  // ── GBPインポート ──
  const [showImport, setShowImport] = useState(false);
  const [gbpLocations, setGbpLocations] = useState<{ name: string; title: string }[]>([]);
  const [importSelected, setImportSelected] = useState<Set<string>>(new Set());
  const [importLoading, setImportLoading] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [gbpAccountName, setGbpAccountName] = useState("");

  const fetchData = useCallback(async () => {
    try {
      const [shopRes, ownerRes, custRes] = await Promise.all([
        api.get("/api/shop"),
        api.get("/api/owner"),
        fetch("/api/report/customer-sheet").then(r => r.ok ? r.json() : { customers: [] }).catch(() => ({ customers: [] })),
      ]);
      const shopData: Shop[] = Array.isArray(shopRes.data) ? shopRes.data : [];
      const ownerData: Owner[] = Array.isArray(ownerRes.data) ? ownerRes.data : [];
      setOwners(ownerData);

      // 顧客シートデータをマップに変換
      const custMap = new Map<string, { name: string; service: "meo" | "pmax" | "both" | "none" }>();
      for (const c of (custRes.customers || [])) {
        custMap.set(c.key, { name: c.name, service: c.service });
      }
      setCustomerData(custMap);

      setShops(shopData.map((s) => {
        const shopName = s.name || "";
        const key = shopName.replace(/\s+/g, " ").trim().toLowerCase();
        let service: "meo" | "pmax" | "both" | "none" = "none";
        // 完全一致チェック
        if (custMap.has(key)) {
          service = custMap.get(key)!.service;
        } else {
          // 部分一致
          for (const [k, v] of Array.from(custMap.entries())) {
            if (k.length >= 3 && key.length >= 3 && (key.includes(k) || k.includes(key))) {
              service = v.service;
              break;
            }
          }
        }
        return {
          shopId: s.id,
          shopName,
          ownerName: s.owner?.name || "",
          agentName: s.owner?.agent?.name || "（直接契約）",
          city: s.city || "",
          state: s.state || "",
          phone: s.phone || "",
          gbpConnected: !!s.gbp_location_name,
          service,
          reviewCount: 0,
          status: "active" as const,
        };
      }));
    } catch { setError("API接続エラー"); } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCreate = async () => {
    if (!formData.name || !formData.owner_id) { setError("店舗名とオーナーは必須です"); return; }
    setSubmitting(true); setError("");
    try {
      const res = await api.post("/api/shop", formData);
      if (res.data?.id) { setShowModal(false); setFormData({ owner_id: "", name: "", postal_code: "", state: "", city: "", address: "", building: "", phone: "" }); setSuccess("店舗を登録しました"); setTimeout(() => setSuccess(""), 3000); await fetchData(); }
    } catch (e: any) { setError(e?.response?.data ? Object.values(e.response.data).join("、") : "店舗の登録に失敗しました"); }
    finally { setSubmitting(false); }
  };

  const handleCreateOwner = async () => {
    if (!ownerForm.name) { setError("オーナー名は必須です"); return; }
    setSubmitting(true); setError("");
    try {
      const res = await api.post("/api/owner", ownerForm);
      if (res.data?.id) { setShowOwnerModal(false); setOwnerForm({ name: "", postal_code: "", state: "", city: "", address: "", building: "", phone: "" }); setSuccess("オーナーを登録しました"); setTimeout(() => setSuccess(""), 3000); await fetchData(); }
    } catch { setError("オーナーの登録に失敗しました"); }
    finally { setSubmitting(false); }
  };

  const handleDelete = async (shopId: string, shopName: string) => {
    if (!confirm(`「${shopName}」を削除しますか？\n\nこの操作は取り消せません。関連するデータも全て削除されます。`)) return;
    try { await api.delete(`/api/shop/${shopId}`); setSuccess(`「${shopName}」を削除しました`); setTimeout(() => setSuccess(""), 3000); await fetchData(); }
    catch { setError("削除に失敗しました"); }
  };

  // ── ロケーション解除 ──
  const handleUnlinkGbp = async (shopId: string, shopName: string) => {
    if (!confirm(`「${shopName}」のビジネスロケーション連携を解除しますか？\n\n※ GBP側の情報は削除されません。\n※ システム上の紐付け（gbp_location_name）のみクリアされます。`)) return;
    try {
      await api.put(`/api/shop/${shopId}`, { gbp_location_name: "" });
      setSuccess(`「${shopName}」のGBP連携を解除しました`);
      setTimeout(() => setSuccess(""), 3000);
      await fetchData();
    } catch (e: any) {
      setError(`ロケーション解除失敗: ${e?.response?.data?.message || e?.message || "エラー"}`);
    }
  };

  // ── 店舗編集保存 ──
  const handleEditSave = async () => {
    if (!editShop) return;
    setSaving(true); setError("");
    try {
      await api.put(`/api/shop/${editShop.shopId}`, { name: editShop.shopName, phone: editShop.phone });
      setSuccess("店舗情報を更新しました");
      setTimeout(() => setSuccess(""), 3000);
      await fetchData();
      setEditShop(null);
    } catch { setError("更新に失敗しました"); }
    finally { setSaving(false); }
  };

  // ── GBPインポート ──
  const openImport = async () => {
    setShowImport(true);
    setImportMsg("");
    setImportSelected(new Set());
    setGbpLocations([]);
    setImportLoading(true);
    try {
      const ownerRes = await api.get("/api/owner");
      const ownerList = Array.isArray(ownerRes.data) ? ownerRes.data : [];
      if (ownerList.length === 0) { setImportMsg("オーナーを先に登録してください"); setImportLoading(false); return; }
      const oId = ownerList[0].id;
      setOwnerId(oId);
      const ownerDetail = await api.get(`/api/owner/${oId}`);
      const bgGroups = ownerDetail.data?.business_groups || ownerDetail.data?.BusinessGroups || [];
      const accName = bgGroups[0]?.gbp_account_name || bgGroups[0]?.GbpAccountName || "";
      setGbpAccountName(accName);
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
      const allNames = Array.from(importSelected).map(name => {
        if (name.startsWith("accounts/")) return name;
        if (gbpAccountName && name.startsWith("locations/")) return `${gbpAccountName}/${name}`;
        return name;
      });
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
    let r = shops.filter((row) => {
      if (searchQuery && !fuzzyMatch(searchQuery, row.shopId, row.shopName, row.ownerName, row.agentName, row.city, row.state, row.phone)) return false;
      if (filterService !== "all" && row.service !== filterService) return false;
      if (filterGbp === "connected" && !row.gbpConnected) return false;
      if (filterGbp === "disconnected" && row.gbpConnected) return false;
      return true;
    });
    r.sort((a, b) => sortAsc ? String(a[sortKey]).localeCompare(String(b[sortKey]), "ja") : String(b[sortKey]).localeCompare(String(a[sortKey]), "ja"));
    return r;
  }, [shops, searchQuery, filterService, filterGbp, sortKey, sortAsc]);

  const hs = (k: keyof MasterRow) => { if (sortKey === k) setSortAsc(!sortAsc); else { setSortKey(k); setSortAsc(true); } };
  const si = (k: keyof MasterRow) => sortKey !== k ? "↕" : sortAsc ? "↑" : "↓";

  // サマリー計算
  const meoCount = shops.filter(s => s.service === "meo" || s.service === "both").length;
  const pmaxCount = shops.filter(s => s.service === "pmax" || s.service === "both").length;
  const bothCount = shops.filter(s => s.service === "both").length;
  const noneCount = shops.filter(s => s.service === "none").length;
  const gbpConnected = shops.filter(s => s.gbpConnected).length;

  const serviceLabel = (s: string) => {
    switch (s) {
      case "both": return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-700">MEO+P-MAX</span>;
      case "meo": return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700">MEO</span>;
      case "pmax": return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700">P-MAX</span>;
      default: return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-400">未登録</span>;
    }
  };

  return (<div className="animate-fade-in">
    <div className="mb-6">
      <h1 className="text-2xl font-bold text-slate-800">顧客マスタ</h1>
      <p className="text-slate-500 text-sm mt-1">契約状態・GBP接続・店舗情報を統合管理</p>
    </div>

    {/* ── サマリーカード ── */}
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
      <button onClick={() => setFilterService("all")} className={`bg-white rounded-xl p-4 border shadow-sm text-left transition hover:shadow-md ${filterService === "all" ? "border-[#003D6B] ring-2 ring-[#003D6B]/20" : "border-slate-200"}`}>
        <p className="text-[10px] text-slate-400 font-medium">全店舗</p>
        <p className="text-2xl font-black text-[#003D6B] mt-1">{shops.length}</p>
      </button>
      <button onClick={() => setFilterService("meo")} className={`bg-white rounded-xl p-4 border shadow-sm text-left transition hover:shadow-md ${filterService === "meo" ? "border-blue-500 ring-2 ring-blue-500/20" : "border-slate-200"}`}>
        <p className="text-[10px] text-blue-500 font-medium">MEO対策</p>
        <p className="text-2xl font-black text-blue-600 mt-1">{meoCount}</p>
      </button>
      <button onClick={() => setFilterService("pmax")} className={`bg-white rounded-xl p-4 border shadow-sm text-left transition hover:shadow-md ${filterService === "pmax" ? "border-amber-500 ring-2 ring-amber-500/20" : "border-slate-200"}`}>
        <p className="text-[10px] text-amber-500 font-medium">P-MAX</p>
        <p className="text-2xl font-black text-amber-600 mt-1">{pmaxCount}</p>
      </button>
      <button onClick={() => setFilterService("both")} className={`bg-white rounded-xl p-4 border shadow-sm text-left transition hover:shadow-md ${filterService === "both" ? "border-purple-500 ring-2 ring-purple-500/20" : "border-slate-200"}`}>
        <p className="text-[10px] text-purple-500 font-medium">両方</p>
        <p className="text-2xl font-black text-purple-600 mt-1">{bothCount}</p>
      </button>
      <button onClick={() => setFilterGbp(filterGbp === "connected" ? "all" : "connected")} className={`bg-white rounded-xl p-4 border shadow-sm text-left transition hover:shadow-md ${filterGbp === "connected" ? "border-green-500 ring-2 ring-green-500/20" : "border-slate-200"}`}>
        <p className="text-[10px] text-green-500 font-medium">GBP接続済</p>
        <p className="text-2xl font-black text-green-600 mt-1">{gbpConnected}</p>
      </button>
      <button onClick={() => setFilterService("none")} className={`bg-white rounded-xl p-4 border shadow-sm text-left transition hover:shadow-md ${filterService === "none" ? "border-slate-400 ring-2 ring-slate-400/20" : "border-slate-200"}`}>
        <p className="text-[10px] text-slate-400 font-medium">契約未登録</p>
        <p className="text-2xl font-black text-slate-500 mt-1">{noneCount}</p>
      </button>
    </div>

    {/* ── 検索・アクションバー ── */}
    <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm mb-4">
      <div className="flex items-center gap-3">
        <div className="flex-1 relative">
          <input className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#003D6B]/30"
            placeholder="店舗名・ID・オーナー・エリアで検索（全角/半角OK）" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          {searchQuery && <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-lg">×</button>}
        </div>
        <button onClick={openImport} className="bg-emerald-600 text-xs px-4 py-2 rounded-lg hover:bg-emerald-700 text-white whitespace-nowrap">GBPインポート</button>
        <button onClick={() => setShowOwnerModal(true)} className="bg-emerald-600 text-xs px-4 py-2 rounded-lg hover:bg-emerald-700 text-white whitespace-nowrap">+ オーナー</button>
        <button onClick={() => { setShowModal(true); if (owners.length > 0 && !formData.owner_id) setFormData({...formData, owner_id: owners[0].id}); }}
          className="bg-[#003D6B] text-xs px-4 py-2 rounded-lg hover:bg-[#002a4a] text-white whitespace-nowrap">+ 店舗登録</button>
      </div>
      {(searchQuery || filterService !== "all" || filterGbp !== "all") && (
        <div className="flex items-center gap-2 mt-2">
          <span className="text-xs text-slate-500">{filtered.length}件表示</span>
          {filterService !== "all" && <button onClick={() => setFilterService("all")} className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200">契約: {filterService === "meo" ? "MEO" : filterService === "pmax" ? "P-MAX" : filterService === "both" ? "両方" : "未登録"} ×</button>}
          {filterGbp !== "all" && <button onClick={() => setFilterGbp("all")} className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200">GBP: {filterGbp === "connected" ? "接続済" : "未接続"} ×</button>}
        </div>
      )}
    </div>

    {success && <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4 text-sm text-green-700">{success}</div>}
    {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-700">{error}</div>}

    {/* ── 新規店舗登録モーダル ── */}
    {showModal && (
      <Modal onClose={() => setShowModal(false)}>
        <div className="bg-white rounded-xl p-6 w-[500px] shadow-2xl">
          <h3 className="text-lg font-bold mb-4">新規店舗登録</h3>
          <div className="space-y-3">
            <div><label className="text-xs text-slate-500 block mb-1">オーナー *</label>
              <select className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={formData.owner_id} onChange={(e) => setFormData({...formData, owner_id: e.target.value})}>
                <option value="">選択してください</option>{owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select></div>
            <div><label className="text-xs text-slate-500 block mb-1">店舗名 *</label>
              <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="例: サンプル食堂 渋谷店" value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-slate-500 block mb-1">郵便番号</label><input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={formData.postal_code} onChange={(e) => setFormData({...formData, postal_code: e.target.value})} /></div>
              <div><label className="text-xs text-slate-500 block mb-1">電話番号</label><input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={formData.phone} onChange={(e) => setFormData({...formData, phone: e.target.value})} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-slate-500 block mb-1">都道府県</label><input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={formData.state} onChange={(e) => setFormData({...formData, state: e.target.value})} /></div>
              <div><label className="text-xs text-slate-500 block mb-1">市区町村</label><input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={formData.city} onChange={(e) => setFormData({...formData, city: e.target.value})} /></div>
            </div>
            <div><label className="text-xs text-slate-500 block mb-1">住所</label><input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={formData.address} onChange={(e) => setFormData({...formData, address: e.target.value})} /></div>
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <button onClick={() => setShowModal(false)} className="text-sm px-4 py-2 rounded-lg border border-slate-200 hover:bg-slate-50">キャンセル</button>
            <button onClick={handleCreate} disabled={submitting} className="text-sm px-4 py-2 rounded-lg bg-[#003D6B] hover:bg-[#002a4a] disabled:opacity-50 text-white">{submitting ? "登録中..." : "登録する"}</button>
          </div>
        </div>
      </Modal>
    )}

    {/* ── オーナー登録モーダル ── */}
    {showOwnerModal && (
      <Modal onClose={() => setShowOwnerModal(false)}>
        <div className="bg-white rounded-xl p-6 w-[440px] shadow-2xl">
          <h3 className="text-lg font-bold mb-4">新規オーナー登録</h3>
          <div className="space-y-3">
            <div><label className="text-xs text-slate-500 block mb-1">オーナー名 *</label><input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={ownerForm.name} onChange={(e) => setOwnerForm({...ownerForm, name: e.target.value})} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-slate-500 block mb-1">郵便番号 *</label><input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={ownerForm.postal_code} onChange={(e) => setOwnerForm({...ownerForm, postal_code: e.target.value})} /></div>
              <div><label className="text-xs text-slate-500 block mb-1">電話番号</label><input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={ownerForm.phone} onChange={(e) => setOwnerForm({...ownerForm, phone: e.target.value})} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-slate-500 block mb-1">都道府県 *</label><input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={ownerForm.state} onChange={(e) => setOwnerForm({...ownerForm, state: e.target.value})} /></div>
              <div><label className="text-xs text-slate-500 block mb-1">市区町村 *</label><input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={ownerForm.city} onChange={(e) => setOwnerForm({...ownerForm, city: e.target.value})} /></div>
            </div>
            <div><label className="text-xs text-slate-500 block mb-1">住所 *</label><input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={ownerForm.address} onChange={(e) => setOwnerForm({...ownerForm, address: e.target.value})} /></div>
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <button onClick={() => setShowOwnerModal(false)} className="text-sm px-4 py-2 rounded-lg border border-slate-200 hover:bg-slate-50">キャンセル</button>
            <button onClick={handleCreateOwner} disabled={submitting} className="text-sm px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white">{submitting ? "登録中..." : "登録する"}</button>
          </div>
        </div>
      </Modal>
    )}

    {/* ── 店舗編集モーダル ── */}
    {editShop && (
      <Modal onClose={() => setEditShop(null)}>
        <div className="bg-white rounded-xl p-6 w-[500px] max-h-[80vh] overflow-y-auto shadow-2xl">
          <h3 className="text-lg font-bold mb-4">店舗情報を編集</h3>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">店舗名</label>
              <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={editShop.shopName} onChange={(e) => setEditShop({ ...editShop, shopName: e.target.value })} />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">電話番号</label>
              <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={editShop.phone} onChange={(e) => setEditShop({ ...editShop, phone: e.target.value })} />
            </div>
          </div>
          <div className="flex gap-2 mt-6">
            <button
              disabled={saving}
              onClick={handleEditSave}
              className="flex-1 bg-[#003D6B] text-white py-2 rounded-lg text-sm font-medium hover:bg-[#002a4a] transition disabled:opacity-50"
            >
              {saving ? "保存中..." : "保存"}
            </button>
            <button onClick={() => setEditShop(null)} className="px-4 py-2 border border-slate-200 rounded-lg text-sm hover:bg-slate-50 transition">キャンセル</button>
          </div>
        </div>
      </Modal>
    )}

    {/* ── GBPインポートモーダル ── */}
    {showImport && (
      <Modal onClose={() => setShowImport(false)}>
        <div className="bg-white rounded-xl p-6 w-[600px] max-h-[80vh] overflow-y-auto shadow-2xl">
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
                className="text-sm px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white"
              >
                {importLoading ? "インポート中..." : `${importSelected.size}店舗をインポート`}
              </button>
            )}
          </div>
        </div>
      </Modal>
    )}

    {/* ── テーブル ── */}
    {loading ? <div className="bg-white rounded-xl p-12 border border-slate-200 text-center"><p className="text-slate-500">読み込み中...</p></div> : (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left py-3 px-3 text-xs font-semibold text-slate-500 cursor-pointer hover:text-slate-800" onClick={() => hs("shopName")}>店舗名 {si("shopName")}</th>
              <th className="text-center py-3 px-2 text-xs font-semibold text-slate-500 w-24">契約</th>
              <th className="text-left py-3 px-2 text-xs font-semibold text-slate-500 cursor-pointer hover:text-slate-800" onClick={() => hs("ownerName")}>オーナー {si("ownerName")}</th>
              <th className="text-left py-3 px-2 text-xs font-semibold text-slate-500 cursor-pointer hover:text-slate-800" onClick={() => hs("city")}>エリア {si("city")}</th>
              <th className="text-left py-3 px-2 text-xs font-semibold text-slate-500">電話番号</th>
              <th className="text-center py-3 px-2 text-xs font-semibold text-slate-500 w-20">GBP</th>
              <th className="text-center py-3 px-2 text-xs font-semibold text-slate-500 w-40">操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="py-12 text-center text-slate-400">{shops.length === 0 ? "店舗が登録されていません" : "該当なし"}</td></tr>
            ) : filtered.map((row) => (
              <tr key={row.shopId} className="border-b border-slate-50 hover:bg-blue-50/30 transition">
                <td className="py-2.5 px-3">
                  <span className="font-medium text-slate-800 text-[13px]">{row.shopName}</span>
                  <span className="block text-[10px] text-slate-400 font-mono">{row.shopId.slice(0, 8)}...</span>
                </td>
                <td className="py-2.5 px-2 text-center">{serviceLabel(row.service)}</td>
                <td className="py-2.5 px-2 text-xs text-slate-600">
                  <div>{row.ownerName}</div>
                  {row.agentName !== "（直接契約）" && <div className="text-[10px] text-slate-400">via {row.agentName}</div>}
                </td>
                <td className="py-2.5 px-2 text-xs text-slate-500">{row.state}{row.city}</td>
                <td className="py-2.5 px-2 text-xs text-slate-500">{row.phone || "—"}</td>
                <td className="py-2.5 px-2 text-center">
                  {row.gbpConnected
                    ? <span className="text-green-600 text-xs font-semibold">● 接続</span>
                    : <span className="text-slate-300 text-xs">○ 未接続</span>}
                </td>
                <td className="py-2.5 px-2 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <button onClick={() => setEditShop(row)} className="text-[10px] px-2 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 transition">編集</button>
                    {row.gbpConnected && (
                      <button onClick={() => handleUnlinkGbp(row.shopId, row.shopName)} className="text-[10px] px-2 py-1 bg-orange-50 text-orange-600 rounded hover:bg-orange-100 transition">ロケーション解除</button>
                    )}
                    <button onClick={() => handleDelete(row.shopId, row.shopName)} className="text-[10px] px-2 py-1 bg-red-50 text-red-600 rounded hover:bg-red-100 transition">削除</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>);
}
