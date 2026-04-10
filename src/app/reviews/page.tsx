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

type ReplyFilter = "all" | "unreplied" | "replied";
const PER_PAGE = 20;

export default function ReviewsPage() {
  const { selectedShopId, selectedShop, apiConnected, shops, shopFilterMode } = useShop();
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [aiReplyId, setAiReplyId] = useState<string | null>(null);
  const [aiReply, setAiReply] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [replyFilter, setReplyFilter] = useState<ReplyFilter>("all");
  const [unrepliedCount, setUnrepliedCount] = useState(0);

  const isAllMode = shopFilterMode === "all";

  const fetchReviews = useCallback(async () => {
    if (!isAllMode && !selectedShopId) return;
    setLoading(true);
    try {
      const from = (page - 1) * PER_PAGE;
      const to = from + PER_PAGE - 1;

      let query = supabase
        .from("reviews")
        .select("*", { count: "exact" })
        .order("create_time", { ascending: false })
        .range(from, to);

      // 店舗フィルタ
      if (!isAllMode && selectedShopId) {
        query = query.eq("shop_id", selectedShopId);
      }

      // 返信フィルタ
      if (replyFilter === "unreplied") {
        query = query.is("reply_comment", null);
      } else if (replyFilter === "replied") {
        query = query.not("reply_comment", "is", null);
      }

      const { data, count } = await query;
      setReviews(data || []);
      setTotalCount(count || 0);

      if (data && data.length > 0) {
        setLastSynced(data[0].synced_at);
      }
    } catch {
      setReviews([]);
    } finally {
      setLoading(false);
    }
  }, [selectedShopId, page, isAllMode, replyFilter]);

  // 未返信件数を取得
  const fetchUnrepliedCount = useCallback(async () => {
    let query = supabase
      .from("reviews")
      .select("id", { count: "exact", head: true })
      .is("reply_comment", null);

    if (!isAllMode && selectedShopId) {
      query = query.eq("shop_id", selectedShopId);
    }

    const { count } = await query;
    setUnrepliedCount(count || 0);
  }, [selectedShopId, isAllMode]);

  useEffect(() => { fetchReviews(); }, [fetchReviews]);
  useEffect(() => { fetchUnrepliedCount(); }, [fetchUnrepliedCount]);
  useEffect(() => { setPage(1); }, [selectedShopId, replyFilter, shopFilterMode]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncMsg("口コミを同期中...");
    try {
      const shopIds = selectedShopId ? [selectedShopId] : [];
      const res = await api.post("/api/report/sync-reviews", { shopIds }, { timeout: 300000 });
      setSyncMsg(`${res.data.totalSynced}件の口コミを同期しました（${res.data.shops}店舗）`);
      await fetchReviews();
      await fetchUnrepliedCount();
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
    let stoppedAt = 0;
    const shopIds = shops.map((s) => s.id);
    const batchSize = 10;

    for (let i = 0; i < shopIds.length; i += batchSize) {
      const batch = shopIds.slice(i, i + batchSize);
      setSyncMsg(`全店舗同期中... ${i}/${shopIds.length}店舗完了（${totalSynced}件取得済み）`);
      try {
        const res = await api.post("/api/report/sync-reviews", { shopIds: batch }, { timeout: 120000 });
        totalSynced += res.data.totalSynced || 0;
        totalErrors += res.data.totalErrors || 0;
        stoppedAt = i + batchSize;
        if (totalErrors >= 5) {
          setSyncMsg(`⚠ レート制限の可能性があるため中断。${stoppedAt}/${shopIds.length}店舗完了、${totalSynced}件取得済み。`);
          await fetchReviews();
          await fetchUnrepliedCount();
          setSyncing(false);
          return;
        }
      } catch (e: any) {
        stoppedAt = i;
        setSyncMsg(`⚠ ${stoppedAt}/${shopIds.length}店舗で中断（${totalSynced}件取得済み）。原因: ${e?.message || "タイムアウト"}`);
        await fetchReviews();
        setSyncing(false);
        return;
      }
    }
    setSyncMsg(`✓ ${totalSynced}件の口コミを同期しました（${shopIds.length}店舗完了、エラー${totalErrors}件）`);
    await fetchReviews();
    await fetchUnrepliedCount();
    setSyncing(false);
  };

  const handleSyncMedia = async () => {
    setSyncing(true);
    setSyncMsg("写真を同期中...");
    try {
      const res = await api.post("/api/report/sync-media", { shopIds: selectedShopId ? [selectedShopId] : [] }, { timeout: 300000 });
      setSyncMsg(`✓ ${res.data.totalSynced}枚の写真を同期しました（${res.data.shops}店舗）`);
    } catch (e: any) {
      setSyncMsg(`写真同期に失敗しました: ${e?.response?.data?.error || e?.message || "不明なエラー"}`);
    } finally {
      setSyncing(false);
    }
  };

  const starToNum = (s: string | null | undefined) => {
    if (!s) return 0;
    const map: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
    const normalized = s.toUpperCase().replace(/_STARS?/, "");
    return map[normalized] || 0;
  };

  const handleAiReply = async (review: ReviewRow) => {
    if (aiReplyId === review.id) { setAiReplyId(null); setAiReply(""); return; }
    setAiReplyId(review.id);
    setAiLoading(true);
    setAiReply("");
    try {
      const res = await api.post("/api/report/reply-suggest", {
        comment: review.comment || "",
        starRating: starToNum(review.star_rating),
        shopName: selectedShop?.name || review.shop_name || "",
        reviewerName: review.reviewer_name,
      }, { timeout: 25000 });
      setAiReply(res.data.reply || "返信を生成できませんでした");
    } catch (e: any) {
      setAiReply(`エラー: ${e?.response?.data?.error || e?.message || "返信生成に失敗しました"}`);
    } finally {
      setAiLoading(false);
    }
  };

  const totalPages = Math.ceil(totalCount / PER_PAGE);

  const displayLabel = isAllMode
    ? `全店舗 — ${totalCount}件`
    : `${selectedShop?.name || "店舗未選択"} — ${totalCount}件`;

  return (
    <div className="animate-fade-in">
      <div className="mb-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-800">口コミ管理</h1>
        </div>
        <div className="flex items-center justify-between mt-2">
          <p className="text-sm text-slate-500">口コミ一覧・返信・分析</p>
          <div className="flex items-center gap-2">
            <button onClick={handleSync} disabled={syncing || !selectedShopId}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${syncing ? "bg-slate-200 text-slate-400" : "bg-emerald-600 hover:bg-emerald-700"}`}
              style={{ color: syncing ? undefined : "#fff" }}>
              {syncing ? "同期中..." : "この店舗を同期"}
            </button>
            <button onClick={handleSyncAll} disabled={syncing}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${syncing ? "bg-slate-200 text-slate-400" : "bg-[#003D6B] hover:bg-[#002a4a]"}`}
              style={{ color: syncing ? undefined : "#fff" }}>
              {syncing ? "同期中..." : "全店舗同期"}
            </button>
            <button onClick={handleSyncMedia} disabled={syncing}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${syncing ? "bg-slate-200 text-slate-400" : "bg-purple-600 hover:bg-purple-700"}`}
              style={{ color: syncing ? undefined : "#fff" }}>
              {syncing ? "同期中..." : "写真同期"}
            </button>
          </div>
        </div>
      </div>

      {syncMsg && (
        <div className={`p-3 rounded-lg mb-4 text-sm ${syncMsg.includes("失敗") || syncMsg.includes("⚠") ? "bg-red-50 text-red-700 border border-red-200" : "bg-emerald-50 text-emerald-700 border border-emerald-200"}`}>
          {syncMsg}
        </div>
      )}

      {/* フィルタタブ */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span>{displayLabel}</span>
          {lastSynced && <span>最終同期: {new Date(lastSynced).toLocaleString("ja-JP")}</span>}
        </div>
        <div className="flex border border-slate-200 rounded-lg overflow-hidden">
          <button
            onClick={() => setReplyFilter("all")}
            className={`px-3 py-1.5 text-xs font-semibold transition ${replyFilter === "all" ? "bg-[#003D6B] text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}
          >
            すべて
          </button>
          <button
            onClick={() => setReplyFilter("unreplied")}
            className={`px-3 py-1.5 text-xs font-semibold transition ${replyFilter === "unreplied" ? "bg-red-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}
          >
            未返信{unrepliedCount > 0 && ` (${unrepliedCount})`}
          </button>
          <button
            onClick={() => setReplyFilter("replied")}
            className={`px-3 py-1.5 text-xs font-semibold transition ${replyFilter === "replied" ? "bg-emerald-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}
          >
            返信済み
          </button>
        </div>
      </div>

      {!apiConnected ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm mb-2">Go APIに接続し、店舗を登録すると口コミが表示されます</p>
        </div>
      ) : (!isAllMode && !selectedShopId) ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">店舗を選択するか、ヘッダーから「全店舗表示」を選択してください</p>
        </div>
      ) : loading ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">読み込み中...</p>
        </div>
      ) : reviews.length === 0 ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm mb-2">
            {replyFilter === "unreplied" ? "未返信の口コミはありません" : replyFilter === "replied" ? "返信済みの口コミはありません" : "口コミデータがありません"}
          </p>
          {replyFilter === "all" && <p className="text-slate-300 text-xs">「この店舗を同期」ボタンでGBPから口コミを取得してください</p>}
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {reviews.map((review) => (
              <div key={review.id} className={`bg-white rounded-xl p-5 shadow-sm border ${!review.reply_comment ? "border-amber-200" : "border-slate-100"}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-700">{review.reviewer_name}</span>
                    <span className="text-amber-400 text-sm">
                      {"★".repeat(starToNum(review.star_rating))}
                      {"☆".repeat(5 - starToNum(review.star_rating))}
                    </span>
                    {!review.reply_comment && (
                      <span className="text-[10px] font-semibold text-red-500 bg-red-50 px-1.5 py-0.5 rounded">未返信</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {/* 全店舗モード時に店舗名を表示 */}
                    {isAllMode && (
                      <span className="text-[10px] text-slate-400 bg-slate-50 px-2 py-0.5 rounded-full truncate max-w-[150px]">
                        {review.shop_name}
                      </span>
                    )}
                    <span className="text-xs text-slate-400">{new Date(review.create_time).toLocaleDateString("ja-JP")}</span>
                  </div>
                </div>
                {review.comment && <p className="text-sm text-slate-600 mb-3">{
                  review.comment.includes("(Original)")
                    ? (review.comment.split("(Original)").pop()?.trim() || review.comment)
                    : (review.comment.split(/\s*\(Translated by Google\)\s*/)[0] || review.comment)
                }</p>}
                {review.reply_comment && (
                  <div className="bg-blue-50 rounded-lg p-3 border border-blue-100 mb-2">
                    <p className="text-xs text-blue-500 font-semibold mb-1">返信済み</p>
                    <p className="text-sm text-blue-700">{review.reply_comment}</p>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleAiReply(review)}
                    disabled={aiLoading && aiReplyId === review.id}
                    className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition-all ${
                      aiReplyId === review.id ? "bg-purple-100 text-purple-700" : "bg-purple-50 text-purple-600 hover:bg-purple-100"
                    }`}
                  >
                    {aiLoading && aiReplyId === review.id ? "AI生成中..." : aiReplyId === review.id ? "閉じる" : "AI返信提案"}
                  </button>
                </div>
                {aiReplyId === review.id && aiReply && (
                  <div className="bg-purple-50 rounded-lg p-3 border border-purple-100 mt-2">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs text-purple-500 font-semibold">AI返信案</p>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => { navigator.clipboard.writeText(aiReply); }}
                          className="text-[10px] text-purple-500 hover:text-purple-700 px-2 py-0.5 rounded bg-white border border-purple-200"
                        >
                          コピー
                        </button>
                        {review.shop_id && !review.reply_comment && (
                          <button
                            onClick={async () => {
                              try {
                                await api.put(`/api/shop/${review.shop_id}/review/${review.review_id}/reply`, {
                                  comment: aiReply,
                                }, { timeout: 15000 });
                                setSyncMsg("GBPに返信を投稿しました！");
                                await fetchReviews();
                                await fetchUnrepliedCount();
                                setAiReplyId(null);
                                setAiReply("");
                              } catch (e: any) {
                                setSyncMsg(`返信投稿に失敗: ${e?.response?.data?.message || e?.message || "不明なエラー"}`);
                              }
                            }}
                            className="text-[10px] text-white px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 font-semibold"
                          >
                            GBPに返信
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="text-sm text-purple-800">{aiReply}</p>
                  </div>
                )}
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-6">
              <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1}
                className="px-3 py-1.5 rounded-lg text-xs border border-slate-200 disabled:opacity-30">← 前へ</button>
              <span className="text-xs text-slate-500">{page} / {totalPages}</span>
              <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages}
                className="px-3 py-1.5 rounded-lg text-xs border border-slate-200 disabled:opacity-30">次へ →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
