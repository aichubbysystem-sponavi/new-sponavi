"use client";

import FeatureCard from "@/components/feature-card";

const users = [
  { id: "U-001", name: "田中太郎", role: "Admin", email: "tanaka@chubby.co.jp", lastLogin: "03/26 10:00", status: "active" },
  { id: "U-002", name: "株式会社〇〇マーケティング", role: "Agent", email: "info@marketing.co.jp", lastLogin: "03/25 15:30", status: "active" },
  { id: "U-003", name: "佐藤花子", role: "Owner", email: "sato@sample.co.jp", lastLogin: "03/24 09:00", status: "active" },
  { id: "U-004", name: "鈴木一郎", role: "Shop", email: "suzuki@sample.co.jp", lastLogin: "03/20 14:00", status: "active" },
  { id: "U-005", name: "高橋美咲", role: "Admin", email: "takahashi@chubby.co.jp", lastLogin: "03/26 09:30", status: "active" },
  { id: "U-006", name: "有限会社テスト", role: "Agent", email: "test@agent.co.jp", lastLogin: "03/15 11:00", status: "inactive" },
];

const roleColors: Record<string, string> = {
  Admin: "bg-red-500/20 text-red-400",
  Agent: "bg-purple-500/20 text-purple-400",
  Owner: "bg-blue-500/20 text-blue-400",
  Shop: "bg-green-500/20 text-green-400",
};

const permissions = [
  { page: "ダッシュボード", admin: true, agent: true, owner: true, shop: true },
  { page: "店舗管理", admin: true, agent: true, owner: true, shop: false },
  { page: "口コミ管理", admin: true, agent: true, owner: true, shop: true },
  { page: "投稿管理", admin: true, agent: true, owner: true, shop: true },
  { page: "レポート", admin: true, agent: true, owner: true, shop: true },
  { page: "ランキング", admin: true, agent: true, owner: true, shop: true },
  { page: "広告管理", admin: true, agent: true, owner: false, shop: false },
  { page: "ユーザー管理", admin: true, agent: false, owner: false, shop: false },
  { page: "システム管理", admin: true, agent: false, owner: false, shop: false },
  { page: "顧客マスタ", admin: true, agent: true, owner: false, shop: false },
];

export default function UserManagementPage() {
  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">ユーザー・権限管理</h1>
        <p className="text-slate-400 text-sm mt-1">Admin / Agent / Owner / Shop の4階層でアクセス制御</p>
      </div>

      {/* Role Summary */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { role: "Admin", count: 2, desc: "全機能フルアクセス", color: "red" },
          { role: "Agent", count: 3, desc: "配下のOwner/Shopを管理", color: "purple" },
          { role: "Owner", count: 8, desc: "自社の店舗を管理", color: "blue" },
          { role: "Shop", count: 15, desc: "自店舗のデータのみ", color: "green" },
        ].map((r) => (
          <div key={r.role} className="bg-[#1e293b] rounded-xl p-4 border border-white/5">
            <div className="flex items-center justify-between">
              <span className={`text-xs px-2 py-0.5 rounded-full bg-${r.color}-500/20 text-${r.color}-400`}>{r.role}</span>
              <span className="text-2xl font-bold text-white">{r.count}</span>
            </div>
            <p className="text-xs text-slate-400 mt-2">{r.desc}</p>
          </div>
        ))}
      </div>

      {/* Users Table */}
      <div className="bg-[#1e293b] rounded-xl p-5 border border-white/5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white">ユーザー一覧</h2>
          <button className="bg-blue-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-blue-700">+ 新規追加</button>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-slate-400 border-b border-white/10">
              <th className="text-left py-2 px-3">ID</th>
              <th className="text-left py-2 px-3">名前</th>
              <th className="text-center py-2 px-3">ロール</th>
              <th className="text-left py-2 px-3">メール</th>
              <th className="text-center py-2 px-3">最終ログイン</th>
              <th className="text-center py-2 px-3">ステータス</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-white/5 hover:bg-white/5 cursor-pointer">
                <td className="py-3 px-3 text-slate-400 text-xs">{u.id}</td>
                <td className="py-3 px-3 text-white font-medium">{u.name}</td>
                <td className="py-3 px-3 text-center"><span className={`text-xs px-2 py-0.5 rounded-full ${roleColors[u.role]}`}>{u.role}</span></td>
                <td className="py-3 px-3 text-slate-300">{u.email}</td>
                <td className="py-3 px-3 text-center text-slate-400">{u.lastLogin}</td>
                <td className="py-3 px-3 text-center">
                  <span className={`text-xs ${u.status === "active" ? "text-green-400" : "text-slate-500"}`}>
                    {u.status === "active" ? "● 有効" : "○ 無効"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Permission Matrix */}
      <div className="bg-[#1e293b] rounded-xl p-5 border border-white/5 mb-6">
        <h2 className="text-lg font-bold text-white mb-4">権限マトリクス</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-slate-400 border-b border-white/10">
              <th className="text-left py-2 px-3">ページ</th>
              <th className="text-center py-2 px-3">Admin</th>
              <th className="text-center py-2 px-3">Agent</th>
              <th className="text-center py-2 px-3">Owner</th>
              <th className="text-center py-2 px-3">Shop</th>
            </tr>
          </thead>
          <tbody>
            {permissions.map((p) => (
              <tr key={p.page} className="border-b border-white/5">
                <td className="py-2 px-3 text-white">{p.page}</td>
                <td className="py-2 px-3 text-center">{p.admin ? "✅" : "❌"}</td>
                <td className="py-2 px-3 text-center">{p.agent ? "✅" : "❌"}</td>
                <td className="py-2 px-3 text-center">{p.owner ? "✅" : "❌"}</td>
                <td className="py-2 px-3 text-center">{p.shop ? "✅" : "❌"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Feature Cards */}
      <h2 className="text-lg font-bold text-white mb-4">機能一覧</h2>
      <div className="grid grid-cols-2 gap-4">
        <FeatureCard title="Admin/Agent/Owner/Shop 階層管理" description="4階層ユーザーロール管理。権限別アクセス制御。" icon="👥" />
        <FeatureCard title="管理者(Admin)管理" description="システム管理者の作成・編集・削除。" icon="🔐" />
        <FeatureCard title="代理店(Agent)管理" description="代理店アカウントの作成・編集。" icon="🏢" />
        <FeatureCard title="オーナー(Owner)管理" description="オーナーアカウントの作成・編集。" icon="👤" />
        <FeatureCard title="店舗スタッフ(Shop)管理" description="店舗単位のスタッフアカウント管理。" icon="🏪" />
        <FeatureCard title="Google OAuth連携・GBPアカウント紐付け" description="Google OAuthでGBPアカウントを認証。" icon="🔗" />
        <FeatureCard title="パスワードリセット" description="メール送信でセキュアにリセット。" icon="🔑" />
        <FeatureCard title="監査ログ" description="全操作ログを記録。コンプライアンス対応。" icon="📋" />
      </div>
    </div>
  );
}
