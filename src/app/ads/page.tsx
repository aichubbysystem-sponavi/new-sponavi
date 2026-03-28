"use client";

import FeatureCard from "@/components/feature-card";

const adPlatforms = [
  { name: "Google 広告", icon: "🔍", status: "connected", campaigns: 3, spend: 150000, cv: 89 },
  { name: "Meta 広告（Instagram/Facebook）", icon: "📱", status: "connected", campaigns: 2, spend: 80000, cv: 45 },
  { name: "TikTok 広告", icon: "🎵", status: "connected", campaigns: 1, spend: 30000, cv: 22 },
  { name: "X（Twitter）広告", icon: "🐦", status: "not_connected", campaigns: 0, spend: 0, cv: 0 },
  { name: "Threads 広告", icon: "🧵", status: "coming", campaigns: 0, spend: 0, cv: 0 },
];

export default function AdsPage() {
  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">広告管理</h1>
          <p className="text-sm text-slate-500 mt-1">Google・Meta・TikTok・X の広告を一元管理</p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
          <p className="text-xs text-slate-500">総広告費（今月）</p>
          <p className="text-2xl font-bold text-slate-800">¥260,000</p>
        </div>
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
          <p className="text-xs text-slate-500">総CV数</p>
          <p className="text-2xl font-bold text-emerald-600">156</p>
        </div>
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
          <p className="text-xs text-slate-500">平均CPA</p>
          <p className="text-2xl font-bold text-purple-600">¥1,667</p>
        </div>
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
          <p className="text-xs text-slate-500">平均ROAS</p>
          <p className="text-2xl font-bold text-blue-600">320%</p>
        </div>
      </div>

      {/* Platforms */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 mb-6">
        <div className="p-5 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-500">広告プラットフォーム</h3>
        </div>
        <div className="divide-y divide-slate-50">
          {adPlatforms.map((platform) => (
            <div key={platform.name} className="p-5 flex items-center justify-between hover:bg-slate-50/50 transition">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{platform.icon}</span>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-medium text-slate-800">{platform.name}</h4>
                    {platform.status === "connected" && <span className="badge badge-success">連携済み</span>}
                    {platform.status === "not_connected" && <span className="badge badge-warning">未連携</span>}
                    {platform.status === "coming" && <span className="badge badge-info">Coming Soon</span>}
                  </div>
                  {platform.status === "connected" && (
                    <p className="text-xs text-slate-400 mt-0.5">
                      {platform.campaigns}キャンペーン | ¥{platform.spend.toLocaleString()} | {platform.cv} CV
                    </p>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                {platform.status === "connected" && (
                  <>
                    <button className="text-xs px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg font-medium">レポート</button>
                    <button className="text-xs px-3 py-1.5 bg-slate-50 text-slate-600 rounded-lg font-medium">管理画面</button>
                  </>
                )}
                {platform.status === "not_connected" && (
                  <button className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg font-medium">連携する</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* All ad features */}
      <h3 className="text-sm font-semibold text-slate-500 mb-3">広告管理 機能一覧</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <FeatureCard icon="🔍" title="Google広告アカウント作成・MCC連携" description="アカウント作成、MCC配下管理、認証連携をシステム上で完結。" status="active" />
        <FeatureCard icon="📢" title="Google P-Maxキャンペーン運用" description="P-Max作成、Asset Group管理、予算・入札・地域設定" status="active" />
        <FeatureCard icon="📊" title="Google広告レポート取得" description="キャンペーン別・アセット別・日次KPIを自動取得・表示。" status="active" />
        <FeatureCard icon="📱" title="Meta広告アカウント/BM連携" description="Business Manager、広告アカウント、権限の一括連携。" status="active" />
        <FeatureCard icon="📸" title="Meta広告キャンペーン運用" description="Campaign / Ad Set / Ad / Creative 作成・更新・停止。" status="active" />
        <FeatureCard icon="📈" title="Meta広告レポート取得" description="KPIをアカウント/キャンペーン/広告セット/広告粒度で分析。" status="active" />
        <FeatureCard icon="🧵" title="Threads広告配信" description="Threadsフィード面への広告配信。" status="coming" />
        <FeatureCard icon="🎵" title="TikTok広告キャンペーン運用" description="広告作成、管理、データ取得をシステム上で完結。" status="active" />
        <FeatureCard icon="📲" title="TikTok広告イベント計測" description="Web/App/Offlineのイベント送信、最適化用CV連携。" status="active" />
        <FeatureCard icon="🐦" title="X広告アカウント作成" description="X広告アカウント開設、課金情報設定をシステム内で。" status="beta" />
        <FeatureCard icon="📣" title="X広告キャンペーン運用" description="キャンペーン、ターゲティング、クリエイティブ、分析の自動化。" status="beta" />
        <FeatureCard icon="🎯" title="Xコンバージョン計測" description="Webコンバージョン計測、最適化用イベント送信。" status="beta" />
      </div>
    </div>
  );
}
