"use client";

import { useState, useEffect, useCallback } from "react";
import { useShop } from "@/components/shop-provider";
import api from "@/lib/api";

interface Group {
  id: string;
  name: string;
  description?: string;
  owner_id?: string;
  shops?: { id: string; name: string }[];
}

export default function GroupManagementPage() {
  const { apiConnected, shops } = useShop();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", description: "" });
  const [saving, setSaving] = useState(false);

  const fetchGroups = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/api/group");
      setGroups(res.data?.groups || res.data || []);
    } catch { setGroups([]); }
    setLoading(false);
  }, []);

  useEffect(() => { if (apiConnected) fetchGroups(); }, [apiConnected, fetchGroups]);

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await api.post("/api/group", { name: form.name.trim(), description: form.description.trim() });
      setMsg("グループを作成しました");
      setForm({ name: "", description: "" });
      setShowCreate(false);
      await fetchGroups();
    } catch (e: any) {
      setMsg(`作成失敗: ${e?.response?.data?.message || e?.message || "エラー"}`);
    }
    setSaving(false);
  };

  const handleUpdate = async (id: string) => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await api.put(`/api/group/${id}`, { name: form.name.trim(), description: form.description.trim() });
      setMsg("グループを更新しました");
      setEditingId(null);
      setForm({ name: "", description: "" });
      await fetchGroups();
    } catch (e: any) {
      setMsg(`更新失敗: ${e?.response?.data?.message || e?.message || "エラー"}`);
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("このグループを削除しますか？")) return;
    try {
      await api.delete(`/api/group/${id}`);
      setMsg("グループを削除しました");
      await fetchGroups();
    } catch (e: any) {
      setMsg(`削除失敗: ${e?.response?.data?.message || e?.message || "エラー"}`);
    }
  };

  const startEdit = (g: Group) => {
    setEditingId(g.id);
    setForm({ name: g.name, description: g.description || "" });
    setShowCreate(false);
  };

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">グループ管理</h1>
          <p className="text-sm text-slate-500 mt-1">系列店・エリア別の店舗グループ管理</p>
        </div>
        <button onClick={() => { setShowCreate(!showCreate); setEditingId(null); setForm({ name: "", description: "" }); }}
          className="px-4 py-2 rounded-lg text-xs font-semibold bg-[#003D6B] text-white hover:bg-[#002a4a]">
          {showCreate ? "閉じる" : "+ グループ作成"}
        </button>
      </div>

      {msg && (
        <div className={`p-3 rounded-lg mb-4 text-sm ${msg.includes("失敗") ? "bg-red-50 text-red-600 border border-red-200" : "bg-emerald-50 text-emerald-600 border border-emerald-200"}`}>
          {msg}
        </div>
      )}

      {/* 作成フォーム */}
      {showCreate && (
        <div className="bg-white rounded-xl p-5 shadow-sm border border-blue-200 mb-5">
          <h3 className="text-sm font-semibold text-[#003D6B] mb-3">新規グループ</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-[10px] text-slate-500 block mb-1">グループ名</label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="例: 大阪エリア" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 block mb-1">説明</label>
              <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="例: 大阪府内の店舗" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
            </div>
          </div>
          <button onClick={handleCreate} disabled={saving || !form.name.trim()}
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-[#003D6B] text-white hover:bg-[#002a4a] disabled:opacity-50">
            {saving ? "作成中..." : "作成"}
          </button>
        </div>
      )}

      {!apiConnected ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">Go APIに接続してください</p>
        </div>
      ) : loading ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">読み込み中...</p>
        </div>
      ) : groups.length === 0 ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">グループがありません</p>
          <p className="text-slate-300 text-xs mt-1">「グループ作成」ボタンで系列店やエリア別のグループを作成してください</p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <div key={g.id} className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
              {editingId === g.id ? (
                <div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                    <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                    <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                      className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => handleUpdate(g.id)} disabled={saving}
                      className="px-3 py-1 rounded text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
                      {saving ? "保存中..." : "保存"}
                    </button>
                    <button onClick={() => { setEditingId(null); setForm({ name: "", description: "" }); }}
                      className="px-3 py-1 rounded text-xs font-semibold bg-slate-100 text-slate-600">キャンセル</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-slate-800">{g.name}</h4>
                    {g.description && <p className="text-xs text-slate-500 mt-0.5">{g.description}</p>}
                    {g.shops && g.shops.length > 0 && (
                      <p className="text-xs text-slate-400 mt-1">{g.shops.length}店舗: {g.shops.map(s => s.name).join(", ")}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => startEdit(g)}
                      className="px-3 py-1 rounded text-xs font-semibold bg-blue-50 text-blue-600 hover:bg-blue-100">編集</button>
                    <button onClick={() => handleDelete(g.id)}
                      className="px-3 py-1 rounded text-xs font-semibold bg-red-50 text-red-500 hover:bg-red-100">削除</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
