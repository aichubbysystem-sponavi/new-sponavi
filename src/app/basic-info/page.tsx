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
          check("メインカテゴリ", prev.category, data.categories?.primaryCategory?.displayName);
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
          category: data.categories?.primaryCategory?.displayName || "",
          address: (data.storefrontAddress?.addressLines || []).join(" "),
          savedAt: new Date().toISOString(),
        }));
      }
    } catch { setError("GBPロケーション情報の取得に失敗しました"); setLocation(null); }
    finally { setLoading(false); }
  }, [selectedShopId]);

  useEffect(() => { fetchLocation(); }, [fetchLocation]);

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
            <h3 className="text-sm font-semibold text-slate-500 mb-4">GBPロケーション情報</h3>
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
          </div>
        </div>
      )}
    </div>
  );
}
