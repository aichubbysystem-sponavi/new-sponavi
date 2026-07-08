"use client";

import { useState, useEffect, useCallback } from "react";
import api from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { ROLE_LABELS } from "@/lib/roles";

interface AuditLogRow {
  id: string;
  user_name: string;
  role: string | null;
  action: string;
  action_type: string | null;
  detail: string | null;
  target_shop: string | null;
  method: string | null;
  path: string | null;
  ip: string | null;
  status: number | null;
  source: string | null;
  created_at: string;
}

const ACTION_TYPE_OPTIONS = [
  { value: "", label: "すべての種別" },
  { value: "PAID_OP", label: "課金操作" },
  { value: "EXTERNAL_OP", label: "GBP外部反映" },
  { value: "DATA_OP", label: "データ変更" },
  { value: "MEMO", label: "メモ" },
  { value: "ADMIN", label: "ユーザー管理" },
];

const TYPE_BADGE: Record<string, string> = {
  PAID_OP: "bg-red-50 text-red-600",
  EXTERNAL_OP: "bg-orange-50 text-orange-600",
  DATA_OP: "bg-blue-50 text-blue-600",
  MEMO: "bg-emerald-50 text-emerald-600",
  ADMIN: "bg-amber-50 text-amber-600",
};

const PAGE_SIZE = 50;

export default function AuditLogPage() {
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // フィルタ
  const [user, setUser] = useState("");
  const [actionType, setActionType] = useState("");
  const [shop, setShop] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const fetchLogs = useCallback(async (p: number) => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/api/report/audit-log", {
        params: {
          page: p, pageSize: PAGE_SIZE,
          ...(user && { user }),
          ...(actionType && { actionType }),
          ...(shop && { shop }),
          ...(from && { from }),
          ...(to && { to }),
        },
      });
      setRows(res.data?.rows || []);
      setTotal(res.data?.total || 0);
      setPage(p);
    } catch (e: any) {
      setError(e?.response?.data?.error || "取得に失敗しました");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [user, actionType, shop, from, to]);

  useEffect(() => { fetchLogs(1); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCsvExport = async () => {
    // 現在のフィルタ条件でCSVをダウンロード（Authorizationヘッダー必須のためfetchで取得）
    const { data: sess } = await supabase.auth.getSession();
    const token = sess?.session?.access_token;
    if (!token) { setError("セッションが切れています。再ログインしてください"); return; }
    const params = new URLSearchParams({ format: "csv" });
    if (user) params.set("user", user);
    if (actionType) params.set("actionType", actionType);
    if (shop) params.set("shop", shop);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const res = await fetch(`/api/report/audit-log?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) { setError("CSVエクスポートに失敗しました"); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `操作ログ_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="animate-fade-in">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-slate-800">操作ログ</h1>
        <p className="text-sm text-slate-500 mt-1">誰が・いつ・何をしたかの全記録（社長のみ閲覧可）</p>
      </div>

      {error && (
        <div className="p-3 rounded-lg mb-4 text-sm bg-red-50 text-red-700 border border-red-200">{error}</div>
      )}

      {/* フィルタバー */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 mb-4">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <div>
            <label className="text-xs text-slate-500 block mb-1">ユーザー名</label>
            <input type="text" value={user} onChange={(e) => setUser(e.target.value)}
              placeholder="部分一致" className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm" />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">操作種別</label>
            <select value={actionType} onChange={(e) => setActionType(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm">
              {ACTION_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">対象店舗</label>
            <input type="text" value={shop} onChange={(e) => setShop(e.target.value)}
              placeholder="部分一致" className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm" />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">開始日</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm" />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">終了日</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm" />
          </div>
          <div className="flex items-end gap-2">
            <button onClick={() => fetchLogs(1)} disabled={loading}
              className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-[#003D6B] hover:bg-[#002a4a] disabled:opacity-50"
              style={{ color: "#fff" }}>
              {loading ? "検索中..." : "検索"}
            </button>
            <button onClick={handleCsvExport}
              className="px-4 py-1.5 rounded-lg text-sm font-semibold border border-slate-200 hover:bg-slate-50 text-slate-600">
              CSV
            </button>
          </div>
        </div>
      </div>

      {/* 件数とページネーション */}
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-slate-400">{total.toLocaleString()}件中 {rows.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}〜{(page - 1) * PAGE_SIZE + rows.length}件を表示</p>
        <div className="flex items-center gap-2">
          <button onClick={() => fetchLogs(page - 1)} disabled={page <= 1 || loading}
            className="px-3 py-1 rounded border border-slate-200 text-xs disabled:opacity-40 hover:bg-slate-50">前へ</button>
          <span className="text-xs text-slate-500">{page} / {totalPages}</span>
          <button onClick={() => fetchLogs(page + 1)} disabled={page >= totalPages || loading}
            className="px-3 py-1 rounded border border-slate-200 text-xs disabled:opacity-40 hover:bg-slate-50">次へ</button>
        </div>
      </div>

      {/* ログテーブル */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-x-auto">
        {rows.length === 0 ? (
          <div className="p-12 text-center"><p className="text-slate-400 text-sm">{loading ? "読み込み中..." : "該当する操作ログがありません"}</p></div>
        ) : (
          <table className="w-full text-xs whitespace-nowrap">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="text-left p-3 text-slate-500 font-medium">日時</th>
                <th className="text-left p-3 text-slate-500 font-medium">ユーザー</th>
                <th className="text-left p-3 text-slate-500 font-medium">ロール</th>
                <th className="text-left p-3 text-slate-500 font-medium">操作</th>
                <th className="text-left p-3 text-slate-500 font-medium">種別</th>
                <th className="text-left p-3 text-slate-500 font-medium">対象店舗</th>
                <th className="text-left p-3 text-slate-500 font-medium">詳細</th>
                <th className="text-center p-3 text-slate-500 font-medium">結果</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((log) => (
                <tr key={log.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="p-3 text-slate-400">{new Date(log.created_at).toLocaleString("ja-JP")}</td>
                  <td className="p-3 font-medium text-slate-700">{log.user_name}</td>
                  <td className="p-3 text-slate-500">{log.role ? (ROLE_LABELS as Record<string, string>)[log.role] || log.role : "—"}</td>
                  <td className="p-3">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-50 text-purple-600">{log.action}</span>
                  </td>
                  <td className="p-3">
                    {log.action_type ? (
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${TYPE_BADGE[log.action_type] || "bg-slate-50 text-slate-500"}`}>
                        {ACTION_TYPE_OPTIONS.find((o) => o.value === log.action_type)?.label || log.action_type}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="p-3 text-slate-600">{log.target_shop || "—"}</td>
                  <td className="p-3 text-slate-500 max-w-[360px] overflow-hidden text-ellipsis whitespace-normal break-words">{log.detail || "—"}</td>
                  <td className="p-3 text-center">
                    {log.status === null || log.status === undefined ? "—" : (
                      <span className={`font-semibold ${log.status >= 400 ? "text-red-500" : "text-emerald-600"}`}>{log.status}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
