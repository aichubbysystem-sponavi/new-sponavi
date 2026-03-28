"use client";

import FeatureCard from "@/components/feature-card";

const knowledgeStats = [
  { source: "社内マニュアル", docs: 12, size: "3.2MB", lastSync: "03/23" },
  { source: "スプレッドシート(48タブ)", docs: 48, size: "2.2MB", lastSync: "03/14" },
  { source: "tldv会議録", docs: 223, size: "45MB", lastSync: "毎日06:00" },
  { source: "Slack #chubby-core", docs: 340, size: "1.8MB", lastSync: "リアルタイム" },
  { source: "LINE全グループ", docs: 0, size: "-", lastSync: "未接続" },
  { source: "SPOTLIGHT DATA", docs: 0, size: "-", lastSync: "未接続" },
];

const slackActivity = [
  { time: "10:12", user: "中嶋", channel: "#div_meo初期整備", message: "@AI社長 サンプル食堂の対策KWは？", response: "渋谷 居酒屋、渋谷 飲み放題、..." },
  { time: "09:45", user: "山田", channel: "#投稿管理", message: "@AI社長 今月の投稿テンプレ教えて", response: "今月のテンプレートは春の限定メニュー系で..." },
  { time: "09:30", user: "社長", channel: "#chubby-core", message: "来月からレポート形式変更する", response: "📝 学習しました（自動学習）" },
  { time: "09:00", user: "飯島", channel: "#広告運用", message: "@AI社長 P-MAX のCPA目標は？", response: "業種別の目安は飲食:¥800、美容:¥1,200..." },
];

const lineGroups = [
  { name: "サンプル食堂 渋谷店", shopId: "SH-00001", members: 5, lastMessage: "03/26 09:00", unread: 3, alert: false },
  { name: "Beauty Lab EBISU", shopId: "SH-00003", members: 3, lastMessage: "03/25 15:30", unread: 0, alert: false },
  { name: "旅館 松風", shopId: "SH-00005", members: 4, lastMessage: "03/26 10:30", unread: 1, alert: true },
  { name: "鈴木クリニック", shopId: "SH-00004", members: 2, lastMessage: "03/20 14:00", unread: 0, alert: false },
  { name: "カフェ モーニング", shopId: "SH-00006", members: 2, lastMessage: "03/10 11:00", unread: 0, alert: true },
];

const autoTasks = [
  { id: "T-001", source: "LINE", shop: "旅館 松風", trigger: "「来週水曜から金曜まで臨時休業」", tasks: ["GBP特別営業時間更新", "OTA在庫ブロック"], status: "pending", assignee: "中嶋" },
  { id: "T-002", source: "LINE", shop: "サンプル食堂 渋谷店", trigger: "「新メニューの写真送ります」", tasks: ["写真受領確認", "GBPメニュー更新", "投稿作成"], status: "in_progress", assignee: "山田" },
  { id: "T-003", source: "LINE", shop: "Beauty Lab EBISU", trigger: "「店名をBeauty Lab EBISUに変更」", tasks: ["マスタ更新", "全シート一括反映", "NAP更新"], status: "completed", assignee: "中嶋" },
];

export default function AIIntegrationPage() {
  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">AI社長・AI課長連携</h1>
        <p className="text-slate-400 text-sm mt-1">Dify RAGベースのAI社長（Slack）+ AI課長（LINE ROM監視）</p>
      </div>

      {/* AI Overview */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-gradient-to-br from-blue-600/20 to-purple-600/20 rounded-xl p-5 border border-blue-500/20">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-3xl">🤖</span>
            <div>
              <h3 className="text-lg font-bold text-white">AI社長</h3>
              <p className="text-xs text-slate-400">Slack Bot — 社内向け</p>
            </div>
            <span className="ml-auto text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">● 稼働中</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-white/5 rounded-lg p-2">
              <p className="text-lg font-bold text-white">1,247</p>
              <p className="text-[10px] text-slate-400">累計回答数</p>
            </div>
            <div className="bg-white/5 rounded-lg p-2">
              <p className="text-lg font-bold text-white">623</p>
              <p className="text-[10px] text-slate-400">ナレッジ件数</p>
            </div>
            <div className="bg-white/5 rounded-lg p-2">
              <p className="text-lg font-bold text-white">42</p>
              <p className="text-[10px] text-slate-400">社長訂正学習</p>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-green-600/20 to-emerald-600/20 rounded-xl p-5 border border-green-500/20">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-3xl">👁️</span>
            <div>
              <h3 className="text-lg font-bold text-white">AI課長</h3>
              <p className="text-xs text-slate-400">LINE Bot — クライアント向けROM監視</p>
            </div>
            <span className="ml-auto text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full">◐ 構築中</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-white/5 rounded-lg p-2">
              <p className="text-lg font-bold text-white">100+</p>
              <p className="text-[10px] text-slate-400">監視グループ</p>
            </div>
            <div className="bg-white/5 rounded-lg p-2">
              <p className="text-lg font-bold text-white">0</p>
              <p className="text-[10px] text-slate-400">グループ内発言</p>
            </div>
            <div className="bg-white/5 rounded-lg p-2">
              <p className="text-lg font-bold text-white">24/7</p>
              <p className="text-[10px] text-slate-400">常時監視</p>
            </div>
          </div>
        </div>
      </div>

      {/* Knowledge Base */}
      <div className="bg-[#1e293b] rounded-xl p-5 border border-white/5 mb-6">
        <h2 className="text-lg font-bold text-white mb-4">ナレッジベース（Dify）</h2>
        <div className="grid grid-cols-3 gap-3">
          {knowledgeStats.map((k) => (
            <div key={k.source} className={`rounded-lg p-3 ${k.docs > 0 ? "bg-green-500/5 border border-green-500/10" : "bg-white/5 border border-white/10"}`}>
              <p className="text-xs text-white font-medium">{k.source}</p>
              <div className="flex items-center justify-between mt-2">
                <span className="text-sm font-bold text-white">{k.docs}件</span>
                <span className="text-xs text-slate-400">{k.size}</span>
              </div>
              <p className="text-[10px] text-slate-500 mt-1">同期: {k.lastSync}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Slack Activity */}
      <div className="bg-[#1e293b] rounded-xl p-5 border border-white/5 mb-6">
        <h2 className="text-lg font-bold text-white mb-4">AI社長 — 直近の回答</h2>
        <div className="space-y-3">
          {slackActivity.map((a, i) => (
            <div key={i} className="bg-white/5 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs text-slate-500">{a.time}</span>
                <span className="text-xs text-blue-400">{a.user}</span>
                <span className="text-xs text-slate-600">in {a.channel}</span>
              </div>
              <p className="text-sm text-white">{a.message}</p>
              <p className="text-xs text-slate-400 mt-1 pl-3 border-l-2 border-blue-500/30">{a.response}</p>
            </div>
          ))}
        </div>
      </div>

      {/* LINE Groups */}
      <div className="bg-[#1e293b] rounded-xl p-5 border border-white/5 mb-6">
        <h2 className="text-lg font-bold text-white mb-4">AI課長 — LINEグループ監視</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-slate-400 border-b border-white/10">
              <th className="text-left py-2 px-3">グループ名</th>
              <th className="text-center py-2 px-3">shop_id</th>
              <th className="text-center py-2 px-3">メンバー</th>
              <th className="text-center py-2 px-3">最終メッセージ</th>
              <th className="text-center py-2 px-3">アラート</th>
            </tr>
          </thead>
          <tbody>
            {lineGroups.map((g) => (
              <tr key={g.shopId} className="border-b border-white/5">
                <td className="py-3 px-3 text-white">{g.name}</td>
                <td className="py-3 px-3 text-center text-blue-400 font-mono text-xs">{g.shopId}</td>
                <td className="py-3 px-3 text-center text-slate-300">{g.members}人</td>
                <td className="py-3 px-3 text-center text-slate-400">{g.lastMessage}</td>
                <td className="py-3 px-3 text-center">
                  {g.alert ? <span className="text-red-400 text-xs">⚠️ 要注意</span> : <span className="text-green-400 text-xs">✅ 正常</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Auto Tasks */}
      <div className="bg-[#1e293b] rounded-xl p-5 border border-white/5 mb-6">
        <h2 className="text-lg font-bold text-white mb-4">自動生成タスク</h2>
        {autoTasks.map((t) => (
          <div key={t.id} className="bg-white/5 rounded-lg p-4 mb-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded">{t.source}</span>
                <span className="text-sm text-white font-medium">{t.shop}</span>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                t.status === "completed" ? "bg-green-500/20 text-green-400" :
                t.status === "in_progress" ? "bg-blue-500/20 text-blue-400" :
                "bg-yellow-500/20 text-yellow-400"
              }`}>
                {t.status === "completed" ? "完了" : t.status === "in_progress" ? "進行中" : "未着手"}
              </span>
            </div>
            <p className="text-xs text-slate-400 mb-2">トリガー: {t.trigger}</p>
            <div className="flex items-center gap-2 flex-wrap">
              {t.tasks.map((task) => (
                <span key={task} className="text-[10px] bg-white/10 text-slate-300 px-2 py-0.5 rounded">{t.status === "completed" ? "✅" : "□"} {task}</span>
              ))}
              <span className="text-[10px] text-slate-500 ml-auto">担当: {t.assignee}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Feature Cards */}
      <h2 className="text-lg font-bold text-white mb-4">機能一覧</h2>
      <div className="grid grid-cols-2 gap-4">
        <FeatureCard title="AI社長（Slack Bot）" description="Dify RAGベース。社内の全データを学習し即座に回答。" icon="🤖" />
        <FeatureCard title="AI課長（LINE Bot ROM監視）" description="100+のLINEグループを常時ROM監視。発言せずに把握。" icon="👁️" />
        <FeatureCard title="LINE発言→自動タスク生成・追跡" description="休業・メニュー変更・店名変更等を検知→タスク化。" icon="📋" />
        <FeatureCard title="重要キーワード検知・緊急アラート" description="クレーム・解約等を検知しSlackに緊急アラート。" icon="🚨" />
      </div>
    </div>
  );
}
