"use client";

import FeatureCard from "@/components/feature-card";

const tokenStatus = [
  { platform: "Google Business Profile", status: "active", expiry: "2026-06-15", scope: "business.manage, spreadsheets" },
  { platform: "Meta (Instagram/Facebook)", status: "active", expiry: "2026-04-20", scope: "pages_manage_posts, instagram_basic" },
  { platform: "TikTok", status: "active", expiry: "2026-05-10", scope: "video.upload, user.info" },
  { platform: "X (Twitter)", status: "expired", expiry: "2026-03-01", scope: "tweet.read, tweet.write" },
  { platform: "Booking.com", status: "active", expiry: "2026-07-01", scope: "property.manage" },
  { platform: "TripAdvisor", status: "pending", expiry: "-", scope: "content.read" },
];

const jobQueue = [
  { id: "JOB-001", type: "口コミ同期", target: "全店舗", status: "running", started: "03/18 09:00", retries: 0 },
  { id: "JOB-002", type: "投稿予約実行", target: "炎 渋谷店", status: "completed", started: "03/18 08:30", retries: 0 },
  { id: "JOB-003", type: "NAP一括同期", target: "全媒体", status: "failed", started: "03/18 07:00", retries: 3 },
  { id: "JOB-004", type: "レポート生成", target: "週次レポート", status: "queued", started: "-", retries: 0 },
  { id: "JOB-005", type: "AI記事生成", target: "全店舗（月初一括）", status: "completed", started: "03/18 06:00", retries: 0 },
];

const auditLog = [
  { time: "03/18 10:12", user: "田中 (管理者)", action: "口コミ返信を送信", target: "炎 渋谷店 - レビューID:4521" },
  { time: "03/18 09:45", user: "佐藤 (店舗)", action: "投稿を編集", target: "春の限定メニュー投稿" },
  { time: "03/18 09:30", user: "システム", action: "トークン自動更新", target: "Google Business Profile" },
  { time: "03/18 09:00", user: "鈴木 (代理店)", action: "レポートをダウンロード", target: "2026年2月レポート" },
  { time: "03/17 18:00", user: "田中 (管理者)", action: "キーワード設定を変更", target: "渋谷 焼肉 デート を追加" },
];

const roles = [
  { role: "本部管理者", users: 2, permissions: "全機能アクセス", color: "red" },
  { role: "代理店", users: 3, permissions: "レポート閲覧・投稿管理・口コミ返信", color: "purple" },
  { role: "店舗オーナー", users: 8, permissions: "自店舗の閲覧・投稿承認・口コミ確認", color: "blue" },
  { role: "閲覧者", users: 5, permissions: "ダッシュボード・レポートの閲覧のみ", color: "slate" },
];

const dwhSources = [
  { source: "Google Business Profile", records: "125,400", lastSync: "03/18 09:00", status: "synced" },
  { source: "Google Ads", records: "45,200", lastSync: "03/18 08:00", status: "synced" },
  { source: "Meta Ads", records: "23,100", lastSync: "03/18 07:30", status: "synced" },
  { source: "Instagram Insights", records: "18,900", lastSync: "03/17 23:00", status: "synced" },
  { source: "TikTok Analytics", records: "8,400", lastSync: "03/17 22:00", status: "synced" },
  { source: "口コミデータ", records: "34,600", lastSync: "03/18 09:30", status: "syncing" },
  { source: "POSレジ連携", records: "56,800", lastSync: "03/18 06:00", status: "synced" },
  { source: "天気/イベントデータ", records: "2,100", lastSync: "03/18 00:00", status: "synced" },
];

export default function AdminPage() {
  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">システム管理</h1>
          <p className="text-sm text-slate-500 mt-1">認証・ジョブ管理・監査ログ・データ基盤</p>
        </div>
      </div>

      {/* 認証・トークン管理 */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 mb-6">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-500">認証・トークン管理</h3>
          <button className="text-xs px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg font-medium">全トークン更新</button>
        </div>
        <div className="divide-y divide-slate-50">
          {tokenStatus.map((t) => (
            <div key={t.platform} className="p-4 flex items-center justify-between hover:bg-slate-50/50 transition">
              <div>
                <p className="text-sm font-medium text-slate-700">{t.platform}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">スコープ: {t.scope}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-400">有効期限: {t.expiry}</span>
                <span className={`badge ${
                  t.status === "active" ? "badge-success" :
                  t.status === "expired" ? "badge-danger" : "badge-warning"
                }`}>
                  {t.status === "active" ? "有効" : t.status === "expired" ? "期限切れ" : "認証待ち"}
                </span>
                <button className={`text-xs px-2 py-1 rounded ${
                  t.status === "expired" ? "bg-red-50 text-red-600" : "bg-slate-50 text-slate-600"
                }`}>
                  {t.status === "expired" ? "再認証" : t.status === "pending" ? "認証する" : "更新"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ジョブ管理・レート制限制御 */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 mb-6">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-500">ジョブ管理・レート制限制御</h3>
          <div className="flex gap-2">
            <span className="text-xs text-slate-400">API残量: GBP 892/1000 | Meta 450/500</span>
          </div>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-xs text-slate-400 text-left py-2 px-5 font-medium">ジョブID</th>
              <th className="text-xs text-slate-400 text-left py-2 font-medium">種類</th>
              <th className="text-xs text-slate-400 text-left py-2 font-medium">対象</th>
              <th className="text-xs text-slate-400 text-center py-2 font-medium">ステータス</th>
              <th className="text-xs text-slate-400 text-center py-2 font-medium">リトライ</th>
              <th className="text-xs text-slate-400 text-center py-2 px-5 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {jobQueue.map((job) => (
              <tr key={job.id} className="border-b border-slate-50">
                <td className="py-3 px-5 text-xs text-slate-500 font-mono">{job.id}</td>
                <td className="py-3 text-sm text-slate-700">{job.type}</td>
                <td className="py-3 text-xs text-slate-500">{job.target}</td>
                <td className="py-3 text-center">
                  <span className={`badge ${
                    job.status === "running" ? "badge-info" :
                    job.status === "completed" ? "badge-success" :
                    job.status === "failed" ? "badge-danger" : "badge-warning"
                  }`}>
                    {job.status === "running" ? "実行中" :
                     job.status === "completed" ? "完了" :
                     job.status === "failed" ? "失敗" : "待機中"}
                  </span>
                </td>
                <td className="py-3 text-center text-xs text-slate-500">{job.retries}</td>
                <td className="py-3 px-5 text-center">
                  {job.status === "failed" && (
                    <button className="text-xs px-2 py-1 bg-red-50 text-red-600 rounded">再実行</button>
                  )}
                  {job.status === "running" && (
                    <button className="text-xs px-2 py-1 bg-slate-50 text-slate-600 rounded">停止</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* レポートDWH/BI基盤 */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 mb-6">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-500">レポートDWH/BI基盤</h3>
          <span className="text-xs text-slate-400">各媒体の指標を統合した横断レポート基盤</span>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {dwhSources.map((s) => (
              <div key={s.source} className="p-3 bg-slate-50 rounded-lg">
                <p className="text-xs font-medium text-slate-700">{s.source}</p>
                <p className="text-lg font-bold text-slate-800">{s.records}</p>
                <div className="flex items-center gap-1 mt-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${s.status === "synced" ? "bg-emerald-500" : "bg-blue-500 animate-pulse"}`} />
                  <span className="text-[10px] text-slate-400">{s.lastSync}</span>
                </div>
              </div>
            ))}
          </div>
          <button className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition">
            横断レポートを生成
          </button>
        </div>
      </div>

      {/* 監査ログ/権限/マルチテナント */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
        {/* 権限管理 */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100">
          <div className="p-5 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-500">権限・マルチテナント管理</h3>
          </div>
          <div className="p-5 space-y-3">
            {roles.map((r) => (
              <div key={r.role} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`badge badge-${r.color === "red" ? "danger" : r.color === "purple" ? "purple" : r.color === "blue" ? "info" : "info"}`}>
                      {r.role}
                    </span>
                    <span className="text-xs text-slate-400">{r.users}人</span>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1">{r.permissions}</p>
                </div>
                <button className="text-xs px-2 py-1 bg-white text-slate-600 rounded border border-slate-200">編集</button>
              </div>
            ))}
            <button className="w-full px-4 py-2 border border-dashed border-slate-300 text-sm text-slate-500 rounded-lg hover:bg-slate-50 transition">
              + ロールを追加
            </button>
          </div>
        </div>

        {/* 監査ログ */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-500">監査ログ（操作証跡）</h3>
            <button className="text-xs px-3 py-1.5 bg-slate-50 text-slate-600 rounded-lg">全ログ表示</button>
          </div>
          <div className="divide-y divide-slate-50">
            {auditLog.map((log, i) => (
              <div key={i} className="p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">{log.time}</span>
                  <span className="text-xs font-medium text-blue-600">{log.user}</span>
                </div>
                <p className="text-sm text-slate-700 mt-1">{log.action}</p>
                <p className="text-[10px] text-slate-400">{log.target}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 売上分析AI + ベクトルDB */}
      <h3 className="text-sm font-semibold text-slate-500 mb-3">AI・データ基盤</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <FeatureCard icon="📊" title="売上分析AI" description="POSレジ・天気データ・地域イベントデータを組み合わせた売上分析AI。曜日・時間帯・商品別の時系列データ分析。" status="active" />
        <FeatureCard icon="🧠" title="データで賢くなる仕組み" description="Pinecone/pgvector等のベクトルDBを活用。データが増えるほど引き出せる事例が増え、AIの提案精度が向上。" status="active" />
        <FeatureCard icon="📧" title="メール送信（Resend / SendGrid）" description="口コミ通知・週次レポート送信・アラートメール・ユーザー招待" status="active" />
      </div>
    </div>
  );
}
