"use client";

import FeatureCard from "@/components/feature-card";

const platforms = [
  {
    name: "Instagram",
    icon: "📸",
    posts: [
      { type: "画像", title: "本日の特選盛り合わせ", date: "3/18", likes: 45, reach: 1200, status: "published" },
      { type: "リール", title: "和牛カット動画", date: "3/20", likes: 0, reach: 0, status: "scheduled" },
    ],
  },
  {
    name: "Facebook",
    icon: "📘",
    posts: [
      { type: "投稿", title: "春の限定メニューのお知らせ", date: "3/17", likes: 23, reach: 890, status: "published" },
    ],
  },
  {
    name: "TikTok",
    icon: "🎵",
    posts: [
      { type: "動画", title: "厨房の裏側見せます", date: "3/19", likes: 0, reach: 0, status: "scheduled" },
    ],
  },
  {
    name: "X (Twitter)",
    icon: "🐦",
    posts: [
      { type: "投稿", title: "今週末の予約まだ空きあります", date: "3/18", likes: 12, reach: 450, status: "published" },
    ],
  },
  {
    name: "Threads",
    icon: "🧵",
    posts: [
      { type: "テキスト", title: "渋谷のおすすめ焼肉を語る", date: "3/22", likes: 0, reach: 0, status: "draft" },
    ],
  },
  {
    name: "Google ビジネスプロフィール",
    icon: "🔍",
    posts: [
      { type: "最新情報", title: "A5黒毛和牛入荷", date: "3/18", likes: 0, reach: 3200, status: "published" },
      { type: "特典", title: "平日限定ドリンク", date: "3/22", likes: 0, reach: 0, status: "scheduled" },
    ],
  },
];

export default function OrganicPage() {
  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">オーガニック投稿</h1>
          <p className="text-sm text-slate-500 mt-1">各プラットフォームへのオーガニック投稿管理</p>
        </div>
        <div className="flex gap-2">
          <button className="px-4 py-2 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 transition">
            🤖 AI一括生成
          </button>
          <button className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition">
            + 新規投稿
          </button>
        </div>
      </div>

      {/* Approval flow */}
      <div className="bg-amber-50 rounded-xl p-4 border border-amber-100 mb-6">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm">📋</span>
          <span className="text-sm font-semibold text-amber-700">承認待ち投稿</span>
          <span className="badge badge-warning">2件</span>
        </div>
        <p className="text-xs text-amber-600">公開前レビューが必要な投稿があります。承認すると自動で予約投稿されます。</p>
      </div>

      {/* Platform posts */}
      {platforms.map((platform) => (
        <div key={platform.name} className="bg-white rounded-xl shadow-sm border border-slate-100 mb-4">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">{platform.icon}</span>
              <h3 className="text-sm font-semibold text-slate-700">{platform.name}</h3>
              <span className="text-xs text-slate-400">{platform.posts.length}件</span>
            </div>
            <button className="text-xs px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg font-medium">インサイト</button>
          </div>
          <div className="divide-y divide-slate-50">
            {platform.posts.map((post, i) => (
              <div key={i} className="p-4 flex items-center justify-between hover:bg-slate-50/50 transition">
                <div className="flex items-center gap-3">
                  <span className="badge badge-purple">{post.type}</span>
                  <div>
                    <p className="text-sm text-slate-700">{post.title}</p>
                    <p className="text-xs text-slate-400">{post.date}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {post.status === "published" && (
                    <span className="text-xs text-slate-400">
                      ♥ {post.likes} | 👁 {post.reach.toLocaleString()}
                    </span>
                  )}
                  <span className={`badge ${
                    post.status === "published" ? "badge-success" :
                    post.status === "scheduled" ? "badge-info" : "badge-warning"
                  }`}>
                    {post.status === "published" ? "公開済" :
                     post.status === "scheduled" ? "予約済" : "下書き"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* All features */}
      <h3 className="text-sm font-semibold text-slate-500 mb-3 mt-6">オーガニック投稿 機能一覧</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <FeatureCard icon="📸" title="Instagram投稿連携" description="画像・動画・リール等の投稿予約/投稿をシステム上で完結。" status="active" />
        <FeatureCard icon="📘" title="Facebook投稿連携" description="Facebookページ投稿、更新、削除、返信を一元管理。" status="active" />
        <FeatureCard icon="🎵" title="TikTok投稿連携" description="TikTokへの直接投稿または下書き送信。" status="active" />
        <FeatureCard icon="🐦" title="X投稿連携" description="Xへの投稿、スレッド投稿、メディア付き投稿。" status="active" />
        <FeatureCard icon="🧵" title="Threads投稿連携" description="Threadsへのテキスト/画像/動画/カルーセル投稿。" status="active" />
        <FeatureCard icon="🔍" title="GBP基本情報・投稿管理" description="店舗情報更新、投稿、複数拠点管理をシステム内で完結。" status="active" />
        <FeatureCard icon="📊" title="GBPパフォーマンス取得" description="検索表示、アクション、店舗パフォーマンスを自動取得。" status="active" />
        <FeatureCard icon="💬" title="GBPレビュー/通知連携" description="レビュー取得、返信、更新通知をリアルタイム受信。" status="active" />
        <FeatureCard icon="📋" title="投稿スケジューラ/承認フロー" description="予約投稿、公開前レビュー、差戻し、承認履歴を管理。" status="active" />
      </div>
    </div>
  );
}
