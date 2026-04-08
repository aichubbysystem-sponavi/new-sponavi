"use client";

import { useState, useEffect, useCallback } from "react";
import { useShop } from "@/components/shop-provider";
import api from "@/lib/api";

interface Post {
  id: string;
  title: string;
  date: string;
  time: string;
  status: string;
  type: string;
  platform: string;
  content?: string;
}

export default function PostsPage() {
  const { selectedShopId, apiConnected } = useShop();
  const [posts, setPosts] = useState<Post[]>([]);

  const fetchPosts = useCallback(async () => {
    if (!selectedShopId) return;
    try {
      const res = await api.get(`/api/shop/${selectedShopId}/post`);
      setPosts(Array.isArray(res.data) ? res.data : []);
    } catch {
      setPosts([]);
    }
  }, [selectedShopId]);

  useEffect(() => { fetchPosts(); }, [fetchPosts]);

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">投稿管理</h1>
          <p className="text-sm text-slate-500 mt-1">GBP投稿の作成・管理・AI自動生成</p>
        </div>
      </div>

      {!apiConnected ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm mb-2">Go APIに接続し、店舗を登録すると投稿管理が利用できます</p>
          <p className="text-slate-300 text-xs">GBP投稿の予約・AI自動生成・カレンダー管理</p>
        </div>
      ) : posts.length === 0 ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">投稿データがありません</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100">
          <div className="space-y-0">
            {posts.map((post) => (
              <div key={post.id} className="flex items-start gap-3 p-4 border-b border-slate-50">
                <div className="text-center min-w-[50px]">
                  <p className="text-xs text-slate-400">{post.date}</p>
                  <p className="text-xs text-slate-400">{post.time}</p>
                </div>
                <div className="flex-1">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
                    post.status === "published" ? "bg-emerald-50 text-emerald-600" :
                    post.status === "scheduled" ? "bg-blue-50 text-blue-600" : "bg-amber-50 text-amber-600"
                  }`}>
                    {post.status === "published" ? "公開済み" : post.status === "scheduled" ? "予約済み" : "下書き"}
                  </span>
                  <p className="text-sm font-medium text-slate-700 mt-1">{post.title}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{post.platform}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
