"use client";

import { useState, useEffect, useCallback } from "react";
import { useShop } from "@/components/shop-provider";
import api from "@/lib/api";

interface Review {
  reviewId: string;
  reviewer: { displayName: string };
  starRating: string;
  comment: string;
  createTime: string;
  reviewReply?: { comment: string };
}

export default function ReviewsPage() {
  const { selectedShopId, apiConnected } = useShop();
  const [reviews, setReviews] = useState<Review[]>([]);

  const fetchReviews = useCallback(async () => {
    if (!selectedShopId) return;
    try {
      const res = await api.get(`/api/shop/${selectedShopId}/review`);
      setReviews(res.data?.reviews || []);
    } catch {
      setReviews([]);
    }
  }, [selectedShopId]);

  useEffect(() => { fetchReviews(); }, [fetchReviews]);

  const starToNum = (s: string) => {
    const map: Record<string, number> = { ONE_STAR: 1, TWO_STARS: 2, THREE_STARS: 3, FOUR_STARS: 4, FIVE_STARS: 5 };
    return map[s] || 0;
  };

  return (
    <div className="animate-fade-in">
      <h1 className="text-2xl font-bold text-slate-800 mb-2">口コミ管理</h1>
      <p className="text-sm text-slate-500 mb-6">口コミ一覧・返信・分析</p>

      {!apiConnected ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm mb-2">Go APIに接続し、店舗を登録すると口コミが表示されます</p>
          <p className="text-slate-300 text-xs">GBPの口コミ取得・AI返信候補・感情分析</p>
        </div>
      ) : reviews.length === 0 ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">口コミデータがありません。店舗を選択してください。</p>
        </div>
      ) : (
        <div className="space-y-4">
          {reviews.map((review) => (
            <div key={review.reviewId} className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-700">{review.reviewer.displayName}</span>
                  <span className="text-amber-400 text-sm">{"★".repeat(starToNum(review.starRating))}{"☆".repeat(5 - starToNum(review.starRating))}</span>
                </div>
                <span className="text-xs text-slate-400">{new Date(review.createTime).toLocaleDateString("ja-JP")}</span>
              </div>
              {review.comment && <p className="text-sm text-slate-600 mb-3">{review.comment}</p>}
              {review.reviewReply?.comment && (
                <div className="bg-blue-50 rounded-lg p-3 border border-blue-100">
                  <p className="text-xs text-blue-500 font-semibold mb-1">返信済み</p>
                  <p className="text-sm text-blue-700">{review.reviewReply.comment}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
