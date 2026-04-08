"use client";

import { useShop } from "@/components/shop-provider";

export default function UserManagementPage() {
  const { apiConnected } = useShop();

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">ユーザー・権限管理</h1>
          <p className="text-slate-500 text-sm mt-1">社長 / マネージャー / バイト の3階層でアクセス制御</p>
        </div>
      </div>
      <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
        <p className="text-slate-400 text-sm mb-2">
          {apiConnected ? "ユーザー管理機能は準備中です" : "Go APIに接続するとユーザー管理が利用できます"}
        </p>
        <p className="text-slate-300 text-xs">ロール別のアクセス制御・ユーザー招待・権限マトリクス</p>
      </div>
    </div>
  );
}
