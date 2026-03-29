"use client";

import { useState } from "react";
import FeatureCard from "@/components/feature-card";
import { type Role, ROLE_LABELS } from "@/lib/roles";

interface UserRow {
  id: string;
  name: string;
  role: Role;
  email: string;
  lastLogin: string;
  status: "active" | "inactive";
}

const initialUsers: UserRow[] = [
  { id: "U-001", name: "田中太郎", role: "president", email: "tanaka@chubby.co.jp", lastLogin: "03/26 10:00", status: "active" },
  { id: "U-002", name: "山田花子", role: "manager", email: "yamada@chubby.co.jp", lastLogin: "03/25 15:30", status: "active" },
  { id: "U-003", name: "佐藤一郎", role: "manager", email: "sato@chubby.co.jp", lastLogin: "03/24 09:00", status: "active" },
  { id: "U-004", name: "鈴木美咲", role: "part_time", email: "suzuki@chubby.co.jp", lastLogin: "03/20 14:00", status: "active" },
  { id: "U-005", name: "高橋健太", role: "part_time", email: "takahashi@chubby.co.jp", lastLogin: "03/22 09:30", status: "active" },
  { id: "U-006", name: "渡辺真央", role: "part_time", email: "watanabe@chubby.co.jp", lastLogin: "03/15 11:00", status: "inactive" },
];

const roleColors: Record<Role, string> = {
  president: "bg-red-50 text-red-600",
  manager: "bg-blue-50 text-blue-600",
  part_time: "bg-green-50 text-green-600",
};

const permissionMatrix = [
  { page: "ダッシュボード", president: true, manager: true, part_time: true },
  { page: "店舗診断", president: true, manager: true, part_time: true },
  { page: "口コミ管理", president: true, manager: true, part_time: true },
  { page: "投稿管理", president: true, manager: true, part_time: true },
  { page: "ランキング", president: true, manager: true, part_time: true },
  { page: "AIO対策", president: true, manager: true, part_time: false },
  { page: "店舗管理", president: true, manager: true, part_time: false },
  { page: "レポート", president: true, manager: true, part_time: false },
  { page: "広告管理", president: true, manager: true, part_time: false },
  { page: "多媒体連携", president: true, manager: true, part_time: false },
  { page: "リード/チャットボット", president: true, manager: true, part_time: false },
  { page: "AI社長・AI課長", president: true, manager: true, part_time: false },
  { page: "システム管理", president: true, manager: false, part_time: false },
  { page: "ユーザー管理", president: true, manager: false, part_time: false },
  { page: "顧客マスタ", president: true, manager: false, part_time: false },
];

const ROLES: Role[] = ["president", "manager", "part_time"];

export default function UserManagementPage() {
  const [users, setUsers] = useState<UserRow[]>(initialUsers);
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState<UserRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);
  const [formData, setFormData] = useState({ name: "", email: "", role: "part_time" as Role });

  const roleCounts = {
    president: users.filter((u) => u.role === "president").length,
    manager: users.filter((u) => u.role === "manager").length,
    part_time: users.filter((u) => u.role === "part_time").length,
  };

  const handleAdd = () => {
    const newUser: UserRow = {
      id: `U-${String(users.length + 1).padStart(3, "0")}`,
      name: formData.name,
      email: formData.email,
      role: formData.role,
      lastLogin: "—",
      status: "active",
    };
    setUsers([...users, newUser]);
    setShowModal(false);
    setFormData({ name: "", email: "", role: "part_time" });
  };

  const handleEdit = () => {
    if (!editUser) return;
    setUsers(users.map((u) => (u.id === editUser.id ? editUser : u)));
    setEditUser(null);
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    setUsers(users.filter((u) => u.id !== deleteTarget.id));
    setDeleteTarget(null);
  };

  const handleToggleStatus = (userId: string) => {
    setUsers(users.map((u) =>
      u.id === userId ? { ...u, status: u.status === "active" ? "inactive" : "active" } : u
    ));
  };

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">ユーザー・権限管理</h1>
          <p className="text-slate-500 text-sm mt-1">社長 / マネージャー / バイト の3階層でアクセス制御</p>
        </div>
        <button
          onClick={() => { setShowModal(true); setFormData({ name: "", email: "", role: "part_time" }); }}
          className="bg-[#003D6B] text-white text-sm px-4 py-2 rounded-lg hover:bg-[#002a4a] transition"
        >
          + ユーザー追加
        </button>
      </div>

      {/* Role Summary */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {ROLES.map((r) => (
          <div key={r} className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleColors[r]}`}>{ROLE_LABELS[r]}</span>
              <span className="text-2xl font-bold text-slate-800">{roleCounts[r]}</span>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              {r === "president" && "全機能フルアクセス"}
              {r === "manager" && "業務系全般にアクセス"}
              {r === "part_time" && "基本業務のみ"}
            </p>
          </div>
        ))}
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm mb-6">
        <h2 className="text-lg font-bold text-slate-800 mb-4">ユーザー一覧</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-slate-200">
              <th className="text-left py-2 px-3">ID</th>
              <th className="text-left py-2 px-3">名前</th>
              <th className="text-center py-2 px-3">ロール</th>
              <th className="text-left py-2 px-3">メール</th>
              <th className="text-center py-2 px-3">最終ログイン</th>
              <th className="text-center py-2 px-3">ステータス</th>
              <th className="text-center py-2 px-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-slate-100 hover:bg-slate-50 transition">
                <td className="py-3 px-3 text-slate-400 text-xs font-mono">{u.id}</td>
                <td className="py-3 px-3 font-medium text-slate-800">{u.name}</td>
                <td className="py-3 px-3 text-center">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleColors[u.role]}`}>{ROLE_LABELS[u.role]}</span>
                </td>
                <td className="py-3 px-3 text-slate-600">{u.email}</td>
                <td className="py-3 px-3 text-center text-slate-400">{u.lastLogin}</td>
                <td className="py-3 px-3 text-center">
                  <button onClick={() => handleToggleStatus(u.id)} className="text-xs">
                    {u.status === "active"
                      ? <span className="text-green-600">● 有効</span>
                      : <span className="text-slate-400">○ 無効</span>}
                  </button>
                </td>
                <td className="py-3 px-3 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <button onClick={() => setEditUser({ ...u })} className="text-[10px] px-2 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100">編集</button>
                    <button onClick={() => setDeleteTarget(u)} className="text-[10px] px-2 py-1 bg-red-50 text-red-600 rounded hover:bg-red-100">削除</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Permission Matrix */}
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm mb-6">
        <h2 className="text-lg font-bold text-slate-800 mb-4">権限マトリクス</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-slate-200">
              <th className="text-left py-2 px-3">ページ</th>
              <th className="text-center py-2 px-3">社長</th>
              <th className="text-center py-2 px-3">マネージャー</th>
              <th className="text-center py-2 px-3">バイト</th>
            </tr>
          </thead>
          <tbody>
            {permissionMatrix.map((p) => (
              <tr key={p.page} className="border-b border-slate-100">
                <td className="py-2 px-3 text-slate-700">{p.page}</td>
                <td className="py-2 px-3 text-center">{p.president ? <span className="text-green-600">●</span> : <span className="text-slate-300">○</span>}</td>
                <td className="py-2 px-3 text-center">{p.manager ? <span className="text-green-600">●</span> : <span className="text-slate-300">○</span>}</td>
                <td className="py-2 px-3 text-center">{p.part_time ? <span className="text-green-600">●</span> : <span className="text-slate-300">○</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Feature Cards */}
      <h2 className="text-lg font-bold text-slate-800 mb-4">機能一覧</h2>
      <div className="grid grid-cols-2 gap-4">
        <FeatureCard title="Admin/Agent/Owner/Shop 階層管理" description="4階層ユーザーロール管理。権限別アクセス制御。" icon="👥" />
        <FeatureCard title="パスワードリセット" description="メール送信でセキュアにリセット。" icon="🔑" />
        <FeatureCard title="Google OAuth連携・GBPアカウント紐付け" description="Google OAuthでGBPアカウントを認証。" icon="🔗" />
        <FeatureCard title="監査ログ" description="全操作ログを記録。コンプライアンス対応。" icon="📋" />
      </div>

      {/* 追加モーダル */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-xl p-6 w-[450px] shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">ユーザーを追加</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">名前</label>
                <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="例: 山田太郎" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">メールアドレス</label>
                <input type="email" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} placeholder="例: yamada@chubby.co.jp" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">ロール</label>
                <select className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={formData.role} onChange={(e) => setFormData({ ...formData, role: e.target.value as Role })}>
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button onClick={handleAdd} disabled={!formData.name || !formData.email} className="flex-1 bg-[#003D6B] text-white py-2 rounded-lg text-sm font-medium hover:bg-[#002a4a] transition disabled:opacity-50">追加</button>
              <button onClick={() => setShowModal(false)} className="px-4 py-2 border border-slate-200 rounded-lg text-sm hover:bg-slate-50">キャンセル</button>
            </div>
          </div>
        </div>
      )}

      {/* 編集モーダル */}
      {editUser && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setEditUser(null)}>
          <div className="bg-white rounded-xl p-6 w-[450px] shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">ユーザーを編集</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">名前</label>
                <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={editUser.name} onChange={(e) => setEditUser({ ...editUser, name: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">メールアドレス</label>
                <input type="email" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={editUser.email} onChange={(e) => setEditUser({ ...editUser, email: e.target.value })} />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">ロール</label>
                <select className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={editUser.role} onChange={(e) => setEditUser({ ...editUser, role: e.target.value as Role })}>
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button onClick={handleEdit} className="flex-1 bg-[#003D6B] text-white py-2 rounded-lg text-sm font-medium hover:bg-[#002a4a] transition">保存</button>
              <button onClick={() => setEditUser(null)} className="px-4 py-2 border border-slate-200 rounded-lg text-sm hover:bg-slate-50">キャンセル</button>
            </div>
          </div>
        </div>
      )}

      {/* 削除確認モーダル */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setDeleteTarget(null)}>
          <div className="bg-white rounded-xl p-6 w-[400px] shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-red-600 mb-2">ユーザーを削除</h3>
            <p className="text-sm text-slate-600 mb-1">以下のユーザーを削除しますか？</p>
            <p className="text-sm font-bold text-slate-800">{deleteTarget.name}（{ROLE_LABELS[deleteTarget.role]}）</p>
            <p className="text-xs text-red-500 mt-2 mb-6">この操作は取り消せません。</p>
            <div className="flex gap-2">
              <button onClick={handleDelete} className="flex-1 bg-red-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-red-700 transition">削除する</button>
              <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 border border-slate-200 rounded-lg text-sm hover:bg-slate-50">キャンセル</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
