"use client";

import { useState, useEffect, useCallback } from "react";
import api from "@/lib/api";
import { supabase } from "@/lib/supabase";

interface UserProfile {
  id: string;
  name: string;
  username: string;
  email: string;
  role: string;
  password_display?: string;
  created_at: string;
}

interface AuditLog {
  id: string;
  user_name: string;
  action: string;
  detail: string;
  created_at: string;
}

const ROLE_OPTIONS = [
  { value: "president", label: "社長" },
  { value: "manager", label: "社員" },
  { value: "part_time", label: "バイト" },
];

export default function UserManagementPage() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newUser, setNewUser] = useState({ name: "", username: "", password: "", role: "manager" });
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState("");

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/api/report/users");
      setUsers(Array.isArray(res.data) ? res.data : []);
    } catch { setUsers([]); }
    finally { setLoading(false); }
  }, []);

  const fetchLogs = useCallback(async () => {
    const { data } = await supabase
      .from("audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    setLogs(data || []);
  }, []);

  useEffect(() => { fetchUsers(); fetchLogs(); }, [fetchUsers, fetchLogs]);

  const handleCreate = async () => {
    if (!newUser.name || !newUser.username || !newUser.password) {
      setMsg("全項目を入力してください");
      return;
    }
    if (newUser.password.length < 8) {
      setMsg("パスワードは8文字以上にしてください");
      return;
    }
    setCreating(true);
    setMsg("");
    try {
      await api.post("/api/report/users", newUser);
      setMsg(`${newUser.name}さんのアカウントを作成しました`);
      setNewUser({ name: "", username: "", password: "", role: "manager" });
      setShowCreate(false);
      await fetchUsers();
      await fetchLogs();
    } catch (e: any) {
      setMsg(`作成失敗: ${e?.response?.data?.error || e?.message}`);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (user: UserProfile) => {
    if (!confirm(`${user.name}さんのアカウントを削除しますか？`)) return;
    try {
      await api.delete("/api/report/users", { data: { userId: user.id } });
      setMsg(`${user.name}さんのアカウントを削除しました`);
      await fetchUsers();
      await fetchLogs();
    } catch (e: any) {
      setMsg(`削除失敗: ${e?.response?.data?.error || e?.message}`);
    }
  };

  return (
    <div className="animate-fade-in">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-slate-800">ユーザー・権限管理</h1>
        <p className="text-sm text-slate-500 mt-1">社員アカウントの作成・管理・操作ログ</p>
      </div>

      {msg && (
        <div className={`p-3 rounded-lg mb-4 text-sm ${msg.includes("失敗") ? "bg-red-50 text-red-700 border border-red-200" : "bg-emerald-50 text-emerald-700 border border-emerald-200"}`}>{msg}</div>
      )}

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
          <p className="text-[11px] font-medium text-slate-400 mb-1">登録ユーザー数</p>
          <p className="text-2xl font-bold text-[#003D6B]">{users.length}</p>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
          <p className="text-[11px] font-medium text-slate-400 mb-1">直近の操作ログ</p>
          <p className="text-2xl font-bold text-purple-600">{logs.length}<span className="text-xs font-normal text-slate-400 ml-1">件</span></p>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
          <p className="text-[11px] font-medium text-slate-400 mb-1">ロール別</p>
          <div className="flex flex-wrap gap-1 mt-1">
            {ROLE_OPTIONS.map((r) => {
              const count = users.filter((u) => u.role === r.value).length;
              return count > 0 ? <span key={r.value} className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-50 text-slate-600">{r.label}: {count}</span> : null;
            })}
          </div>
        </div>
      </div>

      {/* 新規ユーザー作成ボタン */}
      <div className="flex items-center justify-end mb-5">
        <button onClick={() => setShowCreate(!showCreate)}
          className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-[#003D6B] hover:bg-[#002a4a]"
          style={{ color: "#fff" }}>
          {showCreate ? "閉じる" : "+ 新規ユーザー作成"}
        </button>
      </div>

      {/* 作成フォーム */}
      {showCreate && (
        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 mb-6">
          <h3 className="text-sm font-semibold text-slate-500 mb-4">新規ユーザー作成</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 block mb-1">名前 *</label>
              <input type="text" value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                placeholder="加藤太郎" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">ユーザー名 *</label>
              <input type="text" value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                placeholder="katou" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">パスワード *（8文字以上）</label>
              <input type="text" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                placeholder="Chubby123!!" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">ロール</label>
              <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
                {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50">キャンセル</button>
            <button onClick={handleCreate} disabled={creating}
              className="px-6 py-2 rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"
              style={{ color: "#fff" }}>
              {creating ? "作成中..." : "アカウント作成"}
            </button>
          </div>
        </div>
      )}

      {/* ユーザー一覧 */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 mb-6">
        <div className="p-4 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-500">ユーザー一覧</h3>
        </div>
        {loading ? (
          <div className="p-12 text-center"><p className="text-slate-400 text-sm">読み込み中...</p></div>
        ) : users.length === 0 ? (
          <div className="p-12 text-center"><p className="text-slate-400 text-sm">ユーザーがいません。「+ 新規ユーザー作成」から追加してください。</p></div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="text-left p-3 text-slate-500 font-medium">名前</th>
                <th className="text-left p-3 text-slate-500 font-medium">ユーザー名</th>
                <th className="text-left p-3 text-slate-500 font-medium">パスワード</th>
                <th className="text-center p-3 text-slate-500 font-medium">ロール</th>
                <th className="text-right p-3 text-slate-500 font-medium">登録日</th>
                <th className="w-16"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="p-3 font-medium text-slate-800">{user.name}</td>
                  <td className="p-3 text-slate-600">{user.username}</td>
                  <td className="p-3 text-slate-500 font-mono text-[11px]">{user.password_display || "—"}</td>
                  <td className="p-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                      user.role === "president" ? "bg-amber-50 text-amber-600" :
                      user.role === "manager" ? "bg-blue-50 text-blue-600" :
                      "bg-slate-50 text-slate-600"
                    }`}>
                      {ROLE_OPTIONS.find((r) => r.value === user.role)?.label || user.role}
                    </span>
                  </td>
                  <td className="p-3 text-right text-slate-400">{new Date(user.created_at).toLocaleDateString("ja-JP")}</td>
                  <td className="p-3">
                    <button onClick={() => handleDelete(user)}
                      className="text-[10px] text-red-500 hover:text-red-700 font-semibold">削除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 操作ログ */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100">
        <div className="p-4 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-500">操作ログ（直近50件）</h3>
        </div>
        {logs.length === 0 ? (
          <div className="p-8 text-center"><p className="text-slate-400 text-sm">操作ログがありません</p></div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="text-left p-3 text-slate-500 font-medium">日時</th>
                <th className="text-left p-3 text-slate-500 font-medium">実行者</th>
                <th className="text-left p-3 text-slate-500 font-medium">操作</th>
                <th className="text-left p-3 text-slate-500 font-medium">詳細</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-b border-slate-50">
                  <td className="p-3 text-slate-400">{new Date(log.created_at).toLocaleString("ja-JP")}</td>
                  <td className="p-3 font-medium text-slate-700">{log.user_name}</td>
                  <td className="p-3">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-50 text-purple-600">{log.action}</span>
                  </td>
                  <td className="p-3 text-slate-500">{log.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
