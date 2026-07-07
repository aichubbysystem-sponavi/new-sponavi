"use client";

import { useState, useEffect, useCallback } from "react";
import { useShop } from "@/components/shop-provider";
import api from "@/lib/api";
import { buildGbpSnapshot, detectGbpChanges, type ChangeAlert } from "@/lib/gbp-snapshot";

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

  // trustCurrent=true: アプリ内の正規編集・復旧の直後に呼ぶ。現在値を新しい正常ベースラインとして
  // 確定し、自分の変更を「改ざん」と誤検知しないようにする。
  const fetchLocation = useCallback(async (trustCurrent = false) => {
    if (!selectedShopId) return;
    setLoading(true); setError(""); setChangeAlerts([]); setAlertDismissed(false);
    try {
      const res = await api.get(`/api/shop/${selectedShopId}/location`);
      const data = res.data;
      setLocation(data);

      // 変更検知: 前回保存(=正常時のベースライン)と比較
      const storageKey = `gbp-snapshot-${selectedShopId}`;
      const saved = localStorage.getItem(storageKey);
      let hadChange = false;
      if (saved && data && !trustCurrent) {
        try {
          const prev = JSON.parse(saved);
          const alerts = detectGbpChanges(prev, data);
          if (alerts.length > 0) { setChangeAlerts(alerts); hadChange = true; }
        } catch { /* 破損したスナップショットは下で現在値で作り直す */ }
      }

      // ベースラインの更新は「変更が検知されなかった時のみ」。
      // 変更検知時に上書きすると復旧値が改ざん後の値になり復旧が無意味になる（重大バグの修正）。
      // 初回・破損時、およびアプリ内の正規編集直後(trustCurrent)は現在値でベースラインを確立する。
      if (data && (!hadChange || trustCurrent)) {
        localStorage.setItem(storageKey, JSON.stringify(buildGbpSnapshot(data)));
      }
      // hadChange === true の場合はベースラインを保持（復旧のため「前回の正常値」を残す）
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
      await fetchLocation(true); // 自分の編集を新しい正常ベースラインとして確定（誤検知防止）
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
          <div className="flex items-center gap-2 mt-3">
            <button onClick={async () => {
              const storageKey = `gbp-snapshot-${selectedShopId}`;
              const saved = localStorage.getItem(storageKey);
              if (!saved || !selectedShopId) { setSaveMsg("復旧用のバックアップが見つかりません"); return; }
              let prev: any;
              try { prev = JSON.parse(saved); }
              catch { setSaveMsg("バックアップデータが破損しているため復旧できません"); return; }
              if (!confirm("GBP情報を前回の正常時の状態に復旧しますか？")) return;
              setSaveMsg("");
              setSaving(true);
              try {
                // コア項目（確実に復旧可能）: 店舗名・電話・Webサイト
                const patchData: any = {};
                if (prev.title) patchData.title = prev.title;
                if (prev.phone) patchData.phoneNumbers = { primaryPhone: prev.phone };
                if (prev.website) patchData.websiteUri = prev.website;
                if (Object.keys(patchData).length > 0) {
                  await api.patch(`/api/shop/${selectedShopId}/location`, patchData);
                }

                // 住所・カテゴリ（構造化データがあれば復旧を試みる。失敗してもコア復旧は維持）
                const extraNotes: string[] = [];
                if (prev.raw?.storefrontAddress) {
                  try { await api.patch(`/api/shop/${selectedShopId}/location`, { storefrontAddress: prev.raw.storefrontAddress }); }
                  catch { extraNotes.push("住所"); }
                }
                if (prev.raw?.primaryCategory) {
                  try {
                    const cats: any = { primaryCategory: prev.raw.primaryCategory };
                    if (prev.raw.additionalCategories) cats.additionalCategories = prev.raw.additionalCategories;
                    await api.patch(`/api/shop/${selectedShopId}/location`, { categories: cats });
                  } catch { extraNotes.push("カテゴリ"); }
                }

                setSaveMsg(extraNotes.length > 0
                  ? `店舗名・電話・Webサイトを復旧しました（${extraNotes.join("・")}は自動復旧できませんでした。手動で確認してください）`
                  : "GBP情報を復旧しました");
                setChangeAlerts([]);
                await fetchLocation(true); // 復旧後の値を新しい正常ベースラインとして確定
              } catch (e: any) {
                setSaveMsg(`復旧失敗: ${e?.response?.data?.message || e?.message || "エラー"}`);
              }
              setSaving(false);
            }} disabled={saving}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
              {saving ? "復旧中..." : "元に戻す（自動復旧）"}
            </button>
            <button onClick={() => {
              // 変更を承認 → 現在値を新しいベースラインとして確定（次回以降アラートを出さない）
              if (selectedShopId && location) {
                localStorage.setItem(`gbp-snapshot-${selectedShopId}`, JSON.stringify(buildGbpSnapshot(location)));
              }
              setChangeAlerts([]);
              setAlertDismissed(true);
            }}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200">
              この変更を承認
            </button>
          </div>
          <p className="text-[9px] text-red-400 mt-2">※ Googleや第三者による情報変更の可能性があります。</p>
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
                <p className="text-[10px] text-slate-500 mb-2 font-semibold">単品追加</p>
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
                <div className="mt-4 pt-3 border-t border-slate-200">
                  <p className="text-[10px] text-slate-500 mb-2 font-semibold">一括追加（CSV形式: 名称,説明,価格）</p>
                  <textarea
                    id="bulk-menu-csv"
                    rows={4}
                    placeholder={"特製ランチ,日替わりメイン+サラダ+スープ,1200\nハンバーグ定食,手ごねハンバーグ200g,980\nドリンクバー,,300"}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono"
                  />
                  <button onClick={async () => {
                    const el = document.getElementById("bulk-menu-csv") as HTMLTextAreaElement;
                    if (!el?.value.trim() || !selectedShopId) return;
                    setMenuSaving(true);
                    setMenuMsg("");
                    const lines = el.value.trim().split("\n").filter(Boolean);
                    let added = 0;
                    for (const line of lines) {
                      const [name, desc, price] = line.split(",").map(s => s.trim());
                      if (!name) continue;
                      try {
                        const menuItem: any = {
                          freeFormServiceItem: {
                            label: { displayName: name, languageCode: "ja" },
                            ...(desc ? { description: { text: desc, languageCode: "ja" } } : {}),
                          },
                          ...(price ? { price: { currencyCode: "JPY", units: parseInt(price) || 0 } } : {}),
                        };
                        await api.patch(`/api/shop/${selectedShopId}/location/food_menu`, { menuItems: [menuItem] });
                        added++;
                      } catch {}
                    }
                    setMenuMsg(`${added}/${lines.length}件のメニューを追加しました`);
                    el.value = "";
                    setMenuSaving(false);
                    // リロード
                    try {
                      const res = await api.get(`/api/shop/${selectedShopId}/location`);
                      const loc = res.data;
                      const items: any[] = [];
                      if (loc?.serviceItems) {
                        loc.serviceItems.forEach((si: any) => {
                          const nr = si.structuredServiceItem?.displayName || si.freeFormServiceItem?.label || "";
                          const n = typeof nr === "object" ? (nr?.text || nr?.displayName || JSON.stringify(nr)) : String(nr || "不明");
                          const dr = si.structuredServiceItem?.description || si.freeFormServiceItem?.description || "";
                          const d = typeof dr === "object" ? (dr?.text || JSON.stringify(dr)) : String(dr || "");
                          items.push({ name: n, description: d, price: si.price ? `¥${si.price.units || 0}` : "" });
                        });
                      }
                      setServices(items);
                    } catch {}
                  }} disabled={menuSaving}
                    className="mt-2 px-4 py-2 rounded-lg text-xs font-semibold bg-[#003D6B] text-white hover:bg-[#002a4a] disabled:opacity-50">
                    {menuSaving ? "追加中..." : "CSV一括追加"}
                  </button>
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
