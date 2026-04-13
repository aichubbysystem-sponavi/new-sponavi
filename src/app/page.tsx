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
  const { shops, selectedShop, selectedShopId, apiConnected, unrepliedCount } = useShop();
  const storeName = selectedShop?.name || "未選択";
  const shopCount = shops.length;
  const [perf, setPerf] = useState<PerformanceLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [badAlerts, setBadAlerts] = useState<any[]>([]);
  const [topPhotos, setTopPhotos] = useState<any[]>([]);
  const [rankingSummary, setRankingSummary] = useState<any[]>([]);
  const [postCount, setPostCount] = useState(0);
  const [perfDateSort, setPerfDateSort] = useState<"desc" | "asc">("asc");
  // 売上予測設定
  const [showForecastSetting, setShowForecastSetting] = useState(false);
  const [forecastSetting, setForecastSetting] = useState({ unitPrice: "3000", visitRate: "5", phoneRate: "30", routeRate: "20" });
  const [forecastSaving, setForecastSaving] = useState(false);
  const [forecastMsg, setForecastMsg] = useState("");
  const [churnData, setChurnData] = useState<{ summary?: { high: number; warning: number; stable: number }; scores?: any[] } | null>(null);
  const [googleUpdates, setGoogleUpdates] = useState<{ title: string; link: string; published: string }[]>([]);
  const [lineAlerts, setLineAlerts] = useState<any[]>([]);

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

  // 売上予測設定の読み込み
  useEffect(() => {
    if (!selectedShopId) return;
    const saved = localStorage.getItem(`forecast-${selectedShopId}`);
    if (saved) {
      try { setForecastSetting(JSON.parse(saved)); } catch {}
    }
  }, [selectedShopId]);

  const saveForecastSetting = async () => {
    if (!selectedShopId) return;
    setForecastSaving(true);
    try {
      localStorage.setItem(`forecast-${selectedShopId}`, JSON.stringify(forecastSetting));
      // Go APIにも保存を試みる
      try {
        await api.put(`/api/shop/${selectedShopId}/sales_forecast_setting`, {
          unit_price: parseInt(forecastSetting.unitPrice) || 3000,
          visit_rate: parseInt(forecastSetting.visitRate) || 5,
          phone_cvr: parseInt(forecastSetting.phoneRate) || 30,
          route_cvr: parseInt(forecastSetting.routeRate) || 20,
        });
      } catch {} // Go APIがなくてもlocalStorageで動作
      setForecastMsg("設定を保存しました");
    } catch {
      setForecastMsg("保存に失敗しました");
    }
    setForecastSaving(false);
  };

  // LINEアラート取得
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.from("line_alerts").select("*").eq("resolved", false)
          .order("created_at", { ascending: false }).limit(5);
        setLineAlerts(data || []);
      } catch {}
    })();
  }, []);

  // Googleアップデート通知取得
  useEffect(() => {
    fetch("/api/report/google-updates").then(r => r.ok ? r.json() : { updates: [] })
      .then(d => setGoogleUpdates(d.updates || [])).catch(() => {});
  }, []);

  // 解約予兆スコア取得
  useEffect(() => {
    if (!apiConnected) return;
    (async () => {
      try {
        const token = (await supabase.auth.getSession()).data.session?.access_token;
        const res = await fetch("/api/report/churn-score", { headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) setChurnData(await res.json());
      } catch {}
    })();
  }, [apiConnected]);

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
    // 写真TOP5（選択店舗でフィルタ）
    let mediaQuery = supabase
      .from("media")
      .select("shop_name, google_url, thumbnail_url, category, view_count")
      .order("view_count", { ascending: false })
      .limit(5);
    if (selectedShopId) mediaQuery = mediaQuery.eq("shop_id", selectedShopId);
    mediaQuery.then(({ data }) => setTopPhotos(data || []));

    // 順位サマリー取得
    if (selectedShopId) {
      supabase
        .from("ranking_search_logs")
        .select("search_words, rank, searched_at")
        .eq("shop_id", selectedShopId)
        .eq("is_display", true)
        .order("searched_at", { ascending: false })
        .limit(50)
        .then(({ data }) => {
          if (!data || data.length === 0) { setRankingSummary([]); return; }
          const groups = new Map<string, { rank: number; prevRank: number }>();
          for (const log of data) {
            let kw: string;
            try { kw = JSON.parse(log.search_words).join(", "); } catch { kw = log.search_words; }
            if (!groups.has(kw)) groups.set(kw, { rank: log.rank, prevRank: 0 });
            else if (groups.get(kw)!.prevRank === 0) groups.get(kw)!.prevRank = log.rank;
          }
          setRankingSummary(Array.from(groups.entries()).slice(0, 5).map(([kw, d]) => ({
            keyword: kw, rank: d.rank, prevRank: d.prevRank || d.rank,
          })));
        });

      // 投稿数取得
      api.get(`/api/shop/${selectedShopId}/local_post`).then((res) => {
        const posts = res.data?.localPosts || [];
        const last30 = posts.filter((p: any) => p.createTime && Date.now() - new Date(p.createTime).getTime() < 30 * 24 * 60 * 60 * 1000);
        setPostCount(last30.length);
      }).catch(() => setPostCount(0));
    }
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

      {/* 未返信口コミアラート */}
      {unrepliedCount > 0 && (
        <div className="bg-red-50 rounded-xl p-4 shadow-sm border border-red-200 mb-6 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-red-600">未返信の口コミが {unrepliedCount.toLocaleString()} 件あります</p>
            <p className="text-[10px] text-red-400 mt-0.5">口コミ管理ページから返信できます</p>
          </div>
          <a href="/reviews" className="px-4 py-2 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-700 transition" style={{ color: "#fff" }}>
            口コミ管理へ
          </a>
        </div>
      )}

      {/* パフォーマンス推移 */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-500">月次パフォーマンス推移</h3>
            <button onClick={() => setPerfDateSort(perfDateSort === "asc" ? "desc" : "asc")}
              className="px-3 py-1 rounded-lg text-[11px] font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition">
              {perfDateSort === "asc" ? "古い順 ↑" : "新しい順 ↓"}
            </button>
          </div>
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
                  {[...perf].sort((a, b) => {
                    const ta = new Date(a.from).getTime();
                    const tb = new Date(b.from).getTime();
                    return perfDateSort === "asc" ? ta - tb : tb - ta;
                  }).slice(0, 6).map((p, i) => {
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

      {/* 順位サマリー＋投稿頻度 */}
      {(rankingSummary.length > 0 || postCount > 0) && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mt-6">
          {rankingSummary.length > 0 && (
            <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
              <h3 className="text-sm font-semibold text-slate-500 mb-4">キーワード順位（最新）</h3>
              <div className="space-y-2">
                {rankingSummary.map((r: any, i: number) => {
                  const diff = r.prevRank - r.rank;
                  return (
                    <div key={i} className="flex items-center justify-between py-1.5 border-b border-slate-50">
                      <span className="text-sm text-slate-700 truncate flex-1">{r.keyword}</span>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {diff !== 0 && (
                          <span className={`text-xs font-semibold ${diff > 0 ? "text-emerald-600" : "text-red-600"}`}>
                            {diff > 0 ? `↑${diff}` : `↓${Math.abs(diff)}`}
                          </span>
                        )}
                        <span className={`text-lg font-bold ${
                          r.rank <= 3 ? "text-emerald-600" : r.rank <= 10 ? "text-blue-600" : r.rank <= 20 ? "text-amber-600" : r.rank > 0 ? "text-orange-600" : "text-slate-400"
                        }`}>
                          {r.rank > 0 ? `${r.rank}位` : "圏外"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
            <h3 className="text-sm font-semibold text-slate-500 mb-4">投稿頻度</h3>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <p className="text-3xl font-bold text-[#003D6B]">{postCount}<span className="text-sm font-normal text-slate-400 ml-1">件 / 30日</span></p>
                <p className={`text-sm font-semibold mt-1 ${postCount >= 8 ? "text-emerald-600" : postCount >= 4 ? "text-blue-600" : postCount >= 1 ? "text-amber-600" : "text-red-600"}`}>
                  {postCount >= 8 ? "優秀" : postCount >= 4 ? "良好" : postCount >= 1 ? "改善余地あり" : "要改善"}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">推奨: 週2回以上（月8件）</p>
              </div>
              <div className="w-20 h-20 rounded-full border-4 flex items-center justify-center" style={{
                borderColor: postCount >= 8 ? "#059669" : postCount >= 4 ? "#2563eb" : postCount >= 1 ? "#d97706" : "#dc2626",
              }}>
                <span className="text-lg font-bold" style={{
                  color: postCount >= 8 ? "#059669" : postCount >= 4 ? "#2563eb" : postCount >= 1 ? "#d97706" : "#dc2626",
                }}>{Math.min(Math.round((postCount / 8) * 100), 100)}%</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* コンバージョンファネル + ROI */}
      {latest && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mt-6">
          {/* ファネル分析 */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
            <h3 className="text-sm font-semibold text-slate-500 mb-4">コンバージョンファネル</h3>
            {(() => {
              const steps = [
                { label: "検索表示", value: searchTotal, color: "bg-blue-400" },
                { label: "マップ表示", value: mapTotal, color: "bg-emerald-400" },
                { label: "Webクリック", value: v(latest.website_clicks), color: "bg-amber-400" },
                { label: "電話タップ", value: v(latest.call_clicks), color: "bg-purple-400" },
                { label: "経路検索", value: v(latest.direction_requests), color: "bg-red-400" },
              ];
              const maxVal = Math.max(...steps.map((s) => s.value), 1);
              return (
                <div className="space-y-3">
                  {steps.map((step, i) => {
                    const prevStep = i > 0 ? steps[i - 1].value : 0;
                    const rate = prevStep > 0 ? ((step.value / prevStep) * 100).toFixed(1) : "";
                    return (
                      <div key={i}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-slate-600">{step.label}</span>
                          <div className="flex items-center gap-2">
                            {rate && <span className="text-[10px] text-slate-400">転換率 {rate}%</span>}
                            <span className="text-sm font-bold text-slate-800">{step.value.toLocaleString()}</span>
                          </div>
                        </div>
                        <div className="w-full h-6 bg-slate-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${step.color}`}
                            style={{ width: `${Math.max((step.value / maxVal) * 100, 2)}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>

          {/* ROI算出 */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
            <h3 className="text-sm font-semibold text-slate-500 mb-4">推定ROI（売上貢献）</h3>
            {(() => {
              const shop = selectedShop as any;
              const callRate = (parseInt(forecastSetting.phoneRate) || 30) / 100;
              const routeRate = (parseInt(forecastSetting.routeRate) || 20) / 100;
              const webRate = shop?.website_click_rate || 0.1;
              const avgSpend = parseInt(forecastSetting.unitPrice) || 3000;
              const groupSize = shop?.customers_per_group || 1.5;

              const callVisits = Math.round(v(latest.call_clicks) * callRate);
              const routeVisits = Math.round(v(latest.direction_requests) * routeRate);
              const webVisits = Math.round(v(latest.website_clicks) * webRate);
              const totalVisits = callVisits + routeVisits + webVisits;
              const revenue = Math.round(totalVisits * avgSpend * groupSize);

              // 前月比較
              const prevCallVisits = prev ? Math.round(v(prev.call_clicks) * callRate) : 0;
              const prevRouteVisits = prev ? Math.round(v(prev.direction_requests) * routeRate) : 0;
              const prevWebVisits = prev ? Math.round(v(prev.website_clicks) * webRate) : 0;
              const prevTotalVisits = prevCallVisits + prevRouteVisits + prevWebVisits;
              const prevRevenue = Math.round(prevTotalVisits * avgSpend * groupSize);
              const revDiff = prevRevenue > 0 ? Math.round(((revenue - prevRevenue) / prevRevenue) * 100) : 0;

              return (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-purple-50 rounded-lg p-3 text-center">
                      <p className="text-[10px] text-purple-500">電話経由</p>
                      <p className="text-lg font-bold text-purple-600">{callVisits}<span className="text-[10px] font-normal">人</span></p>
                    </div>
                    <div className="bg-red-50 rounded-lg p-3 text-center">
                      <p className="text-[10px] text-red-500">経路経由</p>
                      <p className="text-lg font-bold text-red-600">{routeVisits}<span className="text-[10px] font-normal">人</span></p>
                    </div>
                    <div className="bg-amber-50 rounded-lg p-3 text-center">
                      <p className="text-[10px] text-amber-500">Web経由</p>
                      <p className="text-lg font-bold text-amber-600">{webVisits}<span className="text-[10px] font-normal">人</span></p>
                    </div>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-4">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm text-slate-600">推定来店数</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xl font-bold text-[#003D6B]">{totalVisits.toLocaleString()}<span className="text-xs font-normal text-slate-400">人/月</span></span>
                        {prevTotalVisits > 0 && (
                          <span className={`text-[10px] font-semibold ${totalVisits >= prevTotalVisits ? "text-emerald-600" : "text-red-600"}`}>
                            {totalVisits >= prevTotalVisits ? "↑" : "↓"}{Math.abs(totalVisits - prevTotalVisits)}人
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm text-slate-600">推定売上貢献</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xl font-bold text-emerald-600">¥{revenue.toLocaleString()}<span className="text-xs font-normal text-slate-400">/月</span></span>
                        {revDiff !== 0 && (
                          <span className={`text-[10px] font-semibold ${revDiff >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                            {revDiff >= 0 ? "+" : ""}{revDiff}%
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-slate-600">年間推定売上</span>
                      <span className="text-lg font-bold text-[#003D6B]">¥{(revenue * 12).toLocaleString()}<span className="text-xs font-normal text-slate-400">/年</span></span>
                    </div>
                  </div>
                  <p className="text-[9px] text-slate-400">※ 来店率: 電話{(callRate*100).toFixed(0)}% / 経路{(routeRate*100).toFixed(0)}% / Web{(webRate*100).toFixed(0)}%、客単価¥{avgSpend.toLocaleString()}×{groupSize}人で算出。顧客マスタで変更可能。</p>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* 売上予測データ設定 */}
      {selectedShopId && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 mt-6">
          <button onClick={() => setShowForecastSetting(!showForecastSetting)}
            className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition">
            <span className="text-sm font-semibold text-slate-500">売上予測データ設定</span>
            <span className="text-xs text-slate-400">{showForecastSetting ? "▲ 閉じる" : "▼ 開く"}</span>
          </button>
          {showForecastSetting && (
            <div className="px-5 pb-5 border-t border-slate-100">
              <p className="text-[10px] text-slate-400 mt-3 mb-3">ROI算出・売上予測で使用するパラメータを店舗ごとに設定します。</p>
              {forecastMsg && <div className="p-2 rounded-lg mb-3 text-xs bg-emerald-50 text-emerald-600">{forecastMsg}</div>}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="text-[10px] text-slate-500 block mb-1">客単価（円）</label>
                  <input type="number" value={forecastSetting.unitPrice}
                    onChange={(e) => setForecastSetting({ ...forecastSetting, unitPrice: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 block mb-1">来店率（%）</label>
                  <input type="number" value={forecastSetting.visitRate}
                    onChange={(e) => setForecastSetting({ ...forecastSetting, visitRate: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 block mb-1">電話CVR（%）</label>
                  <input type="number" value={forecastSetting.phoneRate}
                    onChange={(e) => setForecastSetting({ ...forecastSetting, phoneRate: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 block mb-1">経路CVR（%）</label>
                  <input type="number" value={forecastSetting.routeRate}
                    onChange={(e) => setForecastSetting({ ...forecastSetting, routeRate: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                </div>
              </div>
              <button onClick={saveForecastSetting} disabled={forecastSaving}
                className="mt-3 px-4 py-2 rounded-lg text-xs font-semibold bg-[#003D6B] text-white hover:bg-[#002a4a] disabled:opacity-50">
                {forecastSaving ? "保存中..." : "設定を保存"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* 売上予測 */}
      {perf.length >= 3 && (
        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 mt-6">
          <h3 className="text-sm font-semibold text-slate-500 mb-4">売上予測（3ヶ月）</h3>
          {(() => {
            // 線形回帰で予測
            const data = perf.slice(-6).map((p, i) => ({
              x: i,
              search: v(p.mobile_search_impressions) + v(p.pc_search_impressions),
              calls: v(p.call_clicks),
              routes: v(p.direction_requests),
            }));
            const n = data.length;
            const sumX = data.reduce((s, d) => s + d.x, 0);
            const predict = (key: 'search' | 'calls' | 'routes') => {
              const sumY = data.reduce((s, d) => s + d[key], 0);
              const sumXY = data.reduce((s, d) => s + d.x * d[key], 0);
              const sumX2 = data.reduce((s, d) => s + d.x * d.x, 0);
              const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX) || 0;
              const intercept = (sumY - slope * sumX) / n;
              return [1, 2, 3].map(m => Math.max(0, Math.round(intercept + slope * (n - 1 + m))));
            };
            const searchPred = predict('search');
            const callPred = predict('calls');
            const routePred = predict('routes');
            const avgSpend = (selectedShop as any)?.average_spending || 3000;
            const groupSize = (selectedShop as any)?.customers_per_group || 1.5;
            const months = [1, 2, 3].map(m => {
              const d = new Date();
              d.setMonth(d.getMonth() + m);
              return `${d.getFullYear()}/${d.getMonth() + 1}`;
            });

            return (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="text-left py-2 px-2 text-slate-500 font-medium">月</th>
                      <th className="text-right py-2 px-2 text-slate-500 font-medium">予測検索数</th>
                      <th className="text-right py-2 px-2 text-slate-500 font-medium">予測電話</th>
                      <th className="text-right py-2 px-2 text-slate-500 font-medium">予測経路</th>
                      <th className="text-right py-2 px-2 text-slate-500 font-medium">推定売上</th>
                    </tr>
                  </thead>
                  <tbody>
                    {months.map((month, i) => {
                      const visits = Math.round(callPred[i] * 0.3 + routePred[i] * 0.5);
                      const revenue = Math.round(visits * avgSpend * groupSize);
                      return (
                        <tr key={i} className="border-b border-slate-50">
                          <td className="py-2 px-2 text-slate-600 font-medium">{month}</td>
                          <td className="py-2 px-2 text-right text-[#003D6B] font-semibold">{searchPred[i].toLocaleString()}</td>
                          <td className="py-2 px-2 text-right text-purple-600">{callPred[i].toLocaleString()}</td>
                          <td className="py-2 px-2 text-right text-red-600">{routePred[i].toLocaleString()}</td>
                          <td className="py-2 px-2 text-right text-emerald-600 font-bold">¥{revenue.toLocaleString()}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="text-[9px] text-slate-400 mt-2">※ 直近6ヶ月のデータから線形回帰で予測。実際の売上を保証するものではありません。</p>
              </div>
            );
          })()}
        </div>
      )}

      {/* 解約予兆スコア */}
      {churnData && churnData.summary && (churnData.summary.high > 0 || churnData.summary.warning > 0) && (
        <div className="bg-white rounded-xl p-6 shadow-sm border border-amber-200 mt-6">
          <h3 className="text-sm font-semibold text-amber-700 mb-3">解約予兆スコア</h3>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-red-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-red-600">{churnData.summary.high}</p>
              <p className="text-[10px] text-red-500">高リスク</p>
            </div>
            <div className="bg-amber-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-amber-600">{churnData.summary.warning}</p>
              <p className="text-[10px] text-amber-500">要注意</p>
            </div>
            <div className="bg-emerald-50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-emerald-600">{churnData.summary.stable}</p>
              <p className="text-[10px] text-emerald-500">安定</p>
            </div>
          </div>
          {churnData.scores && churnData.scores.filter(s => s.risk !== "安定").slice(0, 5).map((s, i) => (
            <div key={i} className="flex items-center justify-between py-2 border-b border-slate-50">
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${s.risk === "高リスク" ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600"}`}>{s.score}点</span>
                <span className="text-xs text-slate-700">{s.shopName}</span>
              </div>
              <span className="text-[10px] text-slate-400">{s.factors.join(" / ")}</span>
            </div>
          ))}
        </div>
      )}

      {/* LINE ROM監視アラート */}
      {lineAlerts.length > 0 && (
        <div className="bg-white rounded-xl p-5 shadow-sm border border-orange-200 mt-6">
          <h3 className="text-sm font-semibold text-orange-700 mb-3">LINE監視アラート（{lineAlerts.length}件）</h3>
          <div className="space-y-2">
            {lineAlerts.map((alert: any) => (
              <div key={alert.id} className="flex items-start justify-between bg-orange-50 rounded-lg p-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${alert.alert_type === "urgent" ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600"}`}>
                      {alert.alert_type === "urgent" ? "緊急" : "変更依頼"}
                    </span>
                    <span className="text-[10px] text-orange-600 font-semibold">{alert.keyword}</span>
                    <span className="text-[10px] text-slate-400">{new Date(alert.created_at).toLocaleString("ja-JP")}</span>
                  </div>
                  <p className="text-xs text-slate-700 truncate">{alert.message}</p>
                </div>
                <button onClick={async () => {
                  await supabase.from("line_alerts").update({ resolved: true }).eq("id", alert.id);
                  setLineAlerts(lineAlerts.filter(a => a.id !== alert.id));
                }} className="text-[10px] text-slate-400 hover:text-emerald-600 ml-2 flex-shrink-0">対応済み</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Googleアップデート通知 */}
      {googleUpdates.length > 0 && (
        <div className="bg-white rounded-xl p-5 shadow-sm border border-blue-200 mt-6">
          <h3 className="text-sm font-semibold text-blue-700 mb-3">Google検索アップデート情報</h3>
          <div className="space-y-2">
            {googleUpdates.slice(0, 3).map((u, i) => (
              <a key={i} href={u.link} target="_blank" rel="noopener noreferrer"
                className="block bg-blue-50 rounded-lg p-3 hover:bg-blue-100 transition">
                <p className="text-xs font-medium text-blue-800">{u.title}</p>
                {u.published && <p className="text-[10px] text-blue-500 mt-0.5">{new Date(u.published).toLocaleDateString("ja-JP")}</p>}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* 要注意口コミアラート */}
      {badAlerts.length > 0 && (
        <div className="bg-white rounded-xl p-6 shadow-sm border border-red-200 mt-6">
          <h3 className="text-sm font-semibold text-red-600 mb-4">⚠ 要注意口コミ（★3以下）— {badAlerts.length}件</h3>
          <div className="space-y-3">
            {badAlerts.map((alert: any) => {
              const ratingMap: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, ONE_STAR: 1, TWO_STARS: 2, THREE_STARS: 3, FOUR_STARS: 4, FIVE_STARS: 5 };
              const stars = ratingMap[(alert.star_rating || "").toUpperCase()] || 0;
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
          <h3 className="text-sm font-semibold text-slate-500 mb-4">GBP写真一覧</h3>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            {topPhotos.map((photo: any, i: number) => (
              <div key={i} className="text-center">
                {photo.thumbnail_url ? (
                  <img src={photo.thumbnail_url} alt="" className="w-full h-24 object-cover rounded-lg mb-2" />
                ) : (
                  <div className="w-full h-24 bg-slate-100 rounded-lg mb-2 flex items-center justify-center text-slate-300 text-xs">No image</div>
                )}
                <p className="text-xs font-medium text-slate-600 truncate">{photo.shop_name}</p>
                <p className="text-[10px] text-slate-400">{photo.category}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
