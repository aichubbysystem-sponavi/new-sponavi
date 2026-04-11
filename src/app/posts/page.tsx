"use client";

import { useState, useEffect, useCallback } from "react";
import { useShop } from "@/components/shop-provider";
import { supabase } from "@/lib/supabase";
import api from "@/lib/api";

interface LocalPost {
  name?: string;
  summary?: string;
  callToAction?: { actionType?: string; url?: string };
  createTime?: string;
  topicType?: string;
  media?: { googleUrl?: string; sourceUrl?: string; mediaFormat?: string }[];
  searchUrl?: string;
  state?: string;
  // ログ由来
  _fromLog?: boolean;
  _shopName?: string;
}

const TOPIC_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  STANDARD: { bg: "bg-blue-50", text: "text-blue-600", label: "通常投稿" },
  EVENT: { bg: "bg-purple-50", text: "text-purple-600", label: "イベント" },
  OFFER: { bg: "bg-amber-50", text: "text-amber-600", label: "特典" },
  ALERT: { bg: "bg-red-50", text: "text-red-600", label: "お知らせ" },
};

type ConfirmStatus = "unconfirmed" | "confirmed" | "needs_fix";
const STATUS_STYLES: Record<ConfirmStatus, { label: string; bg: string; text: string }> = {
  unconfirmed: { label: "未確認", bg: "bg-amber-50", text: "text-amber-600" },
  confirmed: { label: "確認済み", bg: "bg-emerald-50", text: "text-emerald-600" },
  needs_fix: { label: "要修正", bg: "bg-red-50", text: "text-red-600" },
};

export default function PostsPage() {
  const { selectedShopId, selectedShop, apiConnected, shops, shopFilterMode } = useShop();
  const [localPosts, setLocalPosts] = useState<LocalPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newPost, setNewPost] = useState({ summary: "", topicType: "STANDARD", actionType: "", actionUrl: "", photoUrl: "" });
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState("");
  const [dateSort, setDateSort] = useState<"desc" | "asc">("desc");
  const [viewMode, setViewMode] = useState<"list" | "calendar" | "shops">("list");
  const [confirmMap, setConfirmMap] = useState<Record<string, ConfirmStatus>>({});
  const [shopPostCounts, setShopPostCounts] = useState<{ name: string; count: number; lastPost: string }[]>([]);

  const isAllMode = shopFilterMode === "all";

  const fetchData = useCallback(async () => {
    if (!isAllMode && !selectedShopId) return;
    setLoading(true);
    try {
      if (isAllMode) {
        // 全店舗モード: post_logsから取得
        const { data: logs } = await supabase.from("post_logs")
          .select("*").order("created_at", { ascending: false }).limit(100);
        setLocalPosts((logs || []).map((log) => ({
          summary: log.summary, topicType: log.topic_type, createTime: log.created_at,
          callToAction: log.action_type ? { actionType: log.action_type, url: log.action_url } : undefined,
          _fromLog: true, _shopName: log.shop_name,
        })));
      } else {
        // 単一店舗: GBP API + post_logs
        const gbpRes = await api.get(`/api/shop/${selectedShopId}/local_post`).catch(() => ({ data: { localPosts: [] } }));
        const gbpPosts: LocalPost[] = gbpRes.data?.localPosts || [];

        const { data: logs } = await supabase.from("post_logs")
          .select("summary, topic_type, media_url, action_type, action_url, created_at")
          .eq("shop_id", selectedShopId).order("created_at", { ascending: false });

        const logPosts: LocalPost[] = (logs || []).map((log) => ({
          summary: log.summary, topicType: log.topic_type, createTime: log.created_at,
          callToAction: log.action_type ? { actionType: log.action_type, url: log.action_url } : undefined,
          _fromLog: true,
        }));

        const gbpSummaries = new Set(gbpPosts.map((p) => p.summary?.slice(0, 30)));
        const unique = logPosts.filter((p) => !gbpSummaries.has(p.summary?.slice(0, 30)));
        setLocalPosts([...gbpPosts, ...unique]);
      }

      // 確認ステータスをlocalStorageから読み込み
      const saved = localStorage.getItem("post-confirm-status");
      if (saved) setConfirmMap(JSON.parse(saved));
    } catch { setLocalPosts([]); }
    finally { setLoading(false); }
  }, [selectedShopId, isAllMode]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // 全店舗の投稿状況
  useEffect(() => {
    if (!apiConnected) return;
    supabase.from("post_logs")
      .select("shop_name, created_at")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        const map = new Map<string, { count: number; lastPost: string }>();
        (data || []).forEach((log) => {
          if (!map.has(log.shop_name)) map.set(log.shop_name, { count: 0, lastPost: log.created_at });
          map.get(log.shop_name)!.count++;
        });
        // 全店舗（ログがない店舗も含む）
        const allShops = shops.map((s) => ({
          name: s.name,
          count: map.get(s.name)?.count || 0,
          lastPost: map.get(s.name)?.lastPost || "",
        }));
        setShopPostCounts(allShops);
      });
  }, [apiConnected, shops]);

  const handleCreate = async () => {
    if (!selectedShopId || !newPost.summary.trim()) { setMsg("本文を入力してください"); return; }
    setCreating(true); setMsg("");
    try {
      const postData: any = { shopId: selectedShopId, summary: newPost.summary, topicType: newPost.topicType };
      if (newPost.actionType && newPost.actionUrl) postData.callToAction = { actionType: newPost.actionType, url: newPost.actionUrl };
      if (newPost.photoUrl.trim()) postData.photoUrl = newPost.photoUrl.trim();
      await api.post("/api/report/create-post", postData, { timeout: 30000 });
      setMsg("投稿を作成しました！");
      setShowCreate(false);
      setNewPost({ summary: "", topicType: "STANDARD", actionType: "", actionUrl: "", photoUrl: "" });
      await fetchData();
    } catch (e: any) {
      setMsg(`投稿に失敗しました: ${e?.response?.data?.error || e?.message || "不明なエラー"}`);
    } finally { setCreating(false); }
  };

  const handleDelete = async (postName: string) => {
    if (!confirm("この投稿をGBPから削除しますか？")) return;
    try {
      await api.post("/api/report/delete-post", { postName }, { timeout: 15000 });
      setMsg("投稿を削除しました");
      await fetchData();
    } catch (e: any) {
      setMsg(`削除失敗: ${e?.response?.data?.error || e?.message}`);
    }
  };

  const setConfirm = (key: string, status: ConfirmStatus) => {
    const next = { ...confirmMap, [key]: status };
    setConfirmMap(next);
    localStorage.setItem("post-confirm-status", JSON.stringify(next));
  };

  const postKey = (p: LocalPost, i: number) => p.name || `${p.summary?.slice(0, 20)}_${i}`;

  // 統計
  const last30Days = localPosts.filter((p) => p.createTime && Date.now() - new Date(p.createTime).getTime() < 30 * 24 * 60 * 60 * 1000).length;
  const frequencyLabel = last30Days >= 8 ? "優秀" : last30Days >= 4 ? "良好" : last30Days >= 1 ? "改善余地あり" : "要改善";
  const frequencyColor = last30Days >= 8 ? "text-emerald-600" : last30Days >= 4 ? "text-blue-600" : last30Days >= 1 ? "text-amber-600" : "text-red-600";
  const typeStats = localPosts.reduce((a, p) => { const t = p.topicType || "STANDARD"; a[t] = (a[t] || 0) + 1; return a; }, {} as Record<string, number>);
  const unconfirmed = localPosts.filter((_, i) => !confirmMap[postKey(localPosts[i], i)] || confirmMap[postKey(localPosts[i], i)] === "unconfirmed").length;

  // カレンダー
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const firstDayOfWeek = new Date(now.getFullYear(), now.getMonth(), 1).getDay();
  const postsByDay = localPosts.reduce((a, p) => {
    if (!p.createTime) return a;
    const d = new Date(p.createTime);
    if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) {
      const day = d.getDate();
      if (!a[day]) a[day] = [];
      a[day].push(p);
    }
    return a;
  }, {} as Record<number, LocalPost[]>);

  const sorted = [...localPosts].sort((a, b) => {
    const ta = a.createTime ? new Date(a.createTime).getTime() : 0;
    const tb = b.createTime ? new Date(b.createTime).getTime() : 0;
    return dateSort === "desc" ? tb - ta : ta - tb;
  });

  return (
    <div className="animate-fade-in">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-slate-800">投稿管理・分析</h1>
        <p className="text-sm text-slate-500 mt-1">GBP投稿の作成・確認・分析・カレンダー</p>
      </div>

      {msg && (
        <div className={`p-3 rounded-lg mb-4 text-sm ${msg.includes("失敗") ? "bg-red-50 text-red-700 border border-red-200" : "bg-emerald-50 text-emerald-700 border border-emerald-200"}`}>{msg}</div>
      )}

      {!apiConnected || (!isAllMode && !selectedShopId) ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">{apiConnected ? "店舗を選択してください" : "Go APIに接続してください"}</p>
        </div>
      ) : (
        <>
          {/* KPI */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
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
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
              <p className="text-[11px] font-medium text-slate-400 mb-1">未確認</p>
              <p className={`text-2xl font-bold ${unconfirmed > 0 ? "text-amber-600" : "text-emerald-600"}`}>{unconfirmed}</p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
              <p className="text-[11px] font-medium text-slate-400 mb-1">タイプ別</p>
              <div className="flex flex-wrap gap-1 mt-1">
                {Object.entries(typeStats).map(([t, c]) => {
                  const s = TOPIC_STYLES[t] || TOPIC_STYLES.STANDARD;
                  return <span key={t} className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${s.bg} ${s.text}`}>{s.label}: {c}</span>;
                })}
              </div>
            </div>
          </div>

          {/* アクションバー */}
          {!isAllMode && (
            <div className="flex items-center justify-end mb-5">
              <button onClick={() => setShowCreate(!showCreate)}
                className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-[#003D6B] hover:bg-[#002a4a]"
                style={{ color: "#fff" }}>
                {showCreate ? "閉じる" : "+ 新規投稿"}
              </button>
            </div>
          )}

          {/* 新規投稿フォーム */}
          {showCreate && !isAllMode && (
            <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 mb-6">
              <h3 className="text-sm font-semibold text-slate-500 mb-4">新規GBP投稿</h3>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">投稿タイプ</label>
                  <select value={newPost.topicType} onChange={(e) => setNewPost({ ...newPost, topicType: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
                    <option value="STANDARD">通常投稿</option><option value="EVENT">イベント</option>
                    <option value="OFFER">特典</option><option value="ALERT">お知らせ</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">投稿本文 *</label>
                  <textarea value={newPost.summary} onChange={(e) => setNewPost({ ...newPost, summary: e.target.value })}
                    placeholder="投稿の内容を入力..." className="w-full border border-slate-200 rounded-lg px-4 py-3 text-sm min-h-[120px] resize-y focus:outline-none focus:ring-2 focus:ring-[#003D6B]/20" />
                  <p className="text-xs text-slate-400 mt-1">{newPost.summary.length} / 1500文字</p>
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">写真URL（任意）</label>
                  <input type="text" value={newPost.photoUrl} onChange={(e) => setNewPost({ ...newPost, photoUrl: e.target.value })}
                    placeholder="https://example.com/photo.jpg" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                  {newPost.photoUrl && <img src={newPost.photoUrl} alt="" className="h-20 rounded-lg object-cover mt-2 border" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">ボタンタイプ（任意）</label>
                    <select value={newPost.actionType} onChange={(e) => setNewPost({ ...newPost, actionType: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
                      <option value="">なし</option><option value="BOOK">予約</option><option value="ORDER">注文</option>
                      <option value="LEARN_MORE">詳しく見る</option><option value="SIGN_UP">登録</option><option value="CALL">電話</option>
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
                    className="px-6 py-2 rounded-lg text-sm font-semibold bg-[#003D6B] hover:bg-[#002a4a] disabled:opacity-50" style={{ color: "#fff" }}>
                    {creating ? "投稿中..." : "GBPに投稿"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 表示切替 */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="flex border border-slate-200 rounded-lg overflow-hidden">
                <button onClick={() => setViewMode("list")} className={`px-4 py-1.5 text-xs font-semibold ${viewMode === "list" ? "bg-[#003D6B] text-white" : "bg-white text-slate-500"}`}>リスト</button>
                <button onClick={() => setViewMode("calendar")} className={`px-4 py-1.5 text-xs font-semibold ${viewMode === "calendar" ? "bg-[#003D6B] text-white" : "bg-white text-slate-500"}`}>カレンダー</button>
                <button onClick={() => setViewMode("shops")} className={`px-4 py-1.5 text-xs font-semibold ${viewMode === "shops" ? "bg-[#003D6B] text-white" : "bg-white text-slate-500"}`}>全店舗状況</button>
              </div>
              {viewMode === "list" && (
                <div className="flex border border-slate-200 rounded-lg overflow-hidden">
                  <button onClick={() => setDateSort("desc")} className={`px-3 py-1.5 text-xs font-semibold ${dateSort === "desc" ? "bg-[#003D6B] text-white" : "bg-white text-slate-500"}`}>新しい順</button>
                  <button onClick={() => setDateSort("asc")} className={`px-3 py-1.5 text-xs font-semibold ${dateSort === "asc" ? "bg-[#003D6B] text-white" : "bg-white text-slate-500"}`}>古い順</button>
                </div>
              )}
            </div>
            <p className="text-xs text-slate-400">{localPosts.length}件</p>
          </div>

          {loading ? (
            <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center"><p className="text-slate-400 text-sm">読み込み中...</p></div>
          ) : viewMode === "shops" ? (
            /* 全店舗投稿状況 */
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    <th className="text-left p-3 text-slate-500 font-medium">店舗名</th>
                    <th className="text-center p-3 text-slate-500 font-medium">投稿数</th>
                    <th className="text-center p-3 text-slate-500 font-medium">最終投稿</th>
                    <th className="text-center p-3 text-slate-500 font-medium">ステータス</th>
                  </tr>
                </thead>
                <tbody>
                  {shopPostCounts.sort((a, b) => a.count - b.count).map((s, i) => {
                    const daysSince = s.lastPost ? Math.floor((Date.now() - new Date(s.lastPost).getTime()) / (24 * 60 * 60 * 1000)) : 999;
                    return (
                      <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="p-3 font-medium text-slate-800">{s.name}</td>
                        <td className="p-3 text-center font-bold text-slate-700">{s.count}</td>
                        <td className="p-3 text-center text-slate-500">{s.lastPost ? new Date(s.lastPost).toLocaleDateString("ja-JP") : "—"}</td>
                        <td className="p-3 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            s.count === 0 ? "bg-red-50 text-red-600"
                            : daysSince > 14 ? "bg-amber-50 text-amber-600"
                            : "bg-emerald-50 text-emerald-600"
                          }`}>
                            {s.count === 0 ? "未投稿" : daysSince > 14 ? `${daysSince}日前` : "最新"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : viewMode === "calendar" ? (
            /* カレンダー */
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
              <h3 className="text-sm font-semibold text-slate-500 mb-4">{now.getFullYear()}年{now.getMonth() + 1}月</h3>
              <div className="grid grid-cols-7 gap-1">
                {["日","月","火","水","木","金","土"].map((d) => <div key={d} className="text-center text-xs font-semibold text-slate-400 py-2">{d}</div>)}
                {Array.from({ length: firstDayOfWeek }).map((_, i) => <div key={`e${i}`} className="aspect-square" />)}
                {Array.from({ length: daysInMonth }).map((_, i) => {
                  const day = i + 1;
                  const dp = postsByDay[day] || [];
                  const isToday = day === now.getDate();
                  return (
                    <div key={day} className={`aspect-square border rounded-lg p-1 flex flex-col ${isToday ? "border-blue-400 bg-blue-50" : "border-slate-100"} ${dp.length > 0 ? "bg-emerald-50" : ""}`}>
                      <span className={`text-[10px] font-medium ${isToday ? "text-blue-600" : "text-slate-500"}`}>{day}</span>
                      {dp.length > 0 && <div className="flex flex-wrap gap-0.5 mt-auto">
                        {dp.map((p, j) => { const s = TOPIC_STYLES[p.topicType || "STANDARD"]; return <div key={j} className={`w-2 h-2 rounded-full ${s.text.replace("text-","bg-")}`} title={p.summary?.slice(0,30)} />; })}
                      </div>}
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
            /* リストビュー（プレビュー+確認ステータス+削除） */
            <div className="space-y-3">
              {sorted.map((post, i) => {
                const s = TOPIC_STYLES[post.topicType || "STANDARD"] || TOPIC_STYLES.STANDARD;
                const key = postKey(post, i);
                const status = confirmMap[key] || "unconfirmed";
                const ss = STATUS_STYLES[status];
                const photoUrl = post.media?.[0]?.googleUrl || post.media?.[0]?.sourceUrl;
                return (
                  <div key={i} className={`bg-white rounded-xl shadow-sm border overflow-hidden ${status === "needs_fix" ? "border-red-200" : status === "confirmed" ? "border-emerald-200" : "border-slate-100"}`}>
                    <div className="flex">
                      {/* 写真プレビュー */}
                      {photoUrl && (
                        <div className="w-32 flex-shrink-0 bg-slate-100">
                          <img src={photoUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                        </div>
                      )}
                      <div className="flex-1 p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.bg} ${s.text}`}>{s.label}</span>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${ss.bg} ${ss.text}`}>{ss.label}</span>
                            {post._fromLog && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-400">ログ</span>}
                            {isAllMode && post._shopName && <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-50 text-slate-500">{post._shopName}</span>}
                          </div>
                          <span className="text-xs text-slate-400">{post.createTime ? new Date(post.createTime).toLocaleDateString("ja-JP") : ""}</span>
                        </div>
                        <p className="text-sm text-slate-700 mb-2">{post.summary || "（本文なし）"}</p>
                        {post.callToAction?.url && (
                          <a href={post.callToAction.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline mb-2 inline-block">
                            {post.callToAction.actionType || "リンク"} →
                          </a>
                        )}
                        {/* アクションボタン */}
                        <div className="flex items-center gap-1.5 mt-2">
                          <button onClick={() => setConfirm(key, "confirmed")}
                            className={`px-2 py-1 rounded text-[10px] font-semibold transition ${status === "confirmed" ? "bg-emerald-600 text-white" : "bg-emerald-50 text-emerald-600 hover:bg-emerald-100"}`}>
                            確認OK
                          </button>
                          <button onClick={() => setConfirm(key, "needs_fix")}
                            className={`px-2 py-1 rounded text-[10px] font-semibold transition ${status === "needs_fix" ? "bg-red-600 text-white" : "bg-red-50 text-red-600 hover:bg-red-100"}`}>
                            要修正
                          </button>
                          <button onClick={() => setConfirm(key, "unconfirmed")}
                            className="px-2 py-1 rounded text-[10px] font-semibold bg-slate-50 text-slate-400 hover:bg-slate-100">
                            リセット
                          </button>
                          {post.name && (
                            <button onClick={() => handleDelete(post.name!)}
                              className="px-2 py-1 rounded text-[10px] font-semibold bg-red-50 text-red-500 hover:bg-red-100 ml-auto">
                              削除
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
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
