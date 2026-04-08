"use client";

import { useState, useEffect, useCallback } from "react";
import { useShop } from "@/components/shop-provider";
import { supabase } from "@/lib/supabase";
import api from "@/lib/api";

interface ReviewRow {
  id: string;
  shop_id: string;
  shop_name: string;
  review_id: string;
  reviewer_name: string;
  star_rating: string;
  comment: string | null;
  reply_comment: string | null;
  create_time: string;
  synced_at: string;
}

const PER_PAGE = 20;

export default function ReviewsPage() {
  const { selectedShopId, selectedShop, apiConnected, shops } = useShop();
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [lastSynced, setLastSynced] = useState<string | null>(null);

  const fetchReviews = useCallback(async () => {
    if (!selectedShopId) return;
    setLoading(true);
    try {
      const from = (page - 1) * PER_PAGE;
      const to = from + PER_PAGE - 1;
      const { data, count } = await supabase
        .from("reviews")
        .select("*", { count: "exact" })
        .eq("shop_id", selectedShopId)
        .order("create_time", { ascending: false })
        .range(from, to);

      setReviews(data || []);
      setTotalCount(count || 0);

      // 最終同期日時
      if (data && data.length > 0) {
        setLastSynced(data[0].synced_at);
      }
    } catch {
      setReviews([]);
    } finally {
      setLoading(false);
    }
  }, [selectedShopId, page]);

  useEffect(() => { fetchReviews(); }, [fetchReviews]);
  useEffect(() => { setPage(1); }, [selectedShopId]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncMsg("口コミを同期中...");
    try {
      const shopIds = selectedShopId ? [selectedShopId] : [];
      const res = await api.post("/api/report/sync-reviews", { shopIds }, { timeout: 300000 });
      const data = res.data;
      setSyncMsg(`${data.totalSynced}件の口コミを同期しました（${data.shops}店舗）`);
      await fetchReviews();
    } catch (e: any) {
      setSyncMsg(`同期に失敗しました: ${e?.response?.data?.error || e?.message || "不明なエラー"}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncAll = async () => {
    setSyncing(true);
    let totalSynced = 0;
    let totalErrors = 0;
    const shopIds = shops.map((s) => s.id);
    const batchSize = 10;

    for (let i = 0; i < shopIds.length; i += batchSize) {
      const batch = shopIds.slice(i, i + batchSize);
      setSyncMsg(`全店舗同期中... ${i}/${shopIds.length}店舗完了`);
      try {
        const res = await api.post("/api/report/sync-reviews", { shopIds: batch }, { timeout: 120000 });
        totalSynced += res.data.totalSynced || 0;
        totalErrors += res.data.totalErrors || 0;
      } catch {
        totalErrors += batch.length;
      }
    }

    setSyncMsg(`${totalSynced}件の口コミを同期しました（${shopIds.length}店舗、エラー${totalErrors}件）`);
    await fetchReviews();
    setSyncing(false);
  };

  const starToNum = (s: string) => {
    const map: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
    const num = s.replace("_STAR", "").replace("_STARS", "");
    return map[num] || 0;
  };

  const totalPages = Math.ceil(totalCount / PER_PAGE);

  return (
    <div className="animate-fade-in">
      <div className="mb-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-800">口コミ管理</h1>
        </div>
        <div className="flex items-center justify-between mt-2">
          <p className="text-sm text-slate-500">口コミ一覧・返信・分析</p>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSync}
              disabled={syncing || !selectedShopId}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                syncing ? "bg-slate-200 text-slate-400" : "bg-emerald-600 hover:bg-emerald-700"
              }`}
              style={{ color: syncing ? undefined : "#fff" }}
            >
              {syncing ? "同期中..." : "この店舗を同期"}
            </button>
            <button
              onClick={handleSyncAll}
              disabled={syncing}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                syncing ? "bg-slate-200 text-slate-400" : "bg-[#003D6B] hover:bg-[#002a4a]"
              }`}
              style={{ color: syncing ? undefined : "#fff" }}
            >
              {syncing ? "同期中..." : "全店舗同期"}
            </button>
          </div>
        </div>
      </div>

      {/* 同期メッセージ */}
      {syncMsg && (
        <div className={`p-3 rounded-lg mb-4 text-sm ${syncMsg.includes("失敗") ? "bg-red-50 text-red-700 border border-red-200" : "bg-emerald-50 text-emerald-700 border border-emerald-200"}`}>
          {syncMsg}
        </div>
      )}

      {/* 統計バー */}
      <div className="flex items-center gap-4 mb-4 text-xs text-slate-500">
        <span>口コミ: {totalCount}件</span>
        {lastSynced && <span>最終同期: {new Date(lastSynced).toLocaleString("ja-JP")}</span>}
        {selectedShop && <span>店舗: {selectedShop.name}</span>}
      </div>

      {!apiConnected ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm mb-2">Go APIに接続し、店舗を登録すると口コミが表示されます</p>
          <p className="text-slate-300 text-xs">GBPの口コミ取得・AI返信候補・感情分析</p>
        </div>
      ) : !selectedShopId ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">店舗を選択してください</p>
        </div>
      ) : loading ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">読み込み中...</p>
        </div>
      ) : reviews.length === 0 ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm mb-2">口コミデータがありません</p>
          <p className="text-slate-300 text-xs">「この店舗を同期」ボタンでGBPから口コミを取得してください</p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {reviews.map((review) => (
              <div key={review.id} className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-700">{review.reviewer_name}</span>
                    <span className="text-amber-400 text-sm">
                      {"★".repeat(starToNum(review.star_rating))}
                      {"☆".repeat(5 - starToNum(review.star_rating))}
                    </span>
                  </div>
                  <span className="text-xs text-slate-400">{new Date(review.create_time).toLocaleDateString("ja-JP")}</span>
                </div>
                {review.comment && <p className="text-sm text-slate-600 mb-3">{review.comment}</p>}
                {review.reply_comment && (
                  <div className="bg-blue-50 rounded-lg p-3 border border-blue-100">
                    <p className="text-xs text-blue-500 font-semibold mb-1">返信済み</p>
                    <p className="text-sm text-blue-700">{review.reply_comment}</p>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* ページネーション */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-6">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 rounded-lg text-xs border border-slate-200 disabled:opacity-30"
              >
                ← 前へ
              </button>
              <span className="text-xs text-slate-500">{page} / {totalPages}</span>
              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1.5 rounded-lg text-xs border border-slate-200 disabled:opacity-30"
              >
                次へ →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
