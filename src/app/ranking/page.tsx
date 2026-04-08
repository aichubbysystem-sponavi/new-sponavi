"use client";

import { useEffect, useCallback, useState } from "react";
import api from "@/lib/api";
import { useShop } from "@/components/shop-provider";

interface RankingRow {
  keyword: string;
  current: number;
  prev: number;
  best: number;
  target: number;
  trend: string;
}

export default function RankingPage() {
  const { apiConnected, selectedShopId } = useShop();
  const [rankingData, setRankingData] = useState<RankingRow[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchRanking = useCallback(async () => {
    if (!selectedShopId) return;
    setLoading(true);
    try {
      const res = await api.get(`/api/shop/${selectedShopId}/ranking_search_setting`);
      if (Array.isArray(res.data) && res.data.length > 0) {
        setRankingData(res.data);
      }
    } catch {
      // API error - keep empty
    } finally {
      setLoading(false);
    }
  }, [selectedShopId]);

  useEffect(() => { fetchRanking(); }, [fetchRanking]);

  if (!apiConnected) {
    return (
      <div className="animate-fade-in">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">ランキング・順位追跡</h1>
          <p className="text-slate-400 text-sm mt-1">対策キーワードの検索順位をリアルタイムで追跡・分析</p>
        </div>
        <div className="bg-[#1e293b] rounded-xl p-8 border border-white/5 text-center">
          <p className="text-slate-400">Go APIに接続し、店舗を登録すると利用できます</p>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">ランキング・順位追跡</h1>
        <p className="text-slate-400 text-sm mt-1">対策キーワードの検索順位をリアルタイムで追跡・分析</p>
      </div>

      {loading ? (
        <div className="bg-[#1e293b] rounded-xl p-8 border border-white/5 text-center">
          <p className="text-slate-400">読み込み中...</p>
        </div>
      ) : rankingData.length === 0 ? (
        <div className="bg-[#1e293b] rounded-xl p-8 border border-white/5 text-center">
          <p className="text-slate-400">データなし</p>
        </div>
      ) : (
        <div className="bg-[#1e293b] rounded-xl p-5 border border-white/5 mb-6">
          <h2 className="text-lg font-bold text-white mb-4">キーワード別順位</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-400 border-b border-white/10">
                <th className="text-left py-2 px-3">キーワード</th>
                <th className="text-center py-2 px-3">現在順位</th>
                <th className="text-center py-2 px-3">前回</th>
                <th className="text-center py-2 px-3">最高順位</th>
                <th className="text-center py-2 px-3">目標</th>
                <th className="text-center py-2 px-3">変動</th>
              </tr>
            </thead>
            <tbody>
              {rankingData.map((row) => (
                <tr key={row.keyword} className="border-b border-white/5 hover:bg-white/5">
                  <td className="py-3 px-3 text-white font-medium">{row.keyword}</td>
                  <td className="py-3 px-3 text-center">
                    <span className={`text-lg font-bold ${row.current <= row.target ? "text-green-400" : "text-orange-400"}`}>
                      {row.current}位
                    </span>
                  </td>
                  <td className="py-3 px-3 text-center text-slate-400">{row.prev}位</td>
                  <td className="py-3 px-3 text-center text-blue-400">{row.best}位</td>
                  <td className="py-3 px-3 text-center text-slate-300">{row.target}位</td>
                  <td className="py-3 px-3 text-center">
                    {row.trend === "up" && <span className="text-green-400">上昇</span>}
                    {row.trend === "down" && <span className="text-red-400">下降</span>}
                    {row.trend === "stable" && <span className="text-slate-400">維持</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
