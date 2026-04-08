"use client";

import { useState, useEffect, useCallback } from "react";
import { useShop } from "@/components/shop-provider";
import api from "@/lib/api";

export default function SetupPage() {
  const { apiConnected, selectedShopId, selectedShop } = useShop();
  const [attributes, setAttributes] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchSetup = useCallback(async () => {
    if (!selectedShopId) return;
    setLoading(true);
    try {
      const res = await api.get(`/api/shop/${selectedShopId}/attribute`);
      setAttributes(Array.isArray(res.data) ? res.data : []);
    } catch { setAttributes([]); }
    finally { setLoading(false); }
  }, [selectedShopId]);

  useEffect(() => { fetchSetup(); }, [fetchSetup]);

  return (
    <div className="animate-fade-in">
      <h1 className="text-2xl font-bold text-slate-800 mb-2">初期整備</h1>
      <p className="text-sm text-slate-500 mb-6">GBPの属性・カテゴリ・写真などの初期設定</p>

      {!apiConnected || !selectedShopId ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">{apiConnected ? "店舗を選択してください" : "Go APIに接続し、店舗を登録すると利用できます"}</p>
        </div>
      ) : loading ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">読み込み中...</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
          <h3 className="text-sm font-semibold text-slate-500 mb-4">GBP属性情報</h3>
          {attributes.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-6">属性データがありません。GBPロケーションが紐付けられているか確認してください。</p>
          ) : (
            <div className="space-y-2">
              {attributes.map((attr: any, i: number) => (
                <div key={i} className="flex justify-between py-2 border-b border-slate-50">
                  <span className="text-sm text-slate-600">{attr.name || attr.attributeId || `属性 ${i + 1}`}</span>
                  <span className="text-sm text-slate-800 font-medium">{JSON.stringify(attr.values || attr.uriValues || "-")}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
