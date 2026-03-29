"use client";

import { useEffect, useCallback, useState } from "react";
import FeatureCard from "@/components/feature-card";
import api from "@/lib/api";
import { useShop } from "@/components/shop-provider";

const mockRankingData = [
  { keyword: "渋谷 居酒屋", current: 3, prev: 5, best: 2, target: 3, trend: "up" },
  { keyword: "渋谷 飲み放題", current: 7, prev: 8, best: 4, target: 5, trend: "up" },
  { keyword: "渋谷 焼肉 デート", current: 2, prev: 2, best: 1, target: 3, trend: "stable" },
  { keyword: "渋谷 個室 居酒屋", current: 12, prev: 6, best: 4, target: 5, trend: "down" },
  { keyword: "渋谷駅 ランチ", current: 15, prev: 18, best: 10, target: 10, trend: "up" },
];

const scheduleData = [
  { day: "月曜", time: "09:00", keywords: 5, status: "completed" },
  { day: "火曜", time: "09:00", keywords: 5, status: "completed" },
  { day: "水曜", time: "09:00", keywords: 5, status: "scheduled" },
  { day: "木曜", time: "09:00", keywords: 5, status: "scheduled" },
  { day: "金曜", time: "09:00", keywords: 5, status: "scheduled" },
];

export default function RankingPage() {
  const { selectedShopId } = useShop();
  const [rankingData, setRankingData] = useState(mockRankingData);

  const fetchRanking = useCallback(async () => {
    if (!selectedShopId) return;
    try {
      const res = await api.get(`/api/shop/${selectedShopId}/ranking_search_setting`);
      if (Array.isArray(res.data) && res.data.length > 0) {
        setRankingData(res.data);
      }
    } catch {
      // モックデータを使用
    }
  }, [selectedShopId]);

  useEffect(() => { fetchRanking(); }, [fetchRanking]);

  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">ランキング・順位追跡</h1>
        <p className="text-slate-400 text-sm mt-1">対策キーワードの検索順位をリアルタイムで追跡・分析</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: "計測キーワード数", value: "5", sub: "全アクティブ" },
          { label: "TOP3達成率", value: "40%", sub: "2/5 キーワード" },
          { label: "平均順位", value: "7.8位", sub: "先月比 +2.1↑" },
          { label: "最高順位", value: "2位", sub: "渋谷 焼肉 デート" },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-[#1e293b] rounded-xl p-4 border border-white/5">
            <p className="text-xs text-slate-400">{kpi.label}</p>
            <p className="text-2xl font-bold text-white mt-1">{kpi.value}</p>
            <p className="text-xs text-slate-500 mt-1">{kpi.sub}</p>
          </div>
        ))}
      </div>

      {/* Ranking Table */}
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
                  {row.trend === "up" && <span className="text-green-400">📈 上昇</span>}
                  {row.trend === "down" && <span className="text-red-400">📉 下降</span>}
                  {row.trend === "stable" && <span className="text-slate-400">➡️ 維持</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Schedule */}
      <div className="bg-[#1e293b] rounded-xl p-5 border border-white/5 mb-6">
        <h2 className="text-lg font-bold text-white mb-4">計測スケジュール</h2>
        <div className="grid grid-cols-5 gap-3">
          {scheduleData.map((s) => (
            <div key={s.day} className={`rounded-lg p-3 text-center ${s.status === "completed" ? "bg-green-500/10 border border-green-500/20" : "bg-blue-500/10 border border-blue-500/20"}`}>
              <p className="text-xs text-slate-400">{s.day}</p>
              <p className="text-sm font-bold text-white mt-1">{s.time}</p>
              <p className="text-xs text-slate-400 mt-1">{s.keywords}KW</p>
              <p className={`text-xs mt-1 ${s.status === "completed" ? "text-green-400" : "text-blue-400"}`}>
                {s.status === "completed" ? "✅ 完了" : "⏳ 予定"}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Feature Cards */}
      <h2 className="text-lg font-bold text-white mb-4">機能一覧</h2>
      <div className="grid grid-cols-2 gap-4">
        <FeatureCard title="MEOランキング検索・順位追跡" description="対策キーワード×曜日×時間帯別に検索順位を自動取得。" icon="📍" />
        <FeatureCard title="ランキング推移チャート" description="キーワード別の順位推移を折れ線グラフで可視化。" icon="📈" />
        <FeatureCard title="ランキング検索設定" description="店舗ごとに対策キーワード・計測曜日・計測時間帯を設定。" icon="⚙️" />
        <FeatureCard title="競合順位比較" description="同一キーワードで自店舗と競合店舗の順位を並べて比較。" icon="🏁" />
        <FeatureCard title="順位変動アラート" description="順位が急落・急上昇した場合に即時通知。" icon="🚨" />
        <FeatureCard title="エリア別順位ヒートマップ" description="地図上にエリア別の検索順位をヒートマップ表示。" icon="🗺️" />
        <FeatureCard title="任意時間のKW順位測定" description="任意のタイミングで即時に順位を計測。" icon="⏱️" />
      </div>
    </div>
  );
}
