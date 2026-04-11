"use client";

import { useState, useEffect, useCallback } from "react";
import { useShop } from "@/components/shop-provider";
import api from "@/lib/api";

interface LocalPost {
  name?: string;
  summary?: string;
  callToAction?: { actionType?: string; url?: string };
  createTime?: string;
  topicType?: string;
}

const TOPIC_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  STANDARD: { bg: "bg-blue-50", text: "text-blue-600", label: "通常投稿" },
  EVENT: { bg: "bg-purple-50", text: "text-purple-600", label: "イベント" },
  OFFER: { bg: "bg-amber-50", text: "text-amber-600", label: "特典" },
  ALERT: { bg: "bg-red-50", text: "text-red-600", label: "お知らせ" },
};

export default function PostsPage() {
  const { selectedShopId, selectedShop, apiConnected } = useShop();
  const [localPosts, setLocalPosts] = useState<LocalPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newPost, setNewPost] = useState({ summary: "", topicType: "STANDARD", actionType: "", actionUrl: "" });
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState("");
  const [dateSort, setDateSort] = useState<"desc" | "asc">("desc");
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");

  const fetchData = useCallback(async () => {
    if (!selectedShopId) return;
    setLoading(true);
    try {
      const res = await api.get(`/api/shop/${selectedShopId}/local_post`);
      setLocalPosts(res.data?.localPosts || []);
    } catch { setLocalPosts([]); }
    finally { setLoading(false); }
  }, [selectedShopId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCreate = async () => {
    if (!selectedShopId || !newPost.summary.trim()) { setMsg("本文を入力してください"); return; }
    setCreating(true); setMsg("");
    try {
      const body: any = { summary: newPost.summary, topicType: newPost.topicType };
      if (newPost.actionType && newPost.actionUrl) {
        body.callToAction = { actionType: newPost.actionType, url: newPost.actionUrl };
      }
      await api.post(`/api/shop/${selectedShopId}/local_post`, body, { timeout: 30000 });
      setMsg("投稿を作成しました！");
      setShowCreate(false);
      setNewPost({ summary: "", topicType: "STANDARD", actionType: "", actionUrl: "" });
      await fetchData();
    } catch (e: any) {
      setMsg(`投稿に失敗しました: ${e?.response?.data?.message || e?.message || "不明なエラー"}`);
    } finally { setCreating(false); }
  };

  // 投稿頻度（30日間）
  const last30Days = localPosts.filter((p) => p.createTime && Date.now() - new Date(p.createTime).getTime() < 30 * 24 * 60 * 60 * 1000).length;
  const frequencyLabel = last30Days >= 8 ? "優秀" : last30Days >= 4 ? "良好" : last30Days >= 1 ? "改善余地あり" : "要改善";
  const frequencyColor = last30Days >= 8 ? "text-emerald-600" : last30Days >= 4 ? "text-blue-600" : last30Days >= 1 ? "text-amber-600" : "text-red-600";

  // タイプ別集計
  const typeStats = localPosts.reduce((acc, p) => {
    const t = p.topicType || "STANDARD";
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // カレンダー
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const firstDayOfWeek = new Date(now.getFullYear(), now.getMonth(), 1).getDay();
  const postsByDay = localPosts.reduce((acc, post) => {
    if (!post.createTime) return acc;
    const d = new Date(post.createTime);
    if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) {
      const day = d.getDate();
      if (!acc[day]) acc[day] = [];
      acc[day].push(post);
    }
    return acc;
  }, {} as Record<number, LocalPost[]>);

  const sorted = [...localPosts].sort((a, b) => {
    const ta = a.createTime ? new Date(a.createTime).getTime() : 0;
    const tb = b.createTime ? new Date(b.createTime).getTime() : 0;
    return dateSort === "desc" ? tb - ta : ta - tb;
  });

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">投稿管理</h1>
          <p className="text-sm text-slate-500 mt-1">GBP投稿の作成・分析・カレンダー</p>
        </div>
        {apiConnected && selectedShopId && (
          <button onClick={() => setShowCreate(!showCreate)}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#003D6B] hover:bg-[#002a4a]"
            style={{ color: "#fff" }}>
            {showCreate ? "閉じる" : "+ 新規投稿"}
          </button>
        )}
      </div>

      {msg && (
        <div className={`p-3 rounded-lg mb-4 text-sm ${msg.includes("失敗") ? "bg-red-50 text-red-700 border border-red-200" : "bg-emerald-50 text-emerald-700 border border-emerald-200"}`}>
          {msg}
        </div>
      )}

      {!apiConnected || !selectedShopId ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">{apiConnected ? "店舗を選択してください" : "Go APIに接続し、店舗を登録すると利用できます"}</p>
        </div>
      ) : (
        <>
          {/* KPI */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
              <p className="text-[11px] font-medium text-slate-400 mb-1">総投稿数</p>
              <p className="text-2xl font-bold text-[#003D6B]">{localPosts.length}<span className="text-xs font-normal text-slate-400 ml-1">件</span></p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
              <p className="text-[11px] font-medium text-slate-400 mb-1">直近30日</p>
              <p className="text-2xl font-bold text-emerald-600">{last30Days}<span className="text-xs font-normal text-slate-400 ml-1">件</span></p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
              <p className="text-[11px] font-medium text-slate-400 mb-1">投稿頻度</p>
              <p className={`text-lg font-bold ${frequencyColor}`}>{frequencyLabel}</p>
              <p className="text-[10px] text-slate-400">推奨: 週2回以上</p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
              <p className="text-[11px] font-medium text-slate-400 mb-1">タイプ別</p>
              <div className="flex flex-wrap gap-1 mt-1">
                {Object.entries(typeStats).map(([type, count]) => {
                  const s = TOPIC_STYLES[type] || TOPIC_STYLES.STANDARD;
                  return <span key={type} className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${s.bg} ${s.text}`}>{s.label}: {count}</span>;
                })}
              </div>
            </div>
          </div>

          {/* 新規投稿フォーム */}
          {showCreate && (
            <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 mb-6">
              <h3 className="text-sm font-semibold text-slate-500 mb-4">新規GBP投稿</h3>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">投稿タイプ</label>
                  <select value={newPost.topicType} onChange={(e) => setNewPost({ ...newPost, topicType: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
                    <option value="STANDARD">通常投稿</option>
                    <option value="EVENT">イベント</option>
                    <option value="OFFER">特典</option>
                    <option value="ALERT">お知らせ</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">投稿本文 *</label>
                  <textarea value={newPost.summary} onChange={(e) => setNewPost({ ...newPost, summary: e.target.value })}
                    placeholder="投稿の内容を入力..."
                    className="w-full border border-slate-200 rounded-lg px-4 py-3 text-sm min-h-[120px] resize-y focus:outline-none focus:ring-2 focus:ring-[#003D6B]/20" />
                  <p className="text-xs text-slate-400 mt-1">{newPost.summary.length} / 1500文字</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">ボタンタイプ（任意）</label>
                    <select value={newPost.actionType} onChange={(e) => setNewPost({ ...newPost, actionType: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
                      <option value="">なし</option>
                      <option value="BOOK">予約</option>
                      <option value="ORDER">注文</option>
                      <option value="LEARN_MORE">詳しく見る</option>
                      <option value="SIGN_UP">登録</option>
                      <option value="CALL">電話</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">リンクURL（任意）</label>
                    <input type="text" value={newPost.actionUrl} onChange={(e) => setNewPost({ ...newPost, actionUrl: e.target.value })}
                      placeholder="https://..." className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50">キャンセル</button>
                  <button onClick={handleCreate} disabled={creating || !newPost.summary.trim()}
                    className="px-6 py-2 rounded-lg text-sm font-semibold bg-[#003D6B] hover:bg-[#002a4a] disabled:opacity-50"
                    style={{ color: "#fff" }}>
                    {creating ? "投稿中..." : "GBPに投稿"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 表示切替+ソート */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="flex border border-slate-200 rounded-lg overflow-hidden">
                <button onClick={() => setViewMode("list")}
                  className={`px-4 py-1.5 text-xs font-semibold ${viewMode === "list" ? "bg-[#003D6B] text-white" : "bg-white text-slate-500"}`}>
                  リスト
                </button>
                <button onClick={() => setViewMode("calendar")}
                  className={`px-4 py-1.5 text-xs font-semibold ${viewMode === "calendar" ? "bg-[#003D6B] text-white" : "bg-white text-slate-500"}`}>
                  カレンダー
                </button>
              </div>
              {viewMode === "list" && (
                <div className="flex border border-slate-200 rounded-lg overflow-hidden">
                  <button onClick={() => setDateSort("desc")}
                    className={`px-3 py-1.5 text-xs font-semibold ${dateSort === "desc" ? "bg-[#003D6B] text-white" : "bg-white text-slate-500"}`}>
                    新しい順
                  </button>
                  <button onClick={() => setDateSort("asc")}
                    className={`px-3 py-1.5 text-xs font-semibold ${dateSort === "asc" ? "bg-[#003D6B] text-white" : "bg-white text-slate-500"}`}>
                    古い順
                  </button>
                </div>
              )}
            </div>
            <p className="text-xs text-slate-400">{localPosts.length}件</p>
          </div>

          {loading ? (
            <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
              <p className="text-slate-400 text-sm">読み込み中...</p>
            </div>
          ) : viewMode === "calendar" ? (
            /* カレンダービュー */
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
              <h3 className="text-sm font-semibold text-slate-500 mb-4">{now.getFullYear()}年{now.getMonth() + 1}月 投稿カレンダー</h3>
              <div className="grid grid-cols-7 gap-1">
                {["日", "月", "火", "水", "木", "金", "土"].map((d) => (
                  <div key={d} className="text-center text-xs font-semibold text-slate-400 py-2">{d}</div>
                ))}
                {Array.from({ length: firstDayOfWeek }).map((_, i) => <div key={`e${i}`} className="aspect-square" />)}
                {Array.from({ length: daysInMonth }).map((_, i) => {
                  const day = i + 1;
                  const dayPosts = postsByDay[day] || [];
                  const isToday = day === now.getDate();
                  return (
                    <div key={day}
                      className={`aspect-square border rounded-lg p-1 flex flex-col ${isToday ? "border-blue-400 bg-blue-50" : "border-slate-100"} ${dayPosts.length > 0 ? "bg-emerald-50" : ""}`}>
                      <span className={`text-[10px] font-medium ${isToday ? "text-blue-600" : "text-slate-500"}`}>{day}</span>
                      {dayPosts.length > 0 && (
                        <div className="flex flex-wrap gap-0.5 mt-auto">
                          {dayPosts.map((p, j) => {
                            const s = TOPIC_STYLES[p.topicType || "STANDARD"];
                            return <div key={j} className={`w-2 h-2 rounded-full ${s.text.replace("text-", "bg-")}`} title={p.summary?.slice(0, 30)} />;
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : localPosts.length === 0 ? (
            <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
              <p className="text-slate-400 text-sm">GBP投稿がありません。「+ 新規投稿」から作成してください。</p>
            </div>
          ) : (
            /* リストビュー */
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 divide-y divide-slate-50">
              {sorted.map((post, i) => {
                const s = TOPIC_STYLES[post.topicType || "STANDARD"] || TOPIC_STYLES.STANDARD;
                return (
                  <div key={i} className="p-4">
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.bg} ${s.text}`}>{s.label}</span>
                      <span className="text-xs text-slate-400">{post.createTime ? new Date(post.createTime).toLocaleDateString("ja-JP") : ""}</span>
                    </div>
                    <p className="text-sm text-slate-700 mt-1">{post.summary || "（本文なし）"}</p>
                    {post.callToAction?.url && (
                      <a href={post.callToAction.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline mt-1 inline-block">
                        {post.callToAction.actionType || "リンク"} →
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
