"use client";

import { useState, useEffect, useCallback } from "react";
import { useShop } from "@/components/shop-provider";
import api from "@/lib/api";

interface DiagnosisItem {
  label: string;
  status: "good" | "warning" | "danger";
  detail: string;
}

export default function DiagnosisPage() {
  const { selectedShopId, selectedShop, apiConnected } = useShop();
  const [items, setItems] = useState<DiagnosisItem[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchDiagnosis = useCallback(async () => {
    if (!selectedShopId) return;
    setLoading(true);
    const results: DiagnosisItem[] = [];

    try {
      // 店舗詳細
      const shopRes = await api.get(`/api/shop/${selectedShopId}`);
      const shop = shopRes.data;

      // GBP接続
      results.push({
        label: "GBP接続",
        status: shop.gbp_location_name ? "good" : "danger",
        detail: shop.gbp_location_name ? "Googleビジネスプロフィールに接続済み" : "GBPロケーションが未接続です",
      });

      // 口コミ
      try {
        const reviewRes = await api.get(`/api/shop/${selectedShopId}/review`);
        const reviewCount = reviewRes.data?.totalReviewCount || 0;
        const avgRating = reviewRes.data?.averageRating || 0;
        results.push({
          label: "口コミ数",
          status: reviewCount >= 50 ? "good" : reviewCount >= 10 ? "warning" : "danger",
          detail: `${reviewCount}件（評価 ${avgRating}）`,
        });
      } catch {
        results.push({ label: "口コミ", status: "warning", detail: "口コミデータを取得できませんでした" });
      }

      // 投稿
      try {
        const postRes = await api.get(`/api/shop/${selectedShopId}/local_post`);
        const posts = Array.isArray(postRes.data?.localPosts) ? postRes.data.localPosts : [];
        results.push({
          label: "GBP投稿",
          status: posts.length >= 4 ? "good" : posts.length >= 1 ? "warning" : "danger",
          detail: `直近の投稿: ${posts.length}件`,
        });
      } catch {
        results.push({ label: "GBP投稿", status: "warning", detail: "投稿データを取得できませんでした" });
      }

    } catch {
      results.push({ label: "店舗情報", status: "danger", detail: "店舗データの取得に失敗しました" });
    }

    setItems(results);
    setLoading(false);
  }, [selectedShopId]);

  useEffect(() => { fetchDiagnosis(); }, [fetchDiagnosis]);

  const statusColor = (s: string) =>
    s === "good" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
    s === "warning" ? "bg-amber-50 text-amber-700 border-amber-200" :
    "bg-red-50 text-red-700 border-red-200";

  const statusIcon = (s: string) => s === "good" ? "✓" : s === "warning" ? "△" : "✕";

  return (
    <div className="animate-fade-in">
      <h1 className="text-2xl font-bold text-slate-800 mb-2">店舗診断</h1>
      <p className="text-sm text-slate-500 mb-6">GBPの基本情報、口コミ、投稿状況を自動診断します</p>

      {!apiConnected || !selectedShopId ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">{apiConnected ? "店舗を選択してください" : "Go APIに接続し、店舗を登録すると診断結果が表示されます"}</p>
        </div>
      ) : loading ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">診断中...</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item, i) => (
            <div key={i} className={`rounded-xl p-4 border ${statusColor(item.status)} flex items-center gap-4`}>
              <span className="text-lg font-bold w-8 text-center">{statusIcon(item.status)}</span>
              <div>
                <p className="text-sm font-semibold">{item.label}</p>
                <p className="text-xs mt-0.5 opacity-80">{item.detail}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
