"use client";

import { useShop } from "@/components/shop-provider";

export default function DiagnosisPage() {
  const { apiConnected } = useShop();

  return (
    <div className="animate-fade-in">
      <h1 className="text-2xl font-bold text-slate-800 mb-6">店舗診断</h1>
      <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
        <p className="text-slate-400 text-sm mb-2">
          {apiConnected ? "店舗を選択してください" : "Go APIに接続し、店舗を登録すると診断結果が表示されます"}
        </p>
        <p className="text-slate-300 text-xs">GBPの基本情報、口コミ、投稿状況を自動診断します</p>
      </div>
    </div>
  );
}
