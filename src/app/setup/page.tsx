"use client";

import { useShop } from "@/components/shop-provider";

export default function SetupPage() {
  const { apiConnected } = useShop();

  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">初期整備</h1>
        <p className="text-sm text-slate-500 mt-1">GBP最適化の初期設定・ヒアリング</p>
      </div>

      {!apiConnected ? (
        <div className="bg-white rounded-xl p-8 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-500">Go APIに接続し、店舗を登録すると利用できます</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl p-8 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400">データなし</p>
        </div>
      )}
    </div>
  );
}
