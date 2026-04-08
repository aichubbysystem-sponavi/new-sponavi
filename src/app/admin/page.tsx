"use client";

import { useShop } from "@/components/shop-provider";

export default function AdminPage() {
  const { apiConnected } = useShop();

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">システム管理</h1>
          <p className="text-sm text-slate-500 mt-1">認証・ジョブ管理・監査ログ・データ基盤</p>
        </div>
      </div>

      <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
        <p className="text-slate-400 text-sm mb-2">
          {apiConnected ? "システム管理機能はGo APIから取得したデータで動作します" : "Go APIに接続するとシステム管理機能が利用できます"}
        </p>
        <p className="text-slate-300 text-xs">認証・トークン管理、ジョブ管理、監査ログ、権限管理</p>
      </div>
    </div>
  );
}
