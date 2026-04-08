"use client";

import { useShop } from "@/components/shop-provider";

export default function ChatbotPage() {
  const { apiConnected } = useShop();

  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">チャットボット</h1>
        <p className="text-sm text-slate-500 mt-1">AIサポート・タスク管理・LINE連携</p>
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
