"use client";

import { useShop } from "@/components/shop-provider";
import KpiCard from "@/components/kpi-card";

export default function Dashboard() {
  const { shops, selectedShop, apiConnected } = useShop();
  const storeName = selectedShop?.name || "未選択";
  const shopCount = shops.length;

  const emptyKpi = { title: "", value: 0, change: 0, unit: "" };

  return (
    <div className="animate-fade-in">
      {!apiConnected && (
        <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-blue-700 text-sm font-medium">Go APIに接続し、店舗を登録するとデータが表示されます</p>
          <p className="text-blue-500 text-xs mt-1">店舗情報管理 → 店舗一覧 から店舗を登録してください</p>
        </div>
      )}

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
        <KpiCard label="検索表示回数" value={0} change={0} icon="👁️" />
        <KpiCard label="プロフィール閲覧" value={0} change={0} icon="👤" />
        <KpiCard label="電話タップ" value={0} change={0} icon="📞" />
        <KpiCard label="経路検索" value={0} change={0} icon="🗺️" />
        <KpiCard label="Webサイトクリック" value={0} change={0} icon="🌐" />
        <KpiCard label="今月の口コミ数" value={0} change={0} icon="⭐" />
      </div>

      {/* Empty state */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-6">
        <div className="xl:col-span-2 bg-white rounded-xl p-6 shadow-sm border border-slate-100">
          <h3 className="text-sm font-semibold text-slate-500 mb-4">インサイト推移</h3>
          <div className="flex items-center justify-center h-[300px] text-slate-300 text-sm">
            店舗を登録するとグラフが表示されます
          </div>
        </div>
        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
          <h3 className="text-sm font-semibold text-slate-500 mb-4">MEOスコア</h3>
          <div className="flex items-center justify-center h-[200px] text-slate-300 text-sm">
            データなし
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
          <h3 className="text-sm font-semibold text-slate-500 mb-4">キーワード順位</h3>
          <div className="flex items-center justify-center h-[200px] text-slate-300 text-sm">
            データなし
          </div>
        </div>
        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
          <h3 className="text-sm font-semibold text-slate-500 mb-4">今後の投稿予定</h3>
          <div className="flex items-center justify-center h-[200px] text-slate-300 text-sm">
            データなし
          </div>
        </div>
      </div>
    </div>
  );
}
