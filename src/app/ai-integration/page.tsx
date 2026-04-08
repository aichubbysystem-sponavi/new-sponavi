"use client";

import { useShop } from "@/components/shop-provider";

export default function AiIntegrationPage() {
  const { apiConnected } = useShop();

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">AI社長・AI課長</h1>
          <p className="text-slate-500 text-sm mt-1">AI統合管理・ナレッジベース・自動タスク</p>
        </div>
      </div>
      <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
        <p className="text-slate-400 text-sm mb-2">
          {apiConnected ? "AI統合機能は準備中です" : "Go APIに接続するとAI統合機能が利用できます"}
        </p>
        <p className="text-slate-300 text-xs">Difyナレッジベース・Slack連携・LINE自動応答・タスク自動生成</p>
      </div>
    </div>
  );
}
