"use client";

import { useState, useEffect, useCallback } from "react";
import { useShop } from "@/components/shop-provider";
import { supabase } from "@/lib/supabase";
import api from "@/lib/api";
import KpiCard from "@/components/kpi-card";

interface PerformanceLog {
  id: string;
  from: string;
  to: string;
  mobile_search_impressions: number | null;
  pc_search_impressions: number | null;
  mobile_map_impressions: number | null;
  pc_map_impressions: number | null;
  website_clicks: number | null;
  direction_requests: number | null;
  call_clicks: number | null;
  bookings: number | null;
  food_menu_clicks: number | null;
  total_reviews: number | null;
  average_reviews: number | null;
}

export default function Dashboard() {
  const { shops, selectedShop, selectedShopId, apiConnected } = useShop();
  const storeName = selectedShop?.name || "未選択";
  const shopCount = shops.length;
  const [perf, setPerf] = useState<PerformanceLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [badAlerts, setBadAlerts] = useState<any[]>([]);
  const [topPhotos, setTopPhotos] = useState<any[]>([]);

  const fetchPerformance = useCallback(async () => {
    if (!selectedShopId) return;
    setLoading(true);
    try {
      const res = await api.get(`/api/performance/${selectedShopId}`);
      const data = Array.isArray(res.data) ? res.data : [];
      // 日付順ソート
      data.sort((a: PerformanceLog, b: PerformanceLog) => new Date(a.from).getTime() - new Date(b.from).getTime());
      setPerf(data);
    } catch { setPerf([]); }
    finally { setLoading(false); }
  }, [selectedShopId]);

  useEffect(() => { fetchPerformance(); }, [fetchPerformance]);

  // 悪い口コミアラート取得（選択中の店舗でフィルタ、なければ全店舗）
  useEffect(() => {
    let query = supabase
      .from("bad_review_alerts")
      .select("*")
      .eq("confirmed", false)
      .order("created_at", { ascending: false })
      .limit(5);
    if (selectedShopId) query = query.eq("shop_id", selectedShopId);
    query.then(({ data }) => setBadAlerts(data || []));
    // 写真TOP5
    supabase
      .from("media")
      .select("shop_name, google_url, thumbnail_url, category, view_count")
      .order("view_count", { ascending: false })
      .limit(5)
      .then(({ data }) => setTopPhotos(data || []));
  }, [selectedShopId]);

  const v = (n: number | null | undefined) => n ?? 0;
  const latest = perf.length > 0 ? perf[perf.length - 1] : null;
  const prev = perf.length > 1 ? perf[perf.length - 2] : null;

  const searchTotal = latest ? v(latest.mobile_search_impressions) + v(latest.pc_search_impressions) : 0;
  const searchPrev = prev ? v(prev.mobile_search_impressions) + v(prev.pc_search_impressions) : 0;
  const mapTotal = latest ? v(latest.mobile_map_impressions) + v(latest.pc_map_impressions) : 0;
  const mapPrev = prev ? v(prev.mobile_map_impressions) + v(prev.pc_map_impressions) : 0;
  const pct = (cur: number, pre: number) => pre > 0 ? Math.round(((cur - pre) / pre) * 100) : 0;

  return (
    <div className="animate-fade-in">
      {!apiConnected && (
        <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-blue-700 text-sm font-medium">Go APIに接続し、店舗を登録するとデータが表示されます</p>
          <p className="text-blue-500 text-xs mt-1">店舗情報管理 → 店舗一覧 から店舗を登録してください</p>
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">ダッシュボード</h1>
          <p className="text-sm text-slate-500 mt-1">{storeName} — 管理店舗数: {shopCount}</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        <KpiCard label="検索表示回数" value={searchTotal} change={pct(searchTotal, searchPrev)} icon="👁️" />
        <KpiCard label="マップ表示回数" value={mapTotal} change={pct(mapTotal, mapPrev)} icon="🗺️" />
        <KpiCard label="電話タップ" value={latest ? v(latest.call_clicks) : 0} change={pct(v(latest?.call_clicks), v(prev?.call_clicks))} icon="📞" />
        <KpiCard label="経路検索" value={latest ? v(latest.direction_requests) : 0} change={pct(v(latest?.direction_requests), v(prev?.direction_requests))} icon="📍" />
        <KpiCard label="Webサイトクリック" value={latest ? v(latest.website_clicks) : 0} change={pct(v(latest?.website_clicks), v(prev?.website_clicks))} icon="🌐" />
        <KpiCard label="口コミ数" value={latest ? v(latest.total_reviews) : 0} change={0} icon="⭐" />
      </div>

      {/* パフォーマンス推移 */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
          <h3 className="text-sm font-semibold text-slate-500 mb-4">月次パフォーマンス推移</h3>
          {loading ? (
            <div className="flex items-center justify-center h-[200px] text-slate-400 text-sm">読み込み中...</div>
          ) : perf.length === 0 ? (
            <div className="flex items-center justify-center h-[200px] text-slate-300 text-sm">
              {apiConnected ? "パフォーマンスデータがありません。「店舗パフォーマンス」から計測を開始してください。" : "店舗を登録するとデータが表示されます"}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-2 px-2 text-slate-500 font-medium">月</th>
                    <th className="text-right py-2 px-2 text-slate-500 font-medium">検索</th>
                    <th className="text-right py-2 px-2 text-slate-500 font-medium">マップ</th>
                    <th className="text-right py-2 px-2 text-slate-500 font-medium">通話</th>
                    <th className="text-right py-2 px-2 text-slate-500 font-medium">ルート</th>
                    <th className="text-right py-2 px-2 text-slate-500 font-medium">Web</th>
                  </tr>
                </thead>
                <tbody>
                  {perf.slice(-6).map((p, i) => {
                    const d = new Date(p.from);
                    return (
                      <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="py-2 px-2 text-slate-600">{d.getFullYear()}/{d.getMonth() + 1}</td>
                        <td className="py-2 px-2 text-right text-slate-700 font-medium">{(v(p.mobile_search_impressions) + v(p.pc_search_impressions)).toLocaleString()}</td>
                        <td className="py-2 px-2 text-right text-slate-700 font-medium">{(v(p.mobile_map_impressions) + v(p.pc_map_impressions)).toLocaleString()}</td>
                        <td className="py-2 px-2 text-right text-slate-700">{v(p.call_clicks).toLocaleString()}</td>
                        <td className="py-2 px-2 text-right text-slate-700">{v(p.direction_requests).toLocaleString()}</td>
                        <td className="py-2 px-2 text-right text-slate-700">{v(p.website_clicks).toLocaleString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
          <h3 className="text-sm font-semibold text-slate-500 mb-4">店舗情報</h3>
          {selectedShop ? (
            <div className="space-y-3">
              <div className="flex justify-between py-2 border-b border-slate-50">
                <span className="text-sm text-slate-500">店舗名</span>
                <span className="text-sm font-medium text-slate-800">{selectedShop.name}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-50">
                <span className="text-sm text-slate-500">GBP接続</span>
                <span className={`text-sm font-medium ${selectedShop.gbp_location_name ? "text-emerald-600" : "text-slate-400"}`}>
                  {selectedShop.gbp_location_name ? "● 接続済" : "○ 未接続"}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-slate-50">
                <span className="text-sm text-slate-500">評価</span>
                <span className="text-sm font-medium text-amber-500">{latest?.average_reviews ? `★ ${latest.average_reviews}` : "-"}</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-sm text-slate-500">口コミ数</span>
                <span className="text-sm font-medium text-slate-800">{latest?.total_reviews ? `${latest.total_reviews}件` : "-"}</span>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-[200px] text-slate-300 text-sm">店舗を選択してください</div>
          )}
        </div>
      </div>

      {/* 要注意口コミアラート */}
      {badAlerts.length > 0 && (
        <div className="bg-white rounded-xl p-6 shadow-sm border border-red-200 mt-6">
          <h3 className="text-sm font-semibold text-red-600 mb-4">⚠ 要注意口コミ（★3以下）— {badAlerts.length}件</h3>
          <div className="space-y-3">
            {badAlerts.map((alert: any) => {
              const stars = { ONE_STAR: 1, TWO_STARS: 2, THREE_STARS: 3 }[alert.star_rating as string] || 0;
              return (
                <div key={alert.id} className="border border-red-100 rounded-lg p-3 bg-red-50/50">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-700">{alert.shop_name}</span>
                      <span className="text-amber-400 text-xs">{"★".repeat(stars)}{"☆".repeat(5 - stars)}</span>
                      <span className="text-xs text-slate-500">{alert.reviewer_name}</span>
                    </div>
                    <span className="text-xs text-slate-400">{new Date(alert.created_at).toLocaleDateString("ja-JP")}</span>
                  </div>
                  {alert.comment && <p className="text-xs text-slate-600 line-clamp-2">{
                    alert.comment.includes("(Original)")
                      ? alert.comment.split("(Original)").pop()?.trim()
                      : alert.comment.split(/\s*\(Translated by Google\)\s*/)[0] || alert.comment
                  }</p>}
                  {alert.reply_comment && (
                    <div className="mt-1.5 bg-blue-50 rounded p-2 border border-blue-100">
                      <p className="text-[10px] text-blue-500 font-semibold mb-0.5">返信済み</p>
                      <p className="text-xs text-blue-700 line-clamp-2">{alert.reply_comment}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {/* 写真パフォーマンスTOP5 */}
      {topPhotos.length > 0 && (
        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 mt-6">
          <h3 className="text-sm font-semibold text-slate-500 mb-4">写真パフォーマンス TOP5（閲覧数）</h3>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            {topPhotos.map((photo: any, i: number) => (
              <div key={i} className="text-center">
                {photo.thumbnail_url ? (
                  <img src={photo.thumbnail_url} alt="" className="w-full h-24 object-cover rounded-lg mb-2" />
                ) : (
                  <div className="w-full h-24 bg-slate-100 rounded-lg mb-2 flex items-center justify-center text-slate-300 text-xs">No image</div>
                )}
                <p className="text-lg font-bold text-[#003D6B]">{(photo.view_count || 0).toLocaleString()}</p>
                <p className="text-[10px] text-slate-400">{photo.shop_name}</p>
                <p className="text-[10px] text-slate-300">{photo.category}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
