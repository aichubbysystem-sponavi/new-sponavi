"use client";

import { useState, useEffect, useCallback } from "react";
import { useShop } from "@/components/shop-provider";
import api from "@/lib/api";

export default function BasicInfoPage() {
  const { apiConnected, selectedShopId, selectedShop } = useShop();
  const [location, setLocation] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchLocation = useCallback(async () => {
    if (!selectedShopId) return;
    setLoading(true); setError("");
    try {
      const res = await api.get(`/api/shop/${selectedShopId}/location`);
      setLocation(res.data);
    } catch { setError("GBPロケーション情報の取得に失敗しました"); setLocation(null); }
    finally { setLoading(false); }
  }, [selectedShopId]);

  useEffect(() => { fetchLocation(); }, [fetchLocation]);

  return (
    <div className="animate-fade-in">
      <h1 className="text-2xl font-bold text-slate-800 mb-2">基礎情報管理</h1>
      <p className="text-sm text-slate-500 mb-6">GBPの基本情報を管理・編集</p>

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
