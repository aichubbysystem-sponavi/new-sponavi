"use client";

import FeatureCard from "@/components/feature-card";

const citationSources = [
  { name: "Google ビジネスプロフィール", status: "synced", napMatch: true, lastSync: "3/18 09:00" },
  { name: "食べログ", status: "synced", napMatch: false, lastSync: "3/18 08:30" },
  { name: "ホットペッパー", status: "synced", napMatch: true, lastSync: "3/17 22:00" },
  { name: "Apple Maps", status: "synced", napMatch: true, lastSync: "3/16 15:00" },
  { name: "Yahoo!プレイス", status: "pending", napMatch: false, lastSync: "未連携" },
  { name: "Bing Places", status: "pending", napMatch: false, lastSync: "未連携" },
  { name: "TripAdvisor", status: "synced", napMatch: true, lastSync: "3/15 10:00" },
  { name: "Foursquare", status: "not_connected", napMatch: false, lastSync: "未連携" },
  { name: "Instagram", status: "synced", napMatch: true, lastSync: "3/18 07:00" },
  { name: "自社プラットフォーム", status: "synced", napMatch: true, lastSync: "3/18 06:00" },
];

export default function CitationPage() {
  const napScore = Math.round(
    (citationSources.filter((s) => s.napMatch).length / citationSources.filter((s) => s.status === "synced").length) * 100
  );

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">サイテーション</h1>
          <p className="text-sm text-slate-500 mt-1">NAP情報の一元管理・多媒体同期</p>
        </div>
        <div className="flex gap-2">
          <button className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition">
            全媒体に一括同期
          </button>
          <button className="px-4 py-2 border border-slate-200 text-sm rounded-lg hover:bg-slate-50 transition">
            NAP情報を編集
          </button>
        </div>
      </div>

      {/* NAP score */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 text-center">
          <p className="text-sm text-slate-500 mb-1">NAP一貫性スコア</p>
          <p className={`text-4xl font-bold ${napScore >= 80 ? "text-emerald-600" : "text-amber-600"}`}>{napScore}%</p>
          <p className="text-xs text-slate-400 mt-1">全連携媒体中</p>
        </div>
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 text-center">
          <p className="text-sm text-slate-500 mb-1">連携媒体数</p>
          <p className="text-4xl font-bold text-blue-600">
            {citationSources.filter((s) => s.status === "synced").length}
          </p>
          <p className="text-xs text-slate-400 mt-1">/ {citationSources.length} 媒体</p>
        </div>
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 text-center">
          <p className="text-sm text-slate-500 mb-1">不一致検出</p>
          <p className="text-4xl font-bold text-red-600">
            {citationSources.filter((s) => s.status === "synced" && !s.napMatch).length}
          </p>
          <p className="text-xs text-slate-400 mt-1">要修正</p>
        </div>
      </div>

      {/* NAP info */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 mb-6">
        <h3 className="text-sm font-semibold text-slate-500 mb-3">マスター NAP情報</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs font-medium text-slate-400">Name（店舗名）</label>
            <p className="text-sm font-medium text-slate-800 mt-0.5">焼肉ダイニング 炎 渋谷店</p>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-400">Address（住所）</label>
            <p className="text-sm font-medium text-slate-800 mt-0.5">東京都渋谷区道玄坂1-2-3</p>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-400">Phone（電話番号）</label>
            <p className="text-sm font-medium text-slate-800 mt-0.5">03-1234-5678</p>
          </div>
        </div>
      </div>

      {/* Citation sources */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 mb-6">
        <div className="p-5 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-500">サイテーション媒体一覧</h3>
        </div>
        <div className="divide-y divide-slate-50">
          {citationSources.map((source) => (
            <div key={source.name} className="p-4 flex items-center justify-between hover:bg-slate-50/50 transition">
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${
                  source.status === "synced" ? "bg-emerald-500" :
                  source.status === "pending" ? "bg-amber-500" : "bg-slate-300"
                }`} />
                <div>
                  <p className="text-sm font-medium text-slate-700">{source.name}</p>
                  <p className="text-xs text-slate-400">最終同期: {source.lastSync}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {source.status === "synced" && !source.napMatch && (
                  <span className="badge badge-danger">NAP不一致</span>
                )}
                {source.status === "synced" && source.napMatch && (
                  <span className="badge badge-success">一致</span>
                )}
                {source.status === "pending" && (
                  <span className="badge badge-warning">同期待ち</span>
                )}
                {source.status === "not_connected" && (
                  <span className="badge badge-info">未連携</span>
                )}
                <button className={`text-xs px-3 py-1.5 rounded-lg font-medium ${
                  source.status === "synced" && !source.napMatch
                    ? "bg-red-50 text-red-600 hover:bg-red-100"
                    : source.status === "not_connected"
                    ? "bg-blue-50 text-blue-600 hover:bg-blue-100"
                    : "bg-slate-50 text-slate-600 hover:bg-slate-100"
                }`}>
                  {source.status === "synced" && !source.napMatch ? "修正依頼" :
                   source.status === "not_connected" ? "連携する" : "詳細"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* All features */}
      <h3 className="text-sm font-semibold text-slate-500 mb-3">サイテーション 機能一覧</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <FeatureCard icon="🔗" title="多媒体同時投稿" description="GBPに更新した記事内容・写真がOTA/SNS/Webサイト等の他媒体に同時投稿される。" status="active" />
        <FeatureCard icon="🌐" title="自社プラットフォーム掲載" description="自社システム利用店舗でプラットフォームを作成し、店舗情報を掲載。" status="active" />
        <FeatureCard icon="📊" title="サイテーション一貫性スコア" description="各媒体でのNAP情報の一致度をスコア化(0-100%)→不一致箇所をハイライト" status="active" />
        <FeatureCard icon="🔍" title="不正確な掲載情報の自動検出＆修正依頼" description="NAP不一致の媒体を自動検出し、修正リクエストを一括送信" status="active" />
        <FeatureCard icon="💡" title="新規掲載先レコメンド" description="業種に合った未掲載の媒体（地域ポータル・業種特化サイト等）を自動提案。" status="beta" />
        <FeatureCard icon="📋" title="構造化データで記事出力" description="サイテーション記事を構造化データ（Schema.org）付きで出力。" status="coming" />
        <FeatureCard icon="✅" title="NAP情報の統一" description="全媒体のNAP情報を一括で統一管理。不一致を自動検出・修正。" status="active" />
      </div>
    </div>
  );
}
