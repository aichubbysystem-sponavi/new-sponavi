"use client";

import { useShop } from "@/components/shop-provider";

export default function OtaPage() {
  const { apiConnected } = useShop();

  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">OTA連携</h1>
        <p className="text-sm text-slate-500 mt-1">旅行予約サイト（OTA）との連携・一元管理</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-12 flex flex-col items-center justify-center min-h-[400px]">
        <div className="w-16 h-16 rounded-full bg-[#003D6B]/10 flex items-center justify-center mb-6">
          <svg
            className="w-8 h-8 text-[#003D6B]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
        </div>
        <span className="inline-block px-4 py-1.5 rounded-full bg-[#003D6B]/10 text-[#003D6B] text-sm font-semibold tracking-wide mb-4">
          準備中
        </span>
        <h2 className="text-lg font-bold text-slate-700 mb-2">OTA連携機能</h2>
        <p className="text-sm text-slate-500 text-center max-w-md leading-relaxed">
          この機能は外部API連携が必要です。<br />
          準備が整い次第、ご利用いただけます。
        </p>
      </div>
    </div>
  );
}
