"use client";

import FeatureCard from "@/components/feature-card";

const otaPlatforms = [
  { name: "TripAdvisor", icon: "🦉", status: "connected", reviews: 45, rating: 4.3, listings: 1 },
  { name: "Booking.com", icon: "🏨", status: "connected", reviews: 0, rating: 0, listings: 1 },
  { name: "Expedia Group", icon: "✈️", status: "pending", reviews: 0, rating: 0, listings: 0 },
  { name: "Vrbo", icon: "🏡", status: "not_connected", reviews: 0, rating: 0, listings: 0 },
  { name: "Agoda", icon: "🌏", status: "not_connected", reviews: 0, rating: 0, listings: 0 },
  { name: "Airbnb", icon: "🏠", status: "not_connected", reviews: 0, rating: 0, listings: 0 },
];

export default function OtaPage() {
  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">OTA連携</h1>
          <p className="text-sm text-slate-500 mt-1">旅行予約サイト（OTA）との連携・一元管理</p>
        </div>
        <button className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition">
          + OTAを追加
        </button>
      </div>

      {/* OTA grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {otaPlatforms.map((ota) => (
          <div key={ota.name} className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 card-hover">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-3xl">{ota.icon}</span>
              <div>
                <h4 className="text-sm font-semibold text-slate-800">{ota.name}</h4>
                {ota.status === "connected" && <span className="badge badge-success">連携済み</span>}
                {ota.status === "pending" && <span className="badge badge-warning">設定中</span>}
                {ota.status === "not_connected" && <span className="badge badge-info">未連携</span>}
              </div>
            </div>
            {ota.status === "connected" && (
              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="bg-slate-50 rounded p-2 text-center">
                  <p className="text-[10px] text-slate-400">レビュー</p>
                  <p className="text-sm font-bold text-slate-700">{ota.reviews}</p>
                </div>
                <div className="bg-slate-50 rounded p-2 text-center">
                  <p className="text-[10px] text-slate-400">評価</p>
                  <p className="text-sm font-bold text-yellow-600">★{ota.rating}</p>
                </div>
                <div className="bg-slate-50 rounded p-2 text-center">
                  <p className="text-[10px] text-slate-400">掲載</p>
                  <p className="text-sm font-bold text-slate-700">{ota.listings}件</p>
                </div>
              </div>
            )}
            <button className={`w-full text-xs py-2 rounded-lg font-medium transition ${
              ota.status === "connected"
                ? "bg-slate-50 text-slate-600 hover:bg-slate-100"
                : "bg-blue-600 text-white hover:bg-blue-700"
            }`}>
              {ota.status === "connected" ? "管理画面" :
               ota.status === "pending" ? "設定を完了" : "連携する"}
            </button>
          </div>
        ))}
      </div>

      {/* Channel manager */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 mb-6">
        <h3 className="text-sm font-semibold text-slate-500 mb-3">OTAチャネルマネージャー</h3>
        <p className="text-xs text-slate-400 mb-4">複数OTAを一括運用するための共通ハブ。在庫・料金・予約を一元管理。</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
            <p className="text-xs font-medium text-blue-700">在庫同期</p>
            <p className="text-xs text-blue-600 mt-1">全OTAの在庫をリアルタイム同期。ダブルブッキング防止。</p>
          </div>
          <div className="p-3 bg-purple-50 rounded-lg border border-purple-100">
            <p className="text-xs font-medium text-purple-700">料金一括更新</p>
            <p className="text-xs text-purple-600 mt-1">季節・イベントに応じて全OTAの料金を一括変更。</p>
          </div>
          <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-100">
            <p className="text-xs font-medium text-emerald-700">予約管理</p>
            <p className="text-xs text-emerald-600 mt-1">全OTAからの予約を一画面で確認・管理。</p>
          </div>
        </div>
      </div>

      {/* All features */}
      <h3 className="text-sm font-semibold text-slate-500 mb-3">OTA連携 機能一覧</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <FeatureCard icon="🦉" title="TripAdvisor Content API連携" description="施設情報、写真、レビュー、位置情報の取得/表示。" status="active" />
        <FeatureCard icon="💰" title="TripAdvisor Hotel Pricing API" description="予約導線用の価格表示・送客。" status="active" />
        <FeatureCard icon="🏨" title="Booking.com Connectivity API" description="施設情報、在庫、料金、予約などの同期。" status="active" />
        <FeatureCard icon="💬" title="Booking.com Messaging連携" description="接続承認管理、ゲストメッセージ運用。" status="active" />
        <FeatureCard icon="✈️" title="Expedia施設オンボーディング" description="施設の新規登録・更新・状態取得。" status="beta" />
        <FeatureCard icon="📦" title="Expedia在庫・料金・予約連携" description="在庫・料金更新、予約通知/取得、予約ライフサイクル管理。" status="beta" />
        <FeatureCard icon="🏡" title="Vrbo連携" description="Vrboの掲載、予約、レビュー等との連携。" status="coming" />
        <FeatureCard icon="🌏" title="Agoda連携" description="Agoda上の在庫・料金・予約運用。" status="coming" />
        <FeatureCard icon="🏠" title="Airbnb連携" description="掲載情報・予約・通知・運用連携。" status="coming" />
        <FeatureCard icon="🔄" title="OTAチャネルマネージャー" description="複数OTAを一括運用するための共通ハブ。在庫・料金の一元管理。" status="active" />
      </div>
    </div>
  );
}
