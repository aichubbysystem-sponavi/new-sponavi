"use client";

import { useEffect, useCallback, useState } from "react";
import api from "@/lib/api";
import { useShop } from "@/components/shop-provider";

interface RankingSetting {
  id: string;
  search_words: string[];
  use: boolean;
  use_shop_name: boolean;
  day_of_week: number;
  hour: number;
}

export default function RankingPage() {
  const { apiConnected, selectedShopId, selectedShop } = useShop();
  const [settings, setSettings] = useState<RankingSetting[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchSettings = useCallback(async () => {
    if (!selectedShopId) return;
    setLoading(true);
    try {
      const res = await api.get(`/api/shop/${selectedShopId}/ranking_search_setting`);
      setSettings(Array.isArray(res.data) ? res.data : []);
    } catch { setSettings([]); }
    finally { setLoading(false); }
  }, [selectedShopId]);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const dayLabels = ["日", "月", "火", "水", "木", "金", "土"];

  return (
    <div className="animate-fade-in">
      <h1 className="text-2xl font-bold text-slate-800 mb-2">店舗検索ランキング</h1>
      <p className="text-sm text-slate-500 mb-6">対策キーワードの検索順位を追跡・分析</p>

      {!apiConnected || !selectedShopId ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">{apiConnected ? "店舗を選択してください" : "Go APIに接続し、店舗を登録すると利用できます"}</p>
        </div>
      ) : loading ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">読み込み中...</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 mb-6">
            <h3 className="text-sm font-semibold text-slate-500 mb-4">ランキング計測設定</h3>
            {settings.length === 0 ? (
              <p className="text-slate-400 text-sm text-center py-6">ランキング計測設定がありません。店舗管理画面から設定してください。</p>
            ) : (
              <div className="space-y-3">
                {settings.map((s) => (
                  <div key={s.id} className="border border-slate-100 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${s.use ? "bg-emerald-500" : "bg-slate-300"}`} />
                        <span className="text-sm font-medium text-slate-700">{s.use ? "有効" : "無効"}</span>
                      </div>
                      <span className="text-xs text-slate-400">計測: 毎週{dayLabels[s.day_of_week]}曜 {s.hour}:00</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {s.search_words.map((w, i) => (
                        <span key={i} className="px-3 py-1 bg-blue-50 text-blue-700 text-xs rounded-full font-medium border border-blue-100">
                          {w}
                        </span>
                      ))}
                      {s.use_shop_name && (
                        <span className="px-3 py-1 bg-amber-50 text-amber-700 text-xs rounded-full font-medium border border-amber-100">
                          + 店舗名
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
