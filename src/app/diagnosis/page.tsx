"use client";

import { useState, useEffect, useCallback } from "react";
import { useShop } from "@/components/shop-provider";
import api from "@/lib/api";

interface DiagnosisItem {
  label: string;
  status: "good" | "warning" | "danger";
  detail: string;
}

interface Competitor {
  name: string;
  address: string;
  rating: number;
  reviewCount: number;
  mapsUrl: string;
  type: string;
}

export default function DiagnosisPage() {
  const { selectedShopId, selectedShop, apiConnected } = useShop();
  const [items, setItems] = useState<DiagnosisItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [myShopData, setMyShopData] = useState<Competitor | null>(null);
  const [compLoading, setCompLoading] = useState(false);
  const [compQuery, setCompQuery] = useState("");

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
          detail: `${reviewCount}件（評価 ${Number(avgRating).toFixed(1)}）`,
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
        <>
          {/* 診断スコア */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
              <p className="text-[11px] font-medium text-slate-400 mb-1">診断スコア</p>
              <div className="flex items-end gap-1">
                <span className={`text-4xl font-bold ${
                  items.length > 0 ? (items.filter(i => i.status === "good").length / items.length >= 0.7 ? "text-emerald-600" : items.filter(i => i.status === "good").length / items.length >= 0.4 ? "text-amber-600" : "text-red-600") : "text-slate-400"
                }`}>{items.length > 0 ? Math.round((items.filter(i => i.status === "good").length / items.length) * 100) : 0}</span>
                <span className="text-lg text-slate-400 mb-1">%</span>
              </div>
            </div>
            <div className="bg-emerald-50 rounded-xl p-5 shadow-sm border border-emerald-100">
              <p className="text-[11px] font-medium text-emerald-500 mb-1">良好</p>
              <p className="text-2xl font-bold text-emerald-600">{items.filter(i => i.status === "good").length}</p>
            </div>
            <div className="bg-amber-50 rounded-xl p-5 shadow-sm border border-amber-100">
              <p className="text-[11px] font-medium text-amber-500 mb-1">注意</p>
              <p className="text-2xl font-bold text-amber-600">{items.filter(i => i.status === "warning").length}</p>
            </div>
            <div className="bg-red-50 rounded-xl p-5 shadow-sm border border-red-100">
              <p className="text-[11px] font-medium text-red-500 mb-1">要改善</p>
              <p className="text-2xl font-bold text-red-600">{items.filter(i => i.status === "danger").length}</p>
            </div>
          </div>

          {/* チェックリスト */}
          <div className="space-y-3 mb-6">
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

          {/* 競合分析セクション */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-500">周辺競合分析</h3>
                <p className="text-[10px] text-slate-400 mt-0.5">半径2km以内の同業種店舗と比較</p>
              </div>
              <button onClick={async () => {
                setCompLoading(true);
                try {
                  const token = (await (await import("@/lib/supabase")).supabase.auth.getSession()).data.session?.access_token;
                  const res = await fetch("/api/report/competitors", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
                    body: JSON.stringify({ shopId: selectedShopId }),
                  });
                  const data = await res.json();
                  if (data.error) throw new Error(data.error);
                  setCompetitors(data.competitors || []);
                  setMyShopData(data.myShop || null);
                  setCompQuery(data.searchQuery || "");
                } catch (e: any) {
                  setCompetitors([]);
                  setMyShopData(null);
                }
                setCompLoading(false);
              }} disabled={compLoading}
                className={`px-4 py-2 rounded-lg text-xs font-semibold ${compLoading ? "bg-slate-200 text-slate-400" : "bg-[#003D6B] hover:bg-[#002a4a]"}`}
                style={{ color: compLoading ? undefined : "#fff" }}>
                {compLoading ? "分析中..." : "競合を分析"}
              </button>
            </div>

            {competitors.length > 0 && (
              <>
                {compQuery && <p className="text-[10px] text-slate-400 mb-3">検索ワード: 「{compQuery}」</p>}

                {/* 自店 vs 競合平均の比較 */}
                {myShopData && (
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                      <p className="text-[10px] text-blue-500 font-semibold mb-1">自店</p>
                      <p className="text-sm font-bold text-blue-700">{myShopData.name}</p>
                      <div className="flex items-center gap-3 mt-2">
                        <span className="text-amber-500 text-lg font-bold">★ {myShopData.rating.toFixed(1)}</span>
                        <span className="text-xs text-slate-500">({myShopData.reviewCount}件)</span>
                      </div>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                      <p className="text-[10px] text-slate-500 font-semibold mb-1">競合平均</p>
                      <p className="text-sm font-bold text-slate-700">{competitors.length}店舗</p>
                      <div className="flex items-center gap-3 mt-2">
                        <span className="text-amber-500 text-lg font-bold">★ {(competitors.reduce((a, c) => a + c.rating, 0) / competitors.length).toFixed(1)}</span>
                        <span className="text-xs text-slate-500">({Math.round(competitors.reduce((a, c) => a + c.reviewCount, 0) / competitors.length)}件)</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* 競合一覧テーブル */}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200">
                        <th className="text-left py-2 px-2 text-slate-500 font-medium">順位</th>
                        <th className="text-left py-2 px-2 text-slate-500 font-medium">店舗名</th>
                        <th className="text-right py-2 px-2 text-slate-500 font-medium">評価</th>
                        <th className="text-right py-2 px-2 text-slate-500 font-medium">口コミ数</th>
                        <th className="text-left py-2 px-2 text-slate-500 font-medium">業種</th>
                      </tr>
                    </thead>
                    <tbody>
                      {competitors.sort((a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount).map((comp, i) => (
                        <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                          <td className="py-2 px-2 text-slate-500">{i + 1}</td>
                          <td className="py-2 px-2">
                            {comp.mapsUrl ? (
                              <a href={comp.mapsUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-medium">{comp.name}</a>
                            ) : (
                              <span className="font-medium text-slate-700">{comp.name}</span>
                            )}
                            <p className="text-[10px] text-slate-400 truncate max-w-[200px]">{comp.address}</p>
                          </td>
                          <td className="py-2 px-2 text-right">
                            <span className={`font-bold ${comp.rating >= 4.5 ? "text-emerald-600" : comp.rating >= 4.0 ? "text-blue-600" : comp.rating >= 3.5 ? "text-amber-600" : "text-red-600"}`}>
                              ★ {comp.rating.toFixed(1)}
                            </span>
                          </td>
                          <td className="py-2 px-2 text-right text-slate-700">{comp.reviewCount.toLocaleString()}</td>
                          <td className="py-2 px-2 text-slate-500">{comp.type}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {!compLoading && competitors.length === 0 && (
              <p className="text-xs text-slate-400 text-center py-4">「競合を分析」ボタンを押すと、周辺の同業種店舗を検索します</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
