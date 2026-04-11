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

export default function PostsPage() {
  const { selectedShopId, selectedShop, apiConnected } = useShop();
  const [localPosts, setLocalPosts] = useState<LocalPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newPost, setNewPost] = useState({ summary: "", topicType: "STANDARD", actionType: "", actionUrl: "" });
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState("");
  const [dateSort, setDateSort] = useState<"desc" | "asc">("desc");

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
      const body: any = {
        summary: newPost.summary,
        topicType: newPost.topicType,
      };
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

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">投稿管理</h1>
          <p className="text-sm text-slate-500 mt-1">GBP投稿の作成・管理</p>
        </div>
        {apiConnected && selectedShopId && (
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#003D6B] hover:bg-[#002a4a]"
            style={{ color: "#fff" }}
          >
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
          {/* 新規投稿フォーム */}
          {showCreate && (
            <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 mb-6">
              <h3 className="text-sm font-semibold text-slate-500 mb-4">新規GBP投稿</h3>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">投稿タイプ</label>
                  <select
                    value={newPost.topicType}
                    onChange={(e) => setNewPost({ ...newPost, topicType: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="STANDARD">通常投稿</option>
                    <option value="EVENT">イベント</option>
                    <option value="OFFER">特典</option>
                    <option value="ALERT">お知らせ</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">投稿本文 *</label>
                  <textarea
                    value={newPost.summary}
                    onChange={(e) => setNewPost({ ...newPost, summary: e.target.value })}
                    placeholder="投稿の内容を入力..."
                    className="w-full border border-slate-200 rounded-lg px-4 py-3 text-sm min-h-[120px] resize-y focus:outline-none focus:ring-2 focus:ring-[#003D6B]/20"
                  />
                  <p className="text-xs text-slate-400 mt-1">{newPost.summary.length} / 1500文字</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">ボタンタイプ（任意）</label>
                    <select
                      value={newPost.actionType}
                      onChange={(e) => setNewPost({ ...newPost, actionType: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                    >
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
                    <input
                      type="text"
                      value={newPost.actionUrl}
                      onChange={(e) => setNewPost({ ...newPost, actionUrl: e.target.value })}
                      placeholder="https://..."
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50">キャンセル</button>
                  <button
                    onClick={handleCreate}
                    disabled={creating || !newPost.summary.trim()}
                    className="px-6 py-2 rounded-lg text-sm font-semibold bg-[#003D6B] hover:bg-[#002a4a] disabled:opacity-50"
                    style={{ color: "#fff" }}
                  >
                    {creating ? "投稿中..." : "GBPに投稿"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 投稿一覧 */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-100">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-500">GBP投稿一覧（{localPosts.length}件）</h3>
              <button onClick={() => setDateSort(dateSort === "desc" ? "asc" : "desc")}
                className="px-3 py-1 rounded-lg text-[11px] font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition">
                {dateSort === "desc" ? "新しい順 ↓" : "古い順 ↑"}
              </button>
            </div>
            {loading ? (
              <div className="p-12 text-center"><p className="text-slate-400 text-sm">読み込み中...</p></div>
            ) : localPosts.length === 0 ? (
              <div className="p-12 text-center"><p className="text-slate-400 text-sm">GBP投稿がありません。「+ 新規投稿」から作成してください。</p></div>
            ) : (
              <div className="divide-y divide-slate-50">
                {[...localPosts].sort((a, b) => {
                  const ta = a.createTime ? new Date(a.createTime).getTime() : 0;
                  const tb = b.createTime ? new Date(b.createTime).getTime() : 0;
                  return dateSort === "desc" ? tb - ta : ta - tb;
                }).map((post, i) => (
                  <div key={i} className="p-4">
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        post.topicType === "EVENT" ? "bg-purple-50 text-purple-600" :
                        post.topicType === "OFFER" ? "bg-amber-50 text-amber-600" :
                        post.topicType === "ALERT" ? "bg-red-50 text-red-600" :
                        "bg-blue-50 text-blue-600"
                      }`}>
                        {post.topicType === "EVENT" ? "イベント" : post.topicType === "OFFER" ? "特典" : post.topicType === "ALERT" ? "お知らせ" : "通常投稿"}
                      </span>
                      <span className="text-xs text-slate-400">{post.createTime ? new Date(post.createTime).toLocaleDateString("ja-JP") : ""}</span>
                    </div>
                    <p className="text-sm text-slate-700 mt-1">{post.summary || "（本文なし）"}</p>
                    {post.callToAction?.url && (
                      <a href={post.callToAction.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline mt-1 inline-block">
                        {post.callToAction.actionType || "リンク"} →
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
