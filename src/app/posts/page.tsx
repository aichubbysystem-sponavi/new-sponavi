"use client";

import { useState, useEffect, useCallback } from "react";
import { useShop } from "@/components/shop-provider";
import api from "@/lib/api";

interface PostReservation {
  id: string;
  summary: string;
  topic_type: string;
  reservation_time: string;
  reservation_status: string;
  reservation_kind: string;
  media_category: string;
  post_file_url: string | null;
  created_at: string;
}

interface LocalPost {
  name?: string;
  summary?: string;
  callToAction?: { actionType?: string; url?: string };
  createTime?: string;
  updateTime?: string;
  state?: string;
  topicType?: string;
  searchUrl?: string;
}

export default function PostsPage() {
  const { selectedShopId, selectedShop, apiConnected } = useShop();
  const [reservations, setReservations] = useState<PostReservation[]>([]);
  const [localPosts, setLocalPosts] = useState<LocalPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"reservation" | "local">("local");

  const fetchData = useCallback(async () => {
    if (!selectedShopId) return;
    setLoading(true);
    try {
      const [resRes, localRes] = await Promise.all([
        api.get(`/api/shop/${selectedShopId}/post/reservation`).catch(() => ({ data: [] })),
        api.get(`/api/shop/${selectedShopId}/local_post`).catch(() => ({ data: { localPosts: [] } })),
      ]);
      setReservations(Array.isArray(resRes.data) ? resRes.data : []);
      setLocalPosts(localRes.data?.localPosts || []);
    } catch { setReservations([]); setLocalPosts([]); }
    finally { setLoading(false); }
  }, [selectedShopId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className="animate-fade-in">
      <h1 className="text-2xl font-bold text-slate-800 mb-2">投稿管理</h1>
      <p className="text-sm text-slate-500 mb-4">GBP投稿の管理・予約投稿</p>

      {!apiConnected || !selectedShopId ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">{apiConnected ? "店舗を選択してください" : "Go APIに接続し、店舗を登録すると利用できます"}</p>
        </div>
      ) : (
        <>
          <div className="flex gap-2 mb-4">
            <button onClick={() => setTab("local")} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === "local" ? "bg-[#003D6B] text-white" : "bg-slate-100 text-slate-600"}`} style={tab === "local" ? { color: "#fff" } : undefined}>GBP投稿</button>
            <button onClick={() => setTab("reservation")} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === "reservation" ? "bg-[#003D6B] text-white" : "bg-slate-100 text-slate-600"}`} style={tab === "reservation" ? { color: "#fff" } : undefined}>予約投稿</button>
          </div>

          {loading ? (
            <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center"><p className="text-slate-400 text-sm">読み込み中...</p></div>
          ) : tab === "local" ? (
            <div className="bg-white rounded-xl shadow-sm border border-slate-100">
              {localPosts.length === 0 ? (
                <div className="p-12 text-center"><p className="text-slate-400 text-sm">GBP投稿がありません</p></div>
              ) : (
                <div className="divide-y divide-slate-50">
                  {localPosts.map((post, i) => (
                    <div key={i} className="p-4">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-slate-400">{post.topicType || "STANDARD"}</span>
                        <span className="text-xs text-slate-400">{post.createTime ? new Date(post.createTime).toLocaleDateString("ja-JP") : ""}</span>
                      </div>
                      <p className="text-sm text-slate-700">{post.summary || "（本文なし）"}</p>
                      {post.callToAction?.url && (
                        <a href={post.callToAction.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline mt-1 inline-block">{post.callToAction.actionType || "リンク"} →</a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-slate-100">
              {reservations.length === 0 ? (
                <div className="p-12 text-center"><p className="text-slate-400 text-sm">予約投稿がありません</p></div>
              ) : (
                <div className="divide-y divide-slate-50">
                  {reservations.map((r) => (
                    <div key={r.id} className="p-4">
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${r.reservation_status === "PUBLISHED" ? "bg-emerald-50 text-emerald-600" : r.reservation_status === "SCHEDULED" ? "bg-blue-50 text-blue-600" : "bg-amber-50 text-amber-600"}`}>
                          {r.reservation_status === "PUBLISHED" ? "公開済み" : r.reservation_status === "SCHEDULED" ? "予約済み" : r.reservation_status}
                        </span>
                        <span className="text-xs text-slate-400">{r.reservation_time ? new Date(r.reservation_time).toLocaleString("ja-JP") : ""}</span>
                      </div>
                      <p className="text-sm text-slate-700 mt-1">{r.summary || "（本文なし）"}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
