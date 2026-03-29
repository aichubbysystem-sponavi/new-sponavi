"use client";

import dynamic from "next/dynamic";
import { useState, useEffect } from "react";

const AreaChart = dynamic(() => import("recharts").then((m) => m.AreaChart), { ssr: false });
const Area = dynamic(() => import("recharts").then((m) => m.Area), { ssr: false });
const XAxis = dynamic(() => import("recharts").then((m) => m.XAxis), { ssr: false });
const YAxis = dynamic(() => import("recharts").then((m) => m.YAxis), { ssr: false });
const CartesianGrid = dynamic(() => import("recharts").then((m) => m.CartesianGrid), { ssr: false });
const Tooltip = dynamic(() => import("recharts").then((m) => m.Tooltip), { ssr: false });
const ResponsiveContainer = dynamic(() => import("recharts").then((m) => m.ResponsiveContainer), { ssr: false });
const Legend = dynamic(() => import("recharts").then((m) => m.Legend), { ssr: false });
import KpiCard from "@/components/kpi-card";
import MeoScore from "@/components/meo-score";
import { kpiData, monthlyInsights, rankingData, scheduledPosts, currentStore } from "@/lib/mock-data";
import api from "@/lib/api";

export default function Dashboard() {
  const [shopCount, setShopCount] = useState(0);
  const [storeName, setStoreName] = useState("読み込み中...");
  const [apiConnected, setApiConnected] = useState<boolean | null>(null);

  useEffect(() => {
    const f = async () => {
      try {
        const res = await api.get("/api/shop");
        const data = Array.isArray(res.data) ? res.data : [];
        setShopCount(data.length);
        if (data.length > 0) setStoreName(data[0].name);
        setApiConnected(true);
      } catch {
        setStoreName(currentStore.name);
        setShopCount(1);
        setApiConnected(false);
      }
    }; f();
  }, []);

  return (
    <div className="animate-fade-in">
      {/* API接続状態 */}
      {apiConnected === false && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2">
          <span className="text-amber-600 text-sm">Go APIに未接続のため、デモデータを表示しています</span>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">ダッシュボード</h1>
          <p className="text-sm text-slate-500 mt-1">{storeName} — 管理店舗数: {shopCount}</p>
        </div>
        <div className="flex items-center gap-3">
          <select aria-label="表示期間" className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white">
            <option>過去30日間</option>
            <option>過去7日間</option>
            <option>過去90日間</option>
          </select>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        <KpiCard {...kpiData.searchViews} icon="👁️" />
        <KpiCard {...kpiData.profileViews} icon="👤" />
        <KpiCard {...kpiData.phoneClicks} icon="📞" />
        <KpiCard {...kpiData.routeClicks} icon="🗺️" />
        <KpiCard {...kpiData.webClicks} icon="🌐" />
        <KpiCard {...kpiData.reviewsThisMonth} icon="⭐" />
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-6">
        {/* Insights Chart */}
        <div className="xl:col-span-2 bg-white rounded-xl p-6 shadow-sm border border-slate-100">
          <h3 className="text-sm font-semibold text-slate-500 mb-4">インサイト推移</h3>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={monthlyInsights}>
              <defs>
                <linearGradient id="grad1" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="grad2" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend />
              <Area type="monotone" dataKey="検索表示" stroke="#3b82f6" fill="url(#grad1)" strokeWidth={2} />
              <Area type="monotone" dataKey="プロフィール" stroke="#8b5cf6" fill="url(#grad2)" strokeWidth={2} />
              <Area type="monotone" dataKey="経路検索" stroke="#10b981" fill="none" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* MEO Score */}
        <MeoScore score={currentStore.meoScore} />
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Ranking */}
        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
          <h3 className="text-sm font-semibold text-slate-500 mb-4">キーワード順位</h3>
          <div className="space-y-3">
            {rankingData.map((kw, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                <div className="flex items-center gap-3">
                  <span className="text-lg font-bold text-slate-300 w-6">{i + 1}</span>
                  <div>
                    <p className="text-sm font-medium text-slate-700">{kw.keyword}</p>
                    <p className="text-xs text-slate-400">月間検索: {kw.volume.toLocaleString()}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    kw.change > 0 ? "bg-emerald-50 text-emerald-600" :
                    kw.change < 0 ? "bg-red-50 text-red-600" :
                    "bg-slate-50 text-slate-500"
                  }`}>
                    {kw.change > 0 ? `↑${kw.change}` : kw.change < 0 ? `↓${Math.abs(kw.change)}` : "→"}
                  </span>
                  <span className="text-xl font-bold text-blue-600 w-10 text-right">{kw.rank}位</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Upcoming posts */}
        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-500">今後の投稿予定</h3>
            <a href="/posts" className="text-xs text-blue-500 hover:underline">すべて見る →</a>
          </div>
          <div className="space-y-3">
            {scheduledPosts.map((post) => (
              <div key={post.id} className="flex items-start gap-3 p-3 rounded-lg bg-slate-50 hover:bg-slate-100 transition">
                <div className="text-center min-w-[50px]">
                  <p className="text-xs text-slate-400">{post.date.slice(5)}</p>
                  <p className="text-xs text-slate-400">{post.time}</p>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`badge ${
                      post.status === "published" ? "badge-success" :
                      post.status === "scheduled" ? "badge-info" :
                      "badge-warning"
                    }`}>
                      {post.status === "published" ? "公開済み" :
                       post.status === "scheduled" ? "予約済み" : "下書き"}
                    </span>
                    <span className="badge badge-purple">{post.type}</span>
                  </div>
                  <p className="text-sm font-medium text-slate-700 mt-1">{post.title}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{post.platform}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
