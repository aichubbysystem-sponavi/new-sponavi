"use client";

import { useState, useEffect, useCallback } from "react";
import { useShop } from "@/components/shop-provider";
import api from "@/lib/api";

interface ChangeAlert {
  field: string;
  before: string;
  after: string;
}

export default function BasicInfoPage() {
  const { apiConnected, selectedShopId, selectedShop } = useShop();
  const [location, setLocation] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [changeAlerts, setChangeAlerts] = useState<ChangeAlert[]>([]);
  const [alertDismissed, setAlertDismissed] = useState(false);
  const [services, setServices] = useState<any[]>([]);
  const [serviceLoading, setServiceLoading] = useState(false);
  // メニュー編集
  const [editingMenu, setEditingMenu] = useState(false);
  const [newMenu, setNewMenu] = useState({ name: "", description: "", price: "" });
  const [menuSaving, setMenuSaving] = useState(false);
  const [menuMsg, setMenuMsg] = useState("");
  // GBP編集機能
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ title: "", phone: "", website: "", description: "" });
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const fetchLocation = useCallback(async () => {
    if (!selectedShopId) return;
    setLoading(true); setError(""); setChangeAlerts([]); setAlertDismissed(false);
    try {
      const res = await api.get(`/api/shop/${selectedShopId}/location`);
      const data = res.data;
      setLocation(data);

      // 変更検知: 前回保存と比較
      const storageKey = `gbp-snapshot-${selectedShopId}`;
      const saved = localStorage.getItem(storageKey);
      if (saved && data) {
        try {
          const prev = JSON.parse(saved);
          const alerts: ChangeAlert[] = [];
          const check = (field: string, prevVal: string, curVal: string) => {
            const p = (prevVal || "").trim();
            const c = (curVal || "").trim();
            if (p && c && p !== c) alerts.push({ field, before: p, after: c });
          };
          check("店舗名", prev.title, data.title);
          check("電話番号", prev.phone, data.phoneNumbers?.primaryPhone);
          check("Webサイト", prev.website, data.websiteUri);
          const catName = data.categories?.primaryCategory?.displayName;
          check("メインカテゴリ", prev.category, typeof catName === "object" ? catName?.text || "" : String(catName || ""));
          const prevAddr = prev.address || "";
          const curAddr = (data.storefrontAddress?.addressLines || []).join(" ");
          check("住所", prevAddr, curAddr);
          if (alerts.length > 0) setChangeAlerts(alerts);
        } catch {}
      }

      // 現在の情報を保存
      if (data) {
        localStorage.setItem(storageKey, JSON.stringify({
          title: data.title || "",
          phone: data.phoneNumbers?.primaryPhone || "",
          website: data.websiteUri || "",
          category: typeof data.categories?.primaryCategory?.displayName === "object" ? data.categories.primaryCategory.displayName?.text || "" : String(data.categories?.primaryCategory?.displayName || ""),
          address: (data.storefrontAddress?.addressLines || []).join(" "),
          savedAt: new Date().toISOString(),
        }));
      }
    } catch { setError("GBPロケーション情報の取得に失敗しました"); setLocation(null); }
    finally { setLoading(false); }
  }, [selectedShopId]);

  useEffect(() => { fetchLocation(); }, [fetchLocation]);

  const saveMenu = async () => {
    if (!selectedShopId || !newMenu.name.trim()) return;
    setMenuSaving(true);
    setMenuMsg("");
    try {
      const menuItem: any = {
        freeFormServiceItem: {
          label: { displayName: newMenu.name.trim(), languageCode: "ja" },
          ...(newMenu.description.trim() ? { description: { text: newMenu.description.trim(), languageCode: "ja" } } : {}),
        },
        ...(newMenu.price ? { price: { currencyCode: "JPY", units: parseInt(newMenu.price) || 0 } } : {}),
      };
      await api.patch(`/api/shop/${selectedShopId}/location/food_menu`, { menuItems: [menuItem] });
      setMenuMsg("メニューを追加しました");
      setNewMenu({ name: "", description: "", price: "" });
      setEditingMenu(false);
      // リロード
      const res = await api.get(`/api/shop/${selectedShopId}/location`);
      const loc = res.data;
      const items: any[] = [];
      if (loc?.serviceItems) {
        loc.serviceItems.forEach((si: any) => {
          const nameRaw = si.structuredServiceItem?.displayName || si.freeFormServiceItem?.label || "";
          const name = typeof nameRaw === "object" ? (nameRaw?.text || nameRaw?.displayName || JSON.stringify(nameRaw)) : String(nameRaw || "不明");
          const descRaw = si.structuredServiceItem?.description || si.freeFormServiceItem?.description || "";
          const desc = typeof descRaw === "object" ? (descRaw?.text || JSON.stringify(descRaw)) : String(descRaw || "");
          items.push({ name, description: desc, price: si.price ? `¥${si.price.units || 0}` : "" });
        });
      }
      setServices(items);
    } catch (e: any) {
      setMenuMsg(`メニュー追加失敗: ${e?.response?.data?.message || e?.message || "エラー"}`);
    }
    setMenuSaving(false);
  };

  const startEdit = () => {
    setEditForm({
      title: location?.title || "",
      phone: location?.phoneNumbers?.primaryPhone || "",
      website: location?.websiteUri || "",
      description: location?.profile?.description || "",
    });
    setEditing(true);
    setSaveMsg("");
  };

  const handleSave = async () => {
    if (!selectedShopId) return;
    setSaving(true);
    setSaveMsg("");
    try {
      const patchData: any = {};
      if (editForm.title) patchData.title = editForm.title;
      if (editForm.phone) patchData.phoneNumbers = { primaryPhone: editForm.phone };
      if (editForm.website) patchData.websiteUri = editForm.website;
      if (editForm.description) patchData.profile = { description: editForm.description };
      await api.patch(`/api/shop/${selectedShopId}/location`, patchData);
      setSaveMsg("GBP情報を更新しました");
      setEditing(false);
      await fetchLocation();
    } catch (e: any) {
      setSaveMsg(`更新失敗: ${e?.response?.data?.message || e?.message || "不明なエラー"}`);
    }
    setSaving(false);
  };

  // サービス/メニュー取得
  useEffect(() => {
    if (!selectedShopId) return;
    setServiceLoading(true);
    api.get(`/api/shop/${selectedShopId}/location`).then((res) => {
      const loc = res.data;
      const items: any[] = [];
      if (loc?.serviceItems) {
        loc.serviceItems.forEach((si: any) => {
          const nameRaw = si.structuredServiceItem?.displayName || si.freeFormServiceItem?.label || "";
          const descRaw = si.structuredServiceItem?.description || si.freeFormServiceItem?.description || "";
          // オブジェクトの場合は文字列に変換
          const name = typeof nameRaw === "object" ? (nameRaw?.text || nameRaw?.displayName || JSON.stringify(nameRaw)) : String(nameRaw || "不明");
          const desc = typeof descRaw === "object" ? (descRaw?.text || JSON.stringify(descRaw)) : String(descRaw || "");
          items.push({ name, description: desc, price: si.price ? `¥${si.price.units || 0}` : "" });
        });
      }
      if (loc?.metadata?.mapsUri) {
        items.push({ name: "Google Maps", description: String(loc.metadata.mapsUri), price: "" });
      }
      setServices(items);
    }).catch(() => setServices([])).finally(() => setServiceLoading(false));
  }, [selectedShopId]);

  return (
    <div className="animate-fade-in">
      <h1 className="text-2xl font-bold text-slate-800 mb-2">基礎情報管理</h1>
      <p className="text-sm text-slate-500 mb-6">GBPの基本情報を管理・編集</p>

      {/* GBP変更検知アラート */}
      {changeAlerts.length > 0 && !alertDismissed && (
        <div className="bg-red-50 rounded-xl p-5 shadow-sm border border-red-200 mb-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-red-600">GBP情報の変更を検知しました（{changeAlerts.length}件）</h3>
            <button onClick={() => setAlertDismissed(true)}
              className="text-[10px] text-red-400 hover:text-red-600 font-semibold">確認済み</button>
          </div>
          <div className="space-y-2">
            {changeAlerts.map((alert, i) => (
              <div key={i} className="bg-white rounded-lg p-3 border border-red-100">
                <p className="text-xs font-semibold text-red-700 mb-1">{alert.field}</p>
                <div className="flex items-center gap-2 text-xs">
                  <span className="bg-red-50 px-2 py-0.5 rounded text-red-600 line-through">{alert.before}</span>
                  <span className="text-slate-400">→</span>
                  <span className="bg-emerald-50 px-2 py-0.5 rounded text-emerald-700 font-medium">{alert.after}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[9px] text-red-400 mt-2">※ Googleや第三者による情報変更の可能性があります。正しい情報か確認してください。</p>
        </div>
      )}

      {!apiConnected || !selectedShopId ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">{apiConnected ? "店舗を選択してください" : "Go APIに接続し、店舗を登録すると利用できます"}</p>
        </div>
      ) : loading ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">読み込み中...</p>
        </div>
      ) : error ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-red-400 text-sm">{error}</p>
          <p className="text-slate-300 text-xs mt-1">GBPロケーションが紐付けられているか確認してください</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* 店舗基本情報 */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
            <h3 className="text-sm font-semibold text-slate-500 mb-4">店舗基本情報（Go API）</h3>
            <div className="space-y-3">
              {[
                { label: "店舗名", value: selectedShop?.name },
                { label: "電話番号", value: selectedShop?.phone },
                { label: "住所", value: `${selectedShop?.state || ""}${selectedShop?.city || ""}${selectedShop?.address || ""}` },
                { label: "建物名", value: selectedShop?.building },
                { label: "郵便番号", value: selectedShop?.postal_code },
                { label: "GBP接続", value: selectedShop?.gbp_location_name ? "● 接続済" : "○ 未接続" },
              ].map((item, i) => (
                <div key={i} className="flex justify-between py-2 border-b border-slate-50">
                  <span className="text-sm text-slate-500">{item.label}</span>
                  <span className="text-sm font-medium text-slate-800">{item.value || "-"}</span>
                </div>
              ))}
            </div>
          </div>

          {/* GBPロケーション情報 */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-500">GBPロケーション情報</h3>
              {location && !editing && (
                <button onClick={startEdit}
                  className="px-3 py-1 rounded-lg text-xs font-semibold bg-[#003D6B] text-white hover:bg-[#002a4a] transition">
                  編集
                </button>
              )}
            </div>
            {saveMsg && (
              <div className={`p-2 rounded-lg mb-3 text-xs ${saveMsg.includes("失敗") ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-600"}`}>{saveMsg}</div>
            )}
            {location ? (
              <div className="space-y-3">
                <div className="flex justify-between py-2 border-b border-slate-50">
                  <span className="text-sm text-slate-500">GBP表示名</span>
                  <span className="text-sm font-medium text-slate-800">{location.title || location.name || "-"}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-slate-50">
                  <span className="text-sm text-slate-500">ロケーションID</span>
                  <span className="text-xs font-mono text-slate-500">{location.name || "-"}</span>
                </div>
                {location.phoneNumbers?.primaryPhone && (
                  <div className="flex justify-between py-2 border-b border-slate-50">
                    <span className="text-sm text-slate-500">GBP電話番号</span>
                    <span className="text-sm text-slate-800">{location.phoneNumbers.primaryPhone}</span>
                  </div>
                )}
                {location.websiteUri && (
                  <div className="flex justify-between py-2 border-b border-slate-50">
                    <span className="text-sm text-slate-500">Webサイト</span>
                    <a href={location.websiteUri} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline">{location.websiteUri}</a>
                  </div>
                )}
                {location.regularHours?.periods && (
                  <div className="py-2">
                    <span className="text-sm text-slate-500 block mb-2">営業時間</span>
                    <div className="space-y-1">
                      {location.regularHours.periods.map((p: any, i: number) => (
                        <div key={i} className="flex justify-between text-xs text-slate-600">
                          <span>{["日","月","火","水","木","金","土"][["SUNDAY","MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY"].indexOf(p.openDay)] || p.openDay}</span>
                          <span>{p.openTime?.hours || 0}:{String(p.openTime?.minutes || 0).padStart(2,"0")} - {p.closeTime?.hours || 0}:{String(p.closeTime?.minutes || 0).padStart(2,"0")}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-slate-400 text-sm text-center py-6">GBPロケーション情報が取得できません</p>
            )}
            {/* GBP編集フォーム */}
            {editing && (
              <div className="mt-4 pt-4 border-t border-slate-200">
                <h4 className="text-xs font-semibold text-[#003D6B] mb-3">GBP情報を編集</h4>
                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-1">店舗名</label>
                    <input type="text" value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#003D6B]/20" />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-1">電話番号</label>
                    <input type="text" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#003D6B]/20" />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-1">Webサイト</label>
                    <input type="text" value={editForm.website} onChange={(e) => setEditForm({ ...editForm, website: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#003D6B]/20" />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-1">説明文</label>
                    <textarea value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                      rows={4} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#003D6B]/20" />
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={handleSave} disabled={saving}
                      className="px-4 py-2 rounded-lg text-xs font-semibold bg-[#003D6B] text-white hover:bg-[#002a4a] disabled:opacity-50">
                      {saving ? "保存中..." : "GBPに保存"}
                    </button>
                    <button onClick={() => setEditing(false)}
                      className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200">
                      キャンセル
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* メニュー・サービス一覧 */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 xl:col-span-2 mt-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-500">メニュー・商品・サービス</h3>
              <button onClick={() => setEditingMenu(!editingMenu)}
                className="px-3 py-1 rounded-lg text-xs font-semibold bg-[#003D6B] text-white hover:bg-[#002a4a]">
                {editingMenu ? "閉じる" : "+ メニュー追加"}
              </button>
            </div>
            {menuMsg && <div className={`p-2 rounded-lg mb-3 text-xs ${menuMsg.includes("失敗") ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-600"}`}>{menuMsg}</div>}
            {editingMenu && (
              <div className="bg-slate-50 rounded-lg p-4 mb-4 border border-slate-200">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-1">名称</label>
                    <input type="text" value={newMenu.name} onChange={(e) => setNewMenu({ ...newMenu, name: e.target.value })}
                      placeholder="例: 特製ランチ" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-1">説明</label>
                    <input type="text" value={newMenu.description} onChange={(e) => setNewMenu({ ...newMenu, description: e.target.value })}
                      placeholder="例: 日替わりのメイン+サラダ+スープ" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-1">価格（円）</label>
                    <div className="flex gap-2">
                      <input type="number" value={newMenu.price} onChange={(e) => setNewMenu({ ...newMenu, price: e.target.value })}
                        placeholder="1000" className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                      <button onClick={saveMenu} disabled={menuSaving || !newMenu.name.trim()}
                        className="px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
                        {menuSaving ? "追加中..." : "追加"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {serviceLoading ? (
              <p className="text-slate-400 text-sm text-center py-6">読み込み中...</p>
            ) : services.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-slate-400 text-sm">GBPにサービス情報が登録されていません</p>
                <p className="text-[10px] text-slate-300 mt-1">Googleビジネスプロフィールの管理画面からメニュー・商品・サービスを登録してください</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="text-left py-2 px-2 text-slate-500 font-medium">名称</th>
                      <th className="text-left py-2 px-2 text-slate-500 font-medium">説明</th>
                      <th className="text-right py-2 px-2 text-slate-500 font-medium">価格</th>
                    </tr>
                  </thead>
                  <tbody>
                    {services.map((s, i) => (
                      <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="py-2 px-2 text-slate-700 font-medium">{s.name}</td>
                        <td className="py-2 px-2 text-slate-500 max-w-[300px] truncate">{s.description}</td>
                        <td className="py-2 px-2 text-right text-slate-700">{s.price || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
