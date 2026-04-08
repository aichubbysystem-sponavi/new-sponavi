"use client";

import { useShop } from "@/components/shop-provider";

export default function ReportsPage() {
  const { apiConnected } = useShop();

  return (
    <div className="animate-fade-in">
      <h1 className="text-2xl font-bold text-slate-800 mb-2">店舗パフォーマンス</h1>
      <p className="text-sm text-slate-500 mb-6">競合分析・コンバージョン・売上予測・口コミ分析</p>
      <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
        <p className="text-slate-400 text-sm mb-2">
          {apiConnected ? "店舗を選択してください" : "Go APIに接続し、店舗を登録するとパフォーマンスデータが表示されます"}
        </p>
        <p className="text-slate-300 text-xs">競合比較・レーダーチャート・売上予測・外部要因分析</p>
      </div>
    </div>
  );
}
