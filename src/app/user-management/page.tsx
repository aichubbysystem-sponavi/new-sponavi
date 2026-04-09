"use client";

import { useState, useEffect, useCallback } from "react";
import { useShop } from "@/components/shop-provider";
import api from "@/lib/api";

interface User {
  id: string;
  email: string;
  role: string;
  last_name: string;
  first_name: string;
  email_confirmed_at: string | null;
  invited_at: string | null;
  created_at: string;
}

export default function UserManagementPage() {
  const { apiConnected } = useShop();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/api/user");
      setUsers(Array.isArray(res.data) ? res.data : []);
    } catch { setUsers([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">ユーザー・権限管理</h1>
          <p className="text-slate-500 text-sm mt-1">社長 / マネージャー / バイト の3階層でアクセス制御</p>
        </div>
      </div>

      {!apiConnected ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">Go APIに接続するとユーザー管理が利用できます</p>
        </div>
      ) : loading ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">読み込み中...</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100">
          {users.length === 0 ? (
            <div className="p-12 text-center"><p className="text-slate-400 text-sm">ユーザーが登録されていません</p></div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-3 px-4 text-slate-500 font-medium">名前</th>
                  <th className="text-left py-3 px-4 text-slate-500 font-medium">メール</th>
                  <th className="text-center py-3 px-4 text-slate-500 font-medium">ロール</th>
                  <th className="text-center py-3 px-4 text-slate-500 font-medium">ステータス</th>
                  <th className="text-center py-3 px-4 text-slate-500 font-medium">登録日</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="py-3 px-4 font-medium text-slate-800">{u.last_name} {u.first_name}</td>
                    <td className="py-3 px-4 text-slate-600 text-xs">{u.email}</td>
                    <td className="py-3 px-4 text-center">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 font-medium">{u.role || "未設定"}</span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${u.email_confirmed_at ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"}`}>
                        {u.email_confirmed_at ? "確認済み" : "招待中"}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center text-xs text-slate-400">{new Date(u.created_at).toLocaleDateString("ja-JP")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
