"use client";

import { useState, useEffect, useCallback } from "react";
import { useShop } from "@/components/shop-provider";
import api from "@/lib/api";
import Link from "next/link";

interface LocalPost {
  name?: string;
  summary?: string;
  callToAction?: { actionType?: string; url?: string };
  createTime?: string;
  topicType?: string;
  state?: string;
  media?: { googleUrl?: string; mediaFormat?: string }[];
}

const TOPIC_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  STANDARD: { bg: "bg-blue-50", text: "text-blue-600", label: "通常投稿" },
  EVENT: { bg: "bg-purple-50", text: "text-purple-600", label: "イベント" },
  OFFER: { bg: "bg-amber-50", text: "text-amber-600", label: "特典" },
  ALERT: { bg: "bg-red-50", text: "text-red-600", label: "お知らせ" },
};

export default function OrganicPage() {
  const { selectedShopId, selectedShop, apiConnected } = useShop();
  const [posts, setPosts] = useState<LocalPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");

  const fetchPosts = useCallback(async () => {
    if (!selectedShopId) return;
    setLoading(true);
    try {
      const res = await api.get(`/api/shop/${selectedShopId}/local_post`);
      setPosts(res.data?.localPosts || []);
    } catch {
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [selectedShopId]);

  useEffect(() => { fetchPosts(); }, [fetchPosts]);

  // 月別集計
  const monthlyStats = posts.reduce((acc, post) => {
    if (!post.createTime) return acc;
    const d = new Date(post.createTime);
    const key = `${d.getFullYear()}/${d.getMonth() + 1}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // タイプ別集計
  const typeStats = posts.reduce((acc, post) => {
    const type = post.topicType || "STANDARD";
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // カレンダー用データ
  const now = new Date();
  const calendarMonth = `${now.getFullYear()}年${now.getMonth() + 1}月`;
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const firstDayOfWeek = new Date(now.getFullYear(), now.getMonth(), 1).getDay();

  const postsByDay = posts.reduce((acc, post) => {
    if (!post.createTime) return acc;
    const d = new Date(post.createTime);
    if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) {
      const day = d.getDate();
      if (!acc[day]) acc[day] = [];
      acc[day].push(post);
    }
    return acc;
  }, {} as Record<number, LocalPost[]>);

  // 投稿頻度スコア（30日間）
  const last30Days = posts.filter((p) => {
    if (!p.createTime) return false;
    return Date.now() - new Date(p.createTime).getTime() < 30 * 24 * 60 * 60 * 1000;
  }).length;

  const frequencyLabel = last30Days >= 8 ? "優秀" : last30Days >= 4 ? "良好" : last30Days >= 1 ? "改善余地あり" : "要改善";
  const frequencyColor = last30Days >= 8 ? "text-emerald-600" : last30Days >= 4 ? "text-blue-600" : last30Days >= 1 ? "text-amber-600" : "text-red-600";

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">オーガニック投稿</h1>
          <p className="text-sm text-slate-500 mt-1">GBP投稿の管理・分析・カレンダー</p>
        </div>
        {apiConnected && selectedShopId && (
          <Link
            href="/posts"
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#003D6B] hover:bg-[#002a4a] inline-block"
            style={{ color: "#fff" }}
          >
            + 新規投稿
          </Link>
        )}
      </div>

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
              <p className="text-2xl font-bold text-[#003D6B]">{posts.length}<span className="text-xs font-normal text-slate-400 ml-1">件</span></p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
              <p className="text-[11px] font-medium text-slate-400 mb-1">直近30日間</p>
              <p className="text-2xl font-bold text-emerald-600">{last30Days}<span className="text-xs font-normal text-slate-400 ml-1">件</span></p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
              <p className="text-[11px] font-medium text-slate-400 mb-1">投稿頻度</p>
              <p className={`text-lg font-bold ${frequencyColor}`}>{frequencyLabel}</p>
              <p className="text-[10px] text-slate-400">推奨: 週2回以上</p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
              <p className="text-[11px] font-medium text-slate-400 mb-1">投稿タイプ</p>
              <div className="flex flex-wrap gap-1 mt-1">
                {Object.entries(typeStats).map(([type, count]) => {
                  const style = TOPIC_STYLES[type] || TOPIC_STYLES.STANDARD;
                  return (
                    <span key={type} className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${style.bg} ${style.text}`}>
                      {style.label}: {count}
                    </span>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 表示切替 */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex border border-slate-200 rounded-lg overflow-hidden">
              <button
                onClick={() => setViewMode("list")}
                className={`px-4 py-1.5 text-xs font-semibold ${viewMode === "list" ? "bg-[#003D6B] text-white" : "bg-white text-slate-500"}`}
              >
                リスト
              </button>
              <button
                onClick={() => setViewMode("calendar")}
                className={`px-4 py-1.5 text-xs font-semibold ${viewMode === "calendar" ? "bg-[#003D6B] text-white" : "bg-white text-slate-500"}`}
              >
                カレンダー
              </button>
            </div>

            {Object.keys(monthlyStats).length > 1 && (
              <div className="flex items-end gap-1 h-8">
                {Object.entries(monthlyStats).slice(-6).map(([month, count]) => {
                  const max = Math.max(...Object.values(monthlyStats), 1);
                  return (
                    <div key={month} className="flex flex-col items-center gap-0.5" title={`${month}: ${count}件`}>
                      <div className="w-6 bg-blue-400 rounded-sm" style={{ height: `${Math.max((count / max) * 100, 10)}%` }} />
                      <span className="text-[8px] text-slate-400">{month.split("/")[1]}月</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {loading ? (
            <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
              <p className="text-slate-400 text-sm">読み込み中...</p>
            </div>
          ) : viewMode === "calendar" ? (
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
              <h3 className="text-sm font-semibold text-slate-500 mb-4">{calendarMonth} 投稿カレンダー</h3>
              <div className="grid grid-cols-7 gap-1">
                {["日", "月", "火", "水", "木", "金", "土"].map((d) => (
                  <div key={d} className="text-center text-xs font-semibold text-slate-400 py-2">{d}</div>
                ))}
                {Array.from({ length: firstDayOfWeek }).map((_, i) => (
                  <div key={`e${i}`} className="aspect-square" />
                ))}
                {Array.from({ length: daysInMonth }).map((_, i) => {
                  const day = i + 1;
                  const dayPosts = postsByDay[day] || [];
                  const isToday = day === now.getDate();
                  return (
                    <div
                      key={day}
                      className={`aspect-square border rounded-lg p-1 flex flex-col ${
                        isToday ? "border-blue-400 bg-blue-50" : "border-slate-100"
                      } ${dayPosts.length > 0 ? "bg-emerald-50" : ""}`}
                    >
                      <span className={`text-[10px] font-medium ${isToday ? "text-blue-600" : "text-slate-500"}`}>{day}</span>
                      {dayPosts.length > 0 && (
                        <div className="flex flex-wrap gap-0.5 mt-auto">
                          {dayPosts.map((p, j) => {
                            const style = TOPIC_STYLES[p.topicType || "STANDARD"];
                            return <div key={j} className={`w-2 h-2 rounded-full ${style.text.replace("text-", "bg-")}`} title={p.summary?.slice(0, 30)} />;
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {posts.length === 0 ? (
                <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
                  <p className="text-slate-400 text-sm mb-2">投稿がありません</p>
                  <Link href="/posts" className="text-sm text-blue-600 hover:underline">新規投稿を作成 →</Link>
                </div>
              ) : posts.map((post, i) => {
                const style = TOPIC_STYLES[post.topicType || "STANDARD"] || TOPIC_STYLES.STANDARD;
                return (
                  <div key={i} className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
                    <div className="flex items-center justify-between mb-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${style.bg} ${style.text}`}>
                        {style.label}
                      </span>
                      <span className="text-xs text-slate-400">
                        {post.createTime ? new Date(post.createTime).toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" }) : ""}
                      </span>
                    </div>
                    <p className="text-sm text-slate-700 mb-2">{post.summary || "（本文なし）"}</p>
                    {post.callToAction?.url && (
                      <a href={post.callToAction.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
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
