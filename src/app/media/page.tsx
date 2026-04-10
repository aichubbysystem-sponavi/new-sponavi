"use client";

import { useState, useEffect, useCallback } from "react";
import { useShop } from "@/components/shop-provider";
import { supabase } from "@/lib/supabase";
import api from "@/lib/api";

interface MediaRow {
  id: string;
  shop_id: string;
  shop_name: string;
  media_name: string;
  google_url: string | null;
  thumbnail_url: string | null;
  category: string;
  view_count: number;
  description: string | null;
  create_time: string | null;
  synced_at: string;
}

const CATEGORIES = [
  { value: "", label: "すべて" },
  { value: "COVER", label: "カバー" },
  { value: "LOGO", label: "ロゴ" },
  { value: "ADDITIONAL", label: "追加写真" },
  { value: "MENU", label: "メニュー" },
  { value: "INTERIOR", label: "店内" },
  { value: "EXTERIOR", label: "外観" },
  { value: "FOOD_AND_DRINK", label: "料理・ドリンク" },
  { value: "AT_WORK", label: "スタッフ" },
  { value: "TEAMS", label: "チーム" },
];

type SortKey = "view_count" | "create_time";

export default function MediaPage() {
  const { selectedShopId, selectedShop, apiConnected } = useShop();
  const [media, setMedia] = useState<MediaRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("create_time");
  const [selectedImg, setSelectedImg] = useState<MediaRow | null>(null);

  const fetchMedia = useCallback(async () => {
    if (!selectedShopId) return;
    setLoading(true);
    try {
      let query = supabase
        .from("media")
        .select("*")
        .eq("shop_id", selectedShopId)
        .order(sortKey, { ascending: false })
        .limit(200);

      if (categoryFilter) {
        query = query.eq("category", categoryFilter);
      }

      const { data } = await query;
      setMedia(data || []);
    } catch {
      setMedia([]);
    } finally {
      setLoading(false);
    }
  }, [selectedShopId, sortKey, categoryFilter]);

  useEffect(() => { fetchMedia(); }, [fetchMedia]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncMsg("写真を同期中...");
    try {
      const res = await api.post("/api/report/sync-media", {
        shopIds: selectedShopId ? [selectedShopId] : [],
      }, { timeout: 300000 });
      setSyncMsg(`${res.data.totalSynced}枚の写真を同期しました`);
      await fetchMedia();
    } catch (e: any) {
      setSyncMsg(`同期に失敗しました: ${e?.response?.data?.error || e?.message || "不明なエラー"}`);
    } finally {
      setSyncing(false);
    }
  };

  // カテゴリ別集計
  const categoryStats = media.reduce((acc, m) => {
    acc[m.category] = (acc[m.category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const totalViews = media.reduce((s, m) => s + (m.view_count || 0), 0);

  const getCategoryLabel = (cat: string) => CATEGORIES.find((c) => c.value === cat)?.label || cat;

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">写真管理</h1>
          <p className="text-sm text-slate-500 mt-1">GBP写真の一覧・カテゴリ管理</p>
        </div>
        {apiConnected && selectedShopId && (
          <button
            onClick={handleSync}
            disabled={syncing}
            className={`px-4 py-2 rounded-lg text-sm font-semibold ${syncing ? "bg-slate-200 text-slate-400" : "bg-[#003D6B] hover:bg-[#002a4a]"}`}
            style={{ color: syncing ? undefined : "#fff" }}
          >
            {syncing ? "同期中..." : "写真を同期"}
          </button>
        )}
      </div>

      {syncMsg && (
        <div className={`p-3 rounded-lg mb-4 text-sm ${syncMsg.includes("失敗") ? "bg-red-50 text-red-700 border border-red-200" : "bg-emerald-50 text-emerald-700 border border-emerald-200"}`}>
          {syncMsg}
        </div>
      )}

      {!apiConnected || !selectedShopId ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">{apiConnected ? "店舗を選択してください" : "Go APIに接続し、店舗を登録すると利用できます"}</p>
        </div>
      ) : (
        <>
          {/* KPIカード */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
              <p className="text-[11px] font-medium text-slate-400 mb-1">写真総数</p>
              <p className="text-2xl font-bold text-[#003D6B]">{media.length}<span className="text-xs font-normal text-slate-400 ml-1">枚</span></p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
              <p className="text-[11px] font-medium text-slate-400 mb-1">総閲覧数</p>
              <p className="text-2xl font-bold text-emerald-600">{totalViews.toLocaleString()}<span className="text-xs font-normal text-slate-400 ml-1">回</span></p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
              <p className="text-[11px] font-medium text-slate-400 mb-1">カテゴリ数</p>
              <p className="text-2xl font-bold text-purple-600">{Object.keys(categoryStats).length}</p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
              <p className="text-[11px] font-medium text-slate-400 mb-1">平均閲覧数</p>
              <p className="text-2xl font-bold text-amber-600">{media.length > 0 ? Math.round(totalViews / media.length).toLocaleString() : 0}<span className="text-xs font-normal text-slate-400 ml-1">回/枚</span></p>
            </div>
          </div>

          {/* カテゴリ分布 */}
          {Object.keys(categoryStats).length > 0 && (
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 mb-5">
              <h3 className="text-sm font-semibold text-slate-500 mb-3">カテゴリ別内訳</h3>
              <div className="flex flex-wrap gap-2">
                {Object.entries(categoryStats).sort((a, b) => b[1] - a[1]).map(([cat, count]) => (
                  <button
                    key={cat}
                    onClick={() => setCategoryFilter(categoryFilter === cat ? "" : cat)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      categoryFilter === cat ? "bg-[#003D6B] text-white" : "bg-slate-50 text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    {getCategoryLabel(cat)} ({count})
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* フィルタバー */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs bg-white"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
              <div className="flex border border-slate-200 rounded-lg overflow-hidden">
                <button
                  onClick={() => setSortKey("create_time")}
                  className={`px-3 py-1.5 text-xs font-semibold ${sortKey === "create_time" ? "bg-[#003D6B] text-white" : "bg-white text-slate-500"}`}
                >
                  新しい順
                </button>
                <button
                  onClick={() => setSortKey("view_count")}
                  className={`px-3 py-1.5 text-xs font-semibold ${sortKey === "view_count" ? "bg-[#003D6B] text-white" : "bg-white text-slate-500"}`}
                >
                  閲覧数順
                </button>
              </div>
            </div>
            <p className="text-xs text-slate-400">{media.length}件表示</p>
          </div>

          {/* 写真グリッド */}
          {loading ? (
            <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
              <p className="text-slate-400 text-sm">読み込み中...</p>
            </div>
          ) : media.length === 0 ? (
            <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
              <p className="text-slate-400 text-sm">写真がありません。「写真を同期」でGBPから取得してください。</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
              {media.map((m) => (
                <div
                  key={m.id}
                  className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => setSelectedImg(m)}
                >
                  <div className="aspect-square bg-slate-100 relative">
                    {(m.google_url || m.thumbnail_url) ? (
                      <img
                        src={m.thumbnail_url || m.google_url || ""}
                        alt={m.description || m.category}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-300 text-sm">No Image</div>
                    )}
                    <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-black/50 text-white">
                      {getCategoryLabel(m.category)}
                    </span>
                  </div>
                  <div className="p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-500">閲覧: {m.view_count.toLocaleString()}回</span>
                      <span className="text-[10px] text-slate-400">{m.create_time ? new Date(m.create_time).toLocaleDateString("ja-JP") : ""}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 画像プレビューモーダル */}
          {selectedImg && (
            <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setSelectedImg(null)}>
              <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="relative">
                  {(selectedImg.google_url || selectedImg.thumbnail_url) && (
                    <img
                      src={selectedImg.google_url || selectedImg.thumbnail_url || ""}
                      alt=""
                      className="w-full max-h-[60vh] object-contain bg-slate-100"
                    />
                  )}
                  <button onClick={() => setSelectedImg(null)} className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/50 text-white flex items-center justify-center text-sm">✕</button>
                </div>
                <div className="p-5">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-600">{getCategoryLabel(selectedImg.category)}</span>
                    <span className="text-sm text-slate-500">閲覧数: {selectedImg.view_count.toLocaleString()}回</span>
                  </div>
                  {selectedImg.description && <p className="text-sm text-slate-600">{selectedImg.description}</p>}
                  <p className="text-xs text-slate-400 mt-2">
                    {selectedImg.create_time && `投稿日: ${new Date(selectedImg.create_time).toLocaleDateString("ja-JP")}`}
                    {selectedImg.synced_at && ` | 同期: ${new Date(selectedImg.synced_at).toLocaleDateString("ja-JP")}`}
                  </p>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
