"use client";

import FeatureCard from "@/components/feature-card";

const connectedMedia = [
  { name: "Instagram", icon: "📸", followers: "2,450", posts: 124, status: "connected" },
  { name: "TikTok", icon: "🎵", followers: "890", posts: 45, status: "connected" },
  { name: "Facebook", icon: "📘", followers: "1,200", posts: 89, status: "connected" },
  { name: "X (Twitter)", icon: "🐦", followers: "560", posts: 67, status: "connected" },
  { name: "Threads", icon: "🧵", followers: "180", posts: 12, status: "connected" },
  { name: "食べログ", icon: "🍽️", followers: "-", posts: 0, status: "connected" },
  { name: "ホットペッパー", icon: "🌶️", followers: "-", posts: 0, status: "connected" },
  { name: "Yahoo!プレイス", icon: "🔍", followers: "-", posts: 0, status: "pending" },
  { name: "Apple Maps", icon: "🍎", followers: "-", posts: 0, status: "connected" },
  { name: "公式LINE", icon: "💚", followers: "3,200", posts: 34, status: "connected" },
];

const calendarEvents = [
  { date: "3/18", platform: "GBP", type: "投稿", title: "本日のおすすめ" },
  { date: "3/18", platform: "Instagram", type: "リール", title: "和牛カット動画" },
  { date: "3/19", platform: "TikTok", type: "動画", title: "厨房の様子" },
  { date: "3/20", platform: "GBP+全SNS", type: "一括投稿", title: "春の限定メニュー" },
  { date: "3/21", platform: "LINE", type: "お知らせ", title: "週末予約案内" },
];

export default function MediaPage() {
  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">多媒体管理</h1>
          <p className="text-sm text-slate-500 mt-1">SNS・グルメサイト・マップ等の一元管理</p>
        </div>
        <button className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition">
          + 新規連携
        </button>
      </div>

      {/* Connected media */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        {connectedMedia.map((media) => (
          <div key={media.name} className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 text-center card-hover">
            <span className="text-2xl">{media.icon}</span>
            <p className="text-xs font-medium text-slate-700 mt-2">{media.name}</p>
            {media.followers !== "-" && (
              <p className="text-[10px] text-slate-400 mt-0.5">{media.followers} フォロワー</p>
            )}
            <div className="mt-2">
              {media.status === "connected" && <span className="text-[10px] text-emerald-600 font-medium">● 連携中</span>}
              {media.status === "pending" && <span className="text-[10px] text-amber-600 font-medium">● 連携待ち</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Cross-platform calendar */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 mb-6">
        <h3 className="text-sm font-semibold text-slate-500 mb-3">クロスプラットフォーム投稿カレンダー</h3>
        <p className="text-xs text-slate-400 mb-3">全SNS・全媒体の投稿スケジュールを1つのカレンダーで一元管理</p>
        <div className="space-y-2">
          {calendarEvents.map((event, i) => (
            <div key={i} className="flex items-center gap-4 p-3 bg-slate-50 rounded-lg">
              <span className="text-sm font-medium text-slate-500 w-12">{event.date}</span>
              <span className="badge badge-info">{event.platform}</span>
              <span className="badge badge-purple">{event.type}</span>
              <span className="text-sm text-slate-700">{event.title}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Media library */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 mb-6">
        <h3 className="text-sm font-semibold text-slate-500 mb-3">統合メディアライブラリ</h3>
        <p className="text-xs text-slate-400 mb-3">画像/動画/文言/リンクの一元管理と媒体別変換</p>
        <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-square bg-slate-100 rounded-lg flex items-center justify-center text-slate-400 text-xs">
              {i < 6 ? "📷" : "🎥"}
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <button className="text-xs px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg">アップロード</button>
          <button className="text-xs px-3 py-1.5 bg-purple-50 text-purple-600 rounded-lg">AI画像生成</button>
          <button className="text-xs px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-lg">動画編集</button>
        </div>
      </div>

      {/* Social listening */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 mb-6">
        <h3 className="text-sm font-semibold text-slate-500 mb-3">ソーシャルリスニング</h3>
        <p className="text-xs text-slate-400 mb-3">SNS上で自店舗・ブランドに関する言及を自動収集＆通知</p>
        <div className="space-y-2">
          {[
            { platform: "Instagram", text: "@yakiniku_homura で友達とディナー！最高だった🔥", user: "@foodie_tokyo", sentiment: "positive" },
            { platform: "X", text: "渋谷の炎って焼肉屋、めちゃくちゃ美味い", user: "@gourmet_walker", sentiment: "positive" },
            { platform: "TikTok", text: "#渋谷焼肉 #炎 コスパ最強でした", user: "@tokyo_eats", sentiment: "positive" },
          ].map((mention, i) => (
            <div key={i} className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
              <span className="badge badge-info">{mention.platform}</span>
              <div className="flex-1">
                <p className="text-sm text-slate-700">{mention.text}</p>
                <p className="text-xs text-slate-400 mt-0.5">{mention.user}</p>
              </div>
              <span className="badge badge-success">好意的</span>
              <button className="text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded">再利用</button>
            </div>
          ))}
        </div>
      </div>

      {/* All features */}
      <h3 className="text-sm font-semibold text-slate-500 mb-3">多媒体管理 機能一覧</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <FeatureCard icon="📸" title="Instagram広告管理" description="広告出稿、停止、数値すべてシステムで管理。分析結果も表示。" status="active" />
        <FeatureCard icon="🎵" title="TIKTOK広告管理" description="TikTok Marketing APIで広告の出稿/停止/KPI取得→ダッシュボードに表示" status="active" />
        <FeatureCard icon="🛒" title="EC管理" description="ECサイトの広告、売上管理。" status="coming" />
        <FeatureCard icon="🔥" title="SNSから人気メニュー抜粋" description="同ジャンルの他店舗で流行っているメニューをSNSから自動抽出。" status="beta" />
        <FeatureCard icon="📱" title="SNS運用ツール" description="Instagram、TikTok等のSNS投稿やインサイト分析を一元管理。" status="active" />
        <FeatureCard icon="🍽️" title="食べログ/HP等の管理" description="API連携でGoogle＋他媒体を一元管理。情報の一括更新。" status="active" />
        <FeatureCard icon="🗺️" title="マップ系API連携" description="Yahoo!プレイス、Apple Maps等のマップサービスと連携。" status="active" />
        <FeatureCard icon="🌏" title="海外SNSに自動翻訳で投稿、インサイト管理" description="大衆点評/RED/Snapchat等の海外SNS APIで自動投稿" status="coming" />
        <FeatureCard icon="📰" title="最新Googleアップデート通知" description="Googleのアルゴリズム変更等の最新情報をオンタイムで通知。" status="active" />
        <FeatureCard icon="🎬" title="動画編集機能" description="動画を編集してそのままSNSへ投稿。テンプレートも用意。" status="beta" />
        <FeatureCard icon="🖼️" title="POP作成" description="AIで文字ベースの情報を入力すればPOPを自動デザイン。" status="coming" />
        <FeatureCard icon="📄" title="メニュー表作成" description="AIで文字情報からメニュー表を作成。発注まで対応。" status="coming" />
        <FeatureCard icon="💚" title="公式LINEからのお知らせ" description="定期配信＆イベント通知をLINE公式アカウントから自動送信。" status="active" />
        <FeatureCard icon="📅" title="クロスプラットフォーム統合カレンダー" description="全SNS・全媒体の投稿スケジュールを1つのカレンダーで一元管理。" status="active" />
        <FeatureCard icon="👂" title="ソーシャルリスニング" description="SNS上で自店舗・ブランドに関する言及を自動収集＆通知。" status="active" />
        <FeatureCard icon="📷" title="UGC（ユーザー生成コンテンツ）収集" description="お客様がSNSに投稿した写真・動画を自動収集し、許可を得て再利用" status="beta" />
      </div>
    </div>
  );
}
