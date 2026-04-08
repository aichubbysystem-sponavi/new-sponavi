"use client";

import { useShop } from "@/components/shop-provider";

export default function AioPage() {
  const { apiConnected } = useShop();

  return (
    <div className="animate-fade-in">
      <h1 className="text-2xl font-bold text-slate-800 mb-2">AIO対策</h1>
      <p className="text-sm text-slate-500 mb-6">AI Overview・AIエンジン検索対策</p>
      <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
        <p className="text-slate-400 text-sm mb-2">
          {apiConnected ? "店舗を選択してください" : "Go APIに接続し、店舗を登録するとAIO対策データが表示されます"}
        </p>
        <p className="text-slate-300 text-xs">AI検索でのサイテーション状況を分析します</p>
      </div>
    </div>
  );
}
