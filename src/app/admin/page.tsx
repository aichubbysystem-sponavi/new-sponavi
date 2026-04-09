"use client";

import { useState, useEffect, useCallback } from "react";
import { useShop } from "@/components/shop-provider";
import api from "@/lib/api";

interface Setting {
  id: string;
  key?: string;
  value?: string;
  created_at: string;
}

interface Group {
  id: string;
  name: string;
  created_at: string;
}

export default function AdminPage() {
  const { apiConnected } = useShop();
  const [settings, setSettings] = useState<Setting[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [settingRes, groupRes] = await Promise.all([
        api.get("/api/setting").catch(() => ({ data: [] })),
        api.get("/api/group").catch(() => ({ data: [] })),
      ]);
      setSettings(Array.isArray(settingRes.data) ? settingRes.data : []);
      setGroups(Array.isArray(groupRes.data) ? groupRes.data : []);
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className="animate-fade-in">
      <h1 className="text-2xl font-bold text-slate-800 mb-2">システム管理</h1>
      <p className="text-sm text-slate-500 mb-6">設定・グループ管理</p>

      {!apiConnected ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">Go APIに接続するとシステム管理が利用できます</p>
        </div>
      ) : loading ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">読み込み中...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* グループ管理 */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
            <h3 className="text-sm font-semibold text-slate-500 mb-4">店舗グループ（{groups.length}件）</h3>
            {groups.length === 0 ? (
              <p className="text-slate-400 text-sm text-center py-6">グループがありません</p>
            ) : (
              <div className="space-y-2">
                {groups.map((g) => (
                  <div key={g.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                    <span className="text-sm font-medium text-slate-700">{g.name}</span>
                    <span className="text-xs text-slate-400">{new Date(g.created_at).toLocaleDateString("ja-JP")}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 設定 */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
            <h3 className="text-sm font-semibold text-slate-500 mb-4">システム設定（{settings.length}件）</h3>
            {settings.length === 0 ? (
              <p className="text-slate-400 text-sm text-center py-6">設定がありません</p>
            ) : (
              <div className="space-y-2">
                {settings.map((s) => (
                  <div key={s.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                    <span className="text-sm text-slate-700">{s.key || s.id}</span>
                    <span className="text-xs text-slate-500">{s.value || "—"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
