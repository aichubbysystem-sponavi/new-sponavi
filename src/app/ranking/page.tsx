"use client";

import { useEffect, useCallback, useState } from "react";
import api from "@/lib/api";
import { useShop } from "@/components/shop-provider";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Line } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Tooltip, Legend);

interface MeasurePoint {
  label: string;
  lat: number;
  lng: number;
}

interface RankResult {
  keyword: string;
  point: string;
  rank: number;
  shopName?: string;
  topResults?: string[];
}

interface RankLog {
  id: string;
  search_words: string;
  rank: number;
  searched_at: string;
  gbp_latitude: number;
  gbp_longitude: number;
}

const DEFAULT_POINTS: MeasurePoint[] = [];

/** search_wordsをstring/array/jsonb問わず統一文字列に変換 */
function normalizeKw(s: any): string {
  if (Array.isArray(s)) return s.join(", ").trim();
  if (typeof s === "string") {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.join(", ").trim();
      return String(parsed).trim();
    } catch {
      return s.trim();
    }
  }
  return String(s).trim();
}

export default function RankingPage() {
  const { apiConnected, selectedShopId, selectedShop, shops } = useShop();
  const [keywords, setKeywords] = useState("");
  const [points, setPoints] = useState<MeasurePoint[]>(DEFAULT_POINTS);
  const [newPointLabel, setNewPointLabel] = useState("");
  const [newPointLat, setNewPointLat] = useState("");
  const [newPointLng, setNewPointLng] = useState("");
  const [measuring, setMeasuring] = useState(false);
  const [progress, setProgress] = useState("");
  const [results, setResults] = useState<RankResult[]>([]);
  const [history, setHistory] = useState<RankLog[]>([]);
  const [rankAlerts, setRankAlerts] = useState<{ keyword: string; latest: number; prev: number; change: number; type: string }[]>([]);
  const [optimalTime, setOptimalTime] = useState<{ recommendation: string; bestSlots: any[] } | null>(null);
  const [error, setError] = useState("");
  const [searchKeywords, setSearchKeywords] = useState<{ keyword: string; count: number }[]>([]);
  const [kwLoading, setKwLoading] = useState(false);
  const [historyDateSort, setHistoryDateSort] = useState<"desc" | "asc">("desc");
  const [kwHistory, setKwHistory] = useState<{ period: string; keywords: { keyword: string; count: number }[] }[]>([]);
  const [volumeResults, setVolumeResults] = useState<{ keyword: string; resultCount: number; level: string }[]>([]);
  const [volumeLoading, setVolumeLoading] = useState(false);
  const [bulkMeasuring, setBulkMeasuring] = useState(false);
  const [bulkProgress, setBulkProgress] = useState("");
  const [bulkResult, setBulkResult] = useState<any>(null);

  // 店舗ごとの保存済みキーワードをDBから読み込み
  useEffect(() => {
    if (!selectedShopId) return;
    api.get(`/api/report/shop-keywords?shopId=${selectedShopId}`)
      .then((res) => {
        if (res.data?.keywords?.length > 0) {
          setKeywords(res.data.keywords.join("\n"));
        }
      })
      .catch(() => {});
  }, [selectedShopId]);

  // 店舗ごとの計測地点をlocalStorageから読み込み/保存
  useEffect(() => {
    if (!selectedShopId) return;
    const saved = localStorage.getItem(`ranking-points-${selectedShopId}`);
    if (saved) {
      try { setPoints(JSON.parse(saved)); } catch { setPoints([]); }
    } else if (selectedShop) {
      const lat = (selectedShop as any).gbp_latitude;
      const lng = (selectedShop as any).gbp_longitude;
      if (lat && lng && lat !== 0) {
        setPoints([{ label: "店舗周辺", lat, lng }]);
      } else {
        // Go APIに座標がない場合、Supabaseから取得
        import("@/lib/supabase").then(({ supabase }) => {
          supabase.from("shops").select("gbp_latitude, gbp_longitude")
            .eq("id", selectedShopId).single()
            .then(({ data }) => {
              if (data?.gbp_latitude && data.gbp_latitude !== 0) {
                setPoints([{ label: "店舗周辺", lat: data.gbp_latitude, lng: data.gbp_longitude }]);
              } else {
                setPoints([]);
              }
            }, () => setPoints([]));
        }, () => setPoints([]));
      }
    }
  }, [selectedShopId, selectedShop]);

  // 地点変更時にlocalStorageに保存
  useEffect(() => {
    if (selectedShopId && points.length > 0) {
      localStorage.setItem(`ranking-points-${selectedShopId}`, JSON.stringify(points));
    }
  }, [points, selectedShopId]);

  const fetchHistory = useCallback(async () => {
    if (!selectedShopId) return;
    try {
      const res = await api.get(`/api/report/ranking?shopId=${selectedShopId}`);
      setHistory(Array.isArray(res.data) ? res.data : []);
    } catch { setHistory([]); }
  }, [selectedShopId]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  // 順位変動アラート+最適投稿時間帯取得
  useEffect(() => {
    if (!selectedShopId) return;
    const token = async () => {
      const { supabase } = await import("@/lib/supabase");
      return (await supabase.auth.getSession()).data.session?.access_token;
    };
    token().then(async (t) => {
      const headers: Record<string, string> = t ? { Authorization: `Bearer ${t}` } : {};
      try {
        const [alertRes, timeRes] = await Promise.all([
          fetch(`/api/report/rank-alert?shopId=${selectedShopId}`, { headers }),
          fetch(`/api/report/optimal-time?shopId=${selectedShopId}`, { headers }),
        ]);
        if (alertRes.ok) { const d = await alertRes.json(); setRankAlerts(d.alerts || []); }
        if (timeRes.ok) { const d = await timeRes.json(); setOptimalTime(d); }
      } catch {}
    });
  }, [selectedShopId]);

  // 保存済み検索語句履歴を読み込み
  useEffect(() => {
    if (!selectedShopId) return;
    api.get(`/api/report/search-keywords?shopId=${selectedShopId}`)
      .then((res) => {
        setKwHistory(res.data.months || []);
        // 最新月のデータがあればsearchKeywordsにセット
        const months = res.data.months || [];
        if (months.length > 0) {
          setSearchKeywords(months[months.length - 1].keywords);
        }
      })
      .catch(() => setKwHistory([]));
  }, [selectedShopId]);

  const fetchSearchKeywords = useCallback(async () => {
    if (!selectedShopId) return;
    setKwLoading(true);
    try {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      const res = await api.post("/api/shop/performance/search_keyword", {
        shops: [selectedShopId],
        start: start.toISOString(),
        end: end.toISOString(),
      }, { timeout: 30000 });
      const data = Array.isArray(res.data) ? res.data : [];
      if (data.length > 0 && data[0].values) {
        const kws = data[0].values.map((v: any) => ({
          keyword: v.searchKeyword || v.SearchKeyword || "",
          count: v.insightsValue?.value || v.InsightsValue?.Value || 0,
        })).filter((k: any) => k.keyword).sort((a: any, b: any) => b.count - a.count);
        setSearchKeywords(kws);

        // DBに保存
        try {
          await api.post("/api/report/search-keywords", {
            shopId: selectedShopId,
            keywords: kws,
            periodStart: start.toISOString(),
            periodEnd: end.toISOString(),
          }, { timeout: 15000 });
          // 履歴を再取得
          const histRes = await api.get(`/api/report/search-keywords?shopId=${selectedShopId}`);
          setKwHistory(histRes.data.months || []);
        } catch {}
      }
    } catch { setSearchKeywords([]); }
    finally { setKwLoading(false); }
  }, [selectedShopId]);

  const addPoint = () => {
    if (!newPointLabel.trim() || !newPointLat || !newPointLng) return;
    setPoints([...points, { label: newPointLabel.trim(), lat: parseFloat(newPointLat), lng: parseFloat(newPointLng) }]);
    setNewPointLabel("");
    setNewPointLat("");
    setNewPointLng("");
  };

  const removePoint = (idx: number) => {
    const next = points.filter((_, i) => i !== idx);
    setPoints(next);
    if (selectedShopId) {
      if (next.length > 0) {
        localStorage.setItem(`ranking-points-${selectedShopId}`, JSON.stringify(next));
      } else {
        localStorage.removeItem(`ranking-points-${selectedShopId}`);
      }
    }
  };

  const handleMeasure = async () => {
    if (!selectedShopId || !keywords.trim() || points.length === 0) {
      setError("キーワードと計測地点を設定してください");
      return;
    }
    setMeasuring(true);
    setError("");
    setResults([]);

    const kwList = keywords.split("\n").map((k) => k.trim()).filter(Boolean);
    const allResults: RankResult[] = [];

    for (const point of points) {
      for (const kw of kwList) {
        setProgress(`計測中: ${point.label} / ${kw}`);
        let pageToken: string | undefined;
        let startPosition = 0;
        let finalRank = 0;
        let lastShopName = "";
        let lastTopResults: string[] = [];

        for (let page = 0; page < 5; page++) {
          try {
            const res = await api.post("/api/report/ranking", {
              shopId: selectedShopId,
              keyword: kw,
              pageToken,
              startPosition,
              lat: point.lat,
              lng: point.lng,
            }, { timeout: 30000 });

            const d = res.data;
            if (page === 0) { lastShopName = d.shopName || ""; lastTopResults = d.topResults || []; }
            if (d.found) { finalRank = d.rank; break; }
            if (!d.nextPageToken) break;
            pageToken = d.nextPageToken;
            startPosition = d.nextPosition;
          } catch { break; }
        }

        // DB保存
        try {
          await api.put("/api/report/ranking", {
            shopId: selectedShopId,
            keyword: kw,
            rank: finalRank,
            lat: point.lat,
            lng: point.lng,
            pointLabel: point.label,
          }, { timeout: 10000 });
        } catch {}

        allResults.push({ keyword: kw, point: point.label, rank: finalRank, shopName: lastShopName, topResults: lastTopResults });
        setResults([...allResults]);
      }
    }

    setProgress("");
    await fetchHistory();
    setMeasuring(false);
  };

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">店舗検索ランキング</h1>
          <p className="text-sm text-slate-500 mt-1">キーワード順位を計測（最大100位まで・複数地点対応）</p>
        </div>
        <button onClick={async () => {
          if (!confirm(`全${shops.length}店舗のKW順位を一括計測しますか？\n10店舗ずつバッチ処理します。`)) return;
          setBulkMeasuring(true); setBulkResult(null);
          const allIds = shops.map(s => s.id);
          let totalMeasured = 0;
          const allResults: any[] = [];
          const bs = 10;
          for (let i = 0; i < allIds.length; i += bs) {
            const batch = allIds.slice(i, i + bs);
            setBulkProgress(`計測中... ${i}/${allIds.length}店舗完了（${totalMeasured}KW計測済み）`);
            try {
              const token = (await (await import("@/lib/supabase")).supabase.auth.getSession()).data.session?.access_token;
              const res = await fetch("/api/report/ranking-bulk", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ shopIds: batch }),
              });
              if (res.ok) {
                const d = await res.json();
                totalMeasured += d.totalMeasured || 0;
                if (d.results) allResults.push(...d.results);
              }
            } catch {}
          }
          setBulkResult({ totalMeasured, totalShops: allIds.length, results: allResults });
          setBulkProgress(`完了: ${allIds.length}店舗、${totalMeasured}KW計測`);
          setBulkMeasuring(false);
          await fetchHistory();
        }} disabled={bulkMeasuring || shops.length === 0}
          className="px-4 py-2 rounded-lg text-xs font-semibold bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50">
          {bulkMeasuring ? "計測中..." : `全店舗一括計測（${shops.length}店舗）`}
        </button>
      </div>

      {!apiConnected || !selectedShopId ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">{apiConnected ? "店舗を選択してください" : "Go APIに接続し、店舗を登録すると利用できます"}</p>
        </div>
      ) : (
        <>
          {/* 全店舗一括計測の進捗/結果 */}
          {(bulkProgress || bulkResult) && (
            <div className={`rounded-xl p-4 shadow-sm mb-5 ${bulkMeasuring ? "bg-purple-50 border border-purple-200" : "bg-emerald-50 border border-emerald-200"}`}>
              <p className={`text-sm font-semibold ${bulkMeasuring ? "text-purple-700" : "text-emerald-700"}`}>{bulkProgress}</p>
              {bulkResult && bulkResult.results && (
                <div className="mt-2 max-h-[200px] overflow-y-auto">
                  {bulkResult.results.map((r: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 py-1 text-xs border-b border-slate-100">
                      <span className="text-slate-700 font-medium">{r.shopName}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${r.measured > 0 ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>
                        {r.measured > 0 ? `${r.measured}KW計測` : "KW設定なし"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 順位変動アラート */}
          {rankAlerts.length > 0 && (
            <div className="bg-amber-50 rounded-xl p-4 shadow-sm border border-amber-200 mb-5">
              <h3 className="text-sm font-semibold text-amber-700 mb-2">順位変動アラート（{rankAlerts.length}件）</h3>
              <div className="space-y-1.5">
                {rankAlerts.slice(0, 5).map((a, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className={`font-bold ${a.type === "up" ? "text-emerald-600" : "text-red-600"}`}>
                      {a.type === "up" ? "↑" : "↓"}{Math.abs(a.change)}位
                    </span>
                    <span className="text-slate-700 font-medium">{a.keyword}</span>
                    <span className="text-slate-400">{a.prev}位 → {a.latest}位</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 最適投稿時間帯 */}
          {optimalTime && optimalTime.recommendation && (
            <div className="bg-blue-50 rounded-xl p-4 shadow-sm border border-blue-200 mb-5">
              <h3 className="text-sm font-semibold text-blue-700 mb-1">最適投稿時間帯</h3>
              <p className="text-xs text-blue-600">{optimalTime.recommendation}</p>
              {optimalTime.bestSlots && optimalTime.bestSlots.length > 0 && (
                <div className="flex gap-2 mt-2">
                  {optimalTime.bestSlots.slice(0, 3).map((s: any, i: number) => (
                    <span key={i} className="text-[10px] bg-white px-2 py-1 rounded border border-blue-200 text-blue-700">
                      {s.recommended}（{s.count}件）
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
            {/* キーワード入力 */}
            <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
              <h3 className="text-sm font-semibold text-slate-500 mb-3">計測キーワード</h3>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-slate-400">1行に1つ入力</p>
                <button
                  onClick={async () => {
                    if (!selectedShop) return;
                    try {
                      const res = await api.get(`/api/report/ranking-keywords?shopName=${encodeURIComponent(selectedShop.name)}`);
                      if (res.data.found && res.data.keywords.length > 0) {
                        setKeywords(res.data.keywords.join("\n"));
                        // DBに保存
                        try {
                          await api.put("/api/report/shop-keywords", {
                            shopId: selectedShopId,
                            keywords: res.data.keywords,
                            source: "sheet",
                          });
                        } catch {}
                        // 計測地点も自動設定（AR/AS/AT列から）
                        if (res.data.points && res.data.points.length > 0) {
                          setPoints(res.data.points);
                          if (selectedShopId) {
                            localStorage.setItem(`ranking-points-${selectedShopId}`, JSON.stringify(res.data.points));
                          }
                        }
                      } else {
                        if (res.data.found) {
                          // タブは見つかったがKWデータがない
                          setError(`「${res.data.matchedTab || selectedShop.name}」のタブにキーワード順位データがありません。R〜AD列にKWが設定されているか確認してください。`);
                        } else {
                          // タブ自体が見つからない
                          setError(`シートに「${selectedShop.name}」のタブが見つかりません。スプレッドシートにこの店舗名のタブがあるか確認してください。`);
                        }
                        // 地点だけでも設定（KWなくても地点は有効）
                        if (res.data.points && res.data.points.length > 0) {
                          setPoints(res.data.points);
                          if (selectedShopId) localStorage.setItem(`ranking-points-${selectedShopId}`, JSON.stringify(res.data.points));
                        }
                      }
                    } catch (e: any) {
                      setError(e?.response?.data?.error || "シート取得に失敗しました");
                    }
                  }}
                  className="px-3 py-1 rounded-lg text-[11px] font-semibold bg-purple-600 hover:bg-purple-700"
                  style={{ color: "#fff" }}
                >
                  シートから反映
                </button>
                <button
                  onClick={async () => {
                    if (!selectedShop) return;
                    setError("");
                    try {
                      const res = await api.post("/api/report/reply-suggest", {
                        comment: `店舗「${selectedShop.name}」のMEO対策に最適な検索キーワード候補を8個提案してください。

条件:
- 地域名+業種の組み合わせ
- 検索ボリュームが高そうなもの
- 具体的で自然な検索クエリ
- 1行に1キーワード、番号なし、説明なし、キーワードのみ出力`,
                        starRating: 5,
                        shopName: selectedShop.name,
                      }, { timeout: 20000 });
                      if (res.data.reply) {
                        const kws = res.data.reply.split("\n").map((l: string) => l.trim()).filter(Boolean);
                        setKeywords((prev) => prev ? prev + "\n" + kws.join("\n") : kws.join("\n"));
                      }
                    } catch (e: any) { setError("AI候補生成に失敗: " + (e?.message || "")); }
                  }}
                  className="px-3 py-1 rounded-lg text-[11px] font-semibold bg-emerald-600 hover:bg-emerald-700"
                  style={{ color: "#fff" }}
                >
                  AIで候補提案
                </button>
              </div>
              <textarea
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                placeholder={"千早 テイクアウト\n千早 チキン\n千早 弁当"}
                className="w-full border border-slate-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#003D6B]/20 min-h-[120px] resize-y"
              />
            </div>

            {/* 計測地点設定 */}
            <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
              <h3 className="text-sm font-semibold text-slate-500 mb-3">計測地点</h3>
              <p className="text-xs text-slate-400 mb-2">Googleマップで右クリック→座標をコピーして入力</p>

              {/* 既存地点 */}
              <div className="space-y-2 mb-3">
                {points.map((p, i) => (
                  <div key={i} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
                    <div>
                      <span className="text-sm font-medium text-slate-700">{p.label}</span>
                      <span className="text-xs text-slate-400 ml-2">{p.lat.toFixed(4)}, {p.lng.toFixed(4)}</span>
                    </div>
                    <button onClick={() => removePoint(i)} className="text-xs text-red-400 hover:text-red-600">削除</button>
                  </div>
                ))}
                {points.length === 0 && (
                  <p className="text-xs text-amber-500 py-2">⚠ 計測地点を追加してください</p>
                )}
              </div>

              {/* 新規地点追加 */}
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="地点名（例：博多駅前）"
                  value={newPointLabel}
                  onChange={(e) => setNewPointLabel(e.target.value)}
                  className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#003D6B]/20"
                />
                <input
                  type="text"
                  placeholder="緯度"
                  value={newPointLat}
                  onChange={(e) => setNewPointLat(e.target.value)}
                  className="w-24 border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none"
                />
                <input
                  type="text"
                  placeholder="経度"
                  value={newPointLng}
                  onChange={(e) => setNewPointLng(e.target.value)}
                  className="w-24 border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none"
                />
                <button
                  onClick={addPoint}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700"
                  style={{ color: "#fff" }}
                >
                  追加
                </button>
              </div>
            </div>
          </div>

          {/* 計測ボタン */}
          <div className="flex items-center justify-between mb-6">
            <span className="text-xs text-slate-400">
              {selectedShop?.name} × {points.length}地点 × {keywords.split("\n").filter((k) => k.trim()).length || 0}キーワード
            </span>
            <button
              onClick={handleMeasure}
              disabled={measuring || !keywords.trim() || points.length === 0}
              className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                measuring ? "bg-slate-200 text-slate-400" : "bg-[#003D6B] hover:bg-[#002a4a]"
              }`}
              style={{ color: measuring ? undefined : "#fff" }}
            >
              {measuring ? progress || "計測中..." : "順位を計測"}
            </button>
          </div>

          {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-700">{error}</div>}

          {/* 計測結果 */}
          {results.length > 0 && (
            <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 mb-6">
              <h3 className="text-sm font-semibold text-slate-500 mb-4">計測結果</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-2 px-3 text-slate-500 font-medium">キーワード</th>
                    <th className="text-left py-2 px-3 text-slate-500 font-medium">計測地点</th>
                    <th className="text-center py-2 px-3 text-slate-500 font-medium">順位</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => (
                    <tr key={i} className="border-b border-slate-50">
                      <td className="py-2 px-3 text-slate-700">{r.keyword}</td>
                      <td className="py-2 px-3 text-slate-600 text-xs">{r.point}</td>
                      <td className="py-2 px-3 text-center">
                        <span className={`text-lg font-bold ${r.rank > 0 ? (r.rank <= 3 ? "text-emerald-600" : r.rank <= 10 ? "text-blue-600" : r.rank <= 20 ? "text-amber-600" : "text-orange-600") : "text-slate-400"}`}>
                          {r.rank > 0 ? `${r.rank}位` : "圏外"}
                        </span>
                        {r.shopName && <p className="text-[10px] text-slate-400 mt-0.5">検索対象: {r.shopName}</p>}
                        {r.rank === 0 && r.topResults && r.topResults.length > 0 && (
                          <div className="mt-1 text-left">
                            <p className="text-[10px] text-slate-400">上位表示:</p>
                            {r.topResults.map((t, j) => <p key={j} className="text-[10px] text-slate-300">{j+1}. {t}</p>)}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 順位サマリーテーブル（キーワード×地点、最新のみ） */}
          {history.length > 0 && (() => {
            const nkw = normalizeKw;

            // キーワード+地点でグループ化し、最新と前回を抽出
            const groups = new Map<string, { kw: string; point: string; latest: RankLog; prev: RankLog | null }>();
            const sorted = [...history].sort((a, b) => new Date(b.searched_at).getTime() - new Date(a.searched_at).getTime());
            for (const log of sorted) {
              const kw = nkw(log.search_words);
              const point = (log as any).point_label || "default";
              const key = `${kw}__${point}`;
              if (!groups.has(key)) {
                groups.set(key, { kw, point, latest: log, prev: null });
              } else if (!groups.get(key)!.prev) {
                groups.get(key)!.prev = log;
              }
            }

            const summaries = Array.from(groups.values());

            return (
              <div className="bg-white rounded-xl shadow-sm border border-slate-100 mb-6">
                <div className="p-4 border-b border-slate-100">
                  <h3 className="text-sm font-semibold text-slate-500">キーワード順位サマリー（最新）</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100">
                        <th className="text-left p-3 text-slate-500 font-medium">キーワード</th>
                        <th className="text-center p-3 text-slate-500 font-medium">地点</th>
                        <th className="text-center p-3 text-slate-500 font-medium">最新順位</th>
                        <th className="text-center p-3 text-slate-500 font-medium">前回</th>
                        <th className="text-center p-3 text-slate-500 font-medium">変動</th>
                        <th className="text-right p-3 text-slate-500 font-medium">計測日</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summaries.map((s, i) => {
                        const change = s.prev && s.latest.rank > 0 && s.prev.rank > 0 ? s.prev.rank - s.latest.rank : null;
                        return (
                          <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                            <td className="p-3 font-medium text-slate-700">{s.kw}</td>
                            <td className="p-3 text-center text-xs text-slate-500">{s.point}</td>
                            <td className="p-3 text-center">
                              <span className={`text-lg font-bold ${s.latest.rank > 0 ? (s.latest.rank <= 3 ? "text-emerald-600" : s.latest.rank <= 10 ? "text-blue-600" : s.latest.rank <= 20 ? "text-amber-600" : "text-orange-600") : "text-slate-400"}`}>
                                {s.latest.rank > 0 ? `${s.latest.rank}位` : "圏外"}
                              </span>
                            </td>
                            <td className="p-3 text-center text-xs text-slate-400">
                              {s.prev ? (s.prev.rank > 0 ? `${s.prev.rank}位` : "圏外") : "-"}
                            </td>
                            <td className="p-3 text-center">
                              {change !== null ? (
                                <span className={`text-xs font-bold ${change > 0 ? "text-emerald-600" : change < 0 ? "text-red-600" : "text-slate-400"}`}>
                                  {change > 0 ? `↑${change}` : change < 0 ? `↓${Math.abs(change)}` : "→"}
                                </span>
                              ) : <span className="text-slate-300">-</span>}
                            </td>
                            <td className="p-3 text-right text-xs text-slate-400">{new Date(s.latest.searched_at).toLocaleDateString("ja-JP")}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}

          {/* 順位推移チャート（折れ線グラフ） */}
          {history.length > 0 && (() => {
            const nkw = normalizeKw;

            // キーワード名でユニークに統合（地点違いは同一キーワードとして統合、ベスト順位を採用）
            const dateRankMap = new Map<string, Map<string, number>>(); // kw → { date → bestRank }
            history.forEach((log) => {
              if (log.rank === 0) return;
              const kw = nkw(log.search_words);
              const date = new Date(log.searched_at).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
              if (!dateRankMap.has(kw)) dateRankMap.set(kw, new Map());
              const existing = dateRankMap.get(kw)!.get(date);
              if (!existing || log.rank < existing) dateRankMap.get(kw)!.set(date, log.rank);
            });

            if (dateRankMap.size === 0) return null;

            // 日付ラベル（古い順、重複排除）
            const dateSet = new Set<string>();
            [...history].sort((a, b) => new Date(a.searched_at).getTime() - new Date(b.searched_at).getTime()).forEach((log) => {
              dateSet.add(new Date(log.searched_at).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" }));
            });
            const dateLabels = Array.from(dateSet).slice(-10);

            const COLORS = ["#003D6B", "#e94560", "#27ae60", "#f39c12", "#8e44ad", "#e67e22", "#2980b9", "#c0392b", "#16a085", "#d35400"];
            const datasets = Array.from(dateRankMap.entries()).map(([kw, ranks], i) => ({
              label: kw,
              data: dateLabels.map((d) => ranks.get(d) ?? null),
              borderColor: COLORS[i % COLORS.length],
              backgroundColor: COLORS[i % COLORS.length],
              tension: 0.3,
              pointRadius: 6,
              pointHoverRadius: 8,
              borderWidth: 3,
              spanGaps: true,
              fill: false,
            }));

            return (
              <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 mb-6">
                <h3 className="text-sm font-semibold text-slate-500 mb-4">順位推移チャート</h3>
                <div style={{ height: 350 }}>
                  <Line
                    data={{ labels: dateLabels, datasets }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      interaction: { mode: "index", intersect: false },
                      plugins: {
                        legend: { position: "bottom", labels: { font: { size: 11 }, usePointStyle: true, padding: 16, pointStyle: "circle" } },
                        tooltip: {
                          backgroundColor: "rgba(0,0,0,0.8)",
                          titleFont: { size: 12 },
                          bodyFont: { size: 12 },
                          callbacks: {
                            label: (ctx: any) => ` ${ctx.dataset.label}: ${ctx.parsed.y}位`,
                          },
                        },
                      },
                      scales: {
                        x: { grid: { display: false }, ticks: { font: { size: 12 } } },
                        y: {
                          reverse: true,
                          min: 1,
                          suggestedMax: 50,
                          grid: { color: "#f0f0f0" },
                          ticks: { callback: (v: any) => v + "位", stepSize: 5, font: { size: 11 } },
                        },
                      },
                    }}
                  />
                </div>
                <p className="text-[10px] text-slate-400 mt-2">※ 圏外は除外。複数地点の場合はベスト順位を表示。</p>
              </div>
            );
          })()}

          {/* キーワードボリューム推定 */}
          {keywords.trim() && (
            <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-slate-500">対策KWボリューム推定</h3>
                <button onClick={async () => {
                  setVolumeLoading(true);
                  try {
                    const kws = keywords.split("\n").map((k: string) => k.trim()).filter(Boolean);
                    const shop = selectedShop as any;
                    const token = (await (await import("@/lib/supabase")).supabase.auth.getSession()).data.session?.access_token;
                    const res = await fetch("/api/report/keyword-volume", {
                      method: "POST",
                      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
                      body: JSON.stringify({ keywords: kws, lat: shop?.gbp_latitude, lng: shop?.gbp_longitude }),
                    });
                    const data = await res.json();
                    setVolumeResults(data.results || []);
                  } catch { setVolumeResults([]); }
                  setVolumeLoading(false);
                }} disabled={volumeLoading}
                  className={`px-3 py-1 rounded-lg text-[11px] font-semibold ${volumeLoading ? "bg-slate-200 text-slate-400" : "bg-amber-500 hover:bg-amber-600"}`}
                  style={{ color: volumeLoading ? undefined : "#fff" }}>
                  {volumeLoading ? "推定中..." : "ボリューム推定"}
                </button>
              </div>
              {volumeResults.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200">
                        <th className="text-left py-1.5 px-2 text-slate-500 font-medium">キーワード</th>
                        <th className="text-center py-1.5 px-2 text-slate-500 font-medium">周辺店舗数</th>
                        <th className="text-center py-1.5 px-2 text-slate-500 font-medium">競争レベル</th>
                      </tr>
                    </thead>
                    <tbody>
                      {volumeResults.map((v, i) => (
                        <tr key={i} className="border-b border-slate-50">
                          <td className="py-1.5 px-2 text-slate-700 font-medium">{v.keyword}</td>
                          <td className="py-1.5 px-2 text-center font-semibold text-[#003D6B]">{v.resultCount}件</td>
                          <td className="py-1.5 px-2 text-center">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              v.level.includes("多") ? "bg-red-50 text-red-600" :
                              v.level.includes("中") ? "bg-amber-50 text-amber-600" :
                              v.level.includes("少") ? "bg-emerald-50 text-emerald-600" :
                              v.level.includes("極少") ? "bg-blue-50 text-blue-600" :
                              "bg-slate-50 text-slate-500"
                            }`}>{v.level}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-[9px] text-slate-400 mt-2">※ 半径5km以内のPlaces API検索結果数に基づく推定。「少（狙い目）」は競争が少なく上位表示しやすいキーワードです。</p>
                </div>
              )}
            </div>
          )}

          {/* 検索語句 */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-500">検索語句ランキング（GBP API）</h3>
              <button onClick={fetchSearchKeywords} disabled={kwLoading}
                className={`px-3 py-1 rounded-lg text-[11px] font-semibold ${kwLoading ? "bg-slate-200 text-slate-400" : "bg-[#003D6B] hover:bg-[#002a4a]"}`}
                style={{ color: kwLoading ? undefined : "#fff" }}>
                {kwLoading ? "取得中..." : "最新データを取得"}
              </button>
            </div>

            {/* 月別推移チャート（TOP5キーワード） */}
            {kwHistory.length >= 2 && (() => {
              // 全月のTOP5キーワードを抽出
              const topKws = new Set<string>();
              kwHistory.forEach((m) => m.keywords.slice(0, 5).forEach((k) => topKws.add(k.keyword)));
              const labels = kwHistory.map((m) => m.period.replace(/^\d{4}-/, "").replace(/^0/, "") + "月");
              const COLORS = ["#003D6B", "#e94560", "#27ae60", "#f39c12", "#8e44ad", "#e67e22", "#2980b9", "#c0392b"];
              const datasets = Array.from(topKws).slice(0, 8).map((kw, i) => ({
                label: kw,
                data: kwHistory.map((m) => {
                  const found = m.keywords.find((k) => k.keyword === kw);
                  return found ? found.count : 0;
                }),
                borderColor: COLORS[i % COLORS.length],
                backgroundColor: COLORS[i % COLORS.length],
                tension: 0.3,
                pointRadius: 5,
                borderWidth: 2,
                fill: false,
              }));

              return (
                <div className="mb-6">
                  <p className="text-xs text-slate-400 mb-2">TOP検索語句の月別推移</p>
                  <div style={{ height: 250 }}>
                    <Line
                      data={{ labels, datasets }}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                          legend: { position: "bottom", labels: { font: { size: 10 }, usePointStyle: true, padding: 12 } },
                          tooltip: { callbacks: { label: (ctx: any) => ` ${ctx.dataset.label}: ${ctx.parsed.y}回` } },
                        },
                        scales: {
                          x: { grid: { display: false } },
                          y: { beginAtZero: true, grid: { color: "#f0f0f0" }, ticks: { callback: (v: any) => v.toLocaleString() } },
                        },
                      }}
                    />
                  </div>
                </div>
              );
            })()}

            {/* 最新の検索語句TOP20 + 前月比較 */}
            {searchKeywords.length === 0 ? (
              <p className="text-slate-400 text-sm text-center py-4">「最新データを取得」でGBPの検索語句を取得・保存します</p>
            ) : (
              <>
                {/* 前月比較テーブル */}
                {kwHistory.length >= 2 && (() => {
                  const latest = kwHistory[kwHistory.length - 1];
                  const prev = kwHistory[kwHistory.length - 2];
                  const prevMap = new Map(prev.keywords.map((k) => [k.keyword, k.count]));
                  const combined = latest.keywords.slice(0, 20).map((kw) => ({
                    keyword: kw.keyword,
                    current: kw.count,
                    previous: prevMap.get(kw.keyword) || 0,
                    diff: kw.count - (prevMap.get(kw.keyword) || 0),
                  }));
                  return (
                    <div className="mb-4">
                      <p className="text-xs text-slate-400 mb-2">検索語句 前月比較（{prev.period} → {latest.period}）</p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-slate-200">
                              <th className="text-left py-1.5 px-2 text-slate-500 font-medium">#</th>
                              <th className="text-left py-1.5 px-2 text-slate-500 font-medium">検索語句</th>
                              <th className="text-right py-1.5 px-2 text-slate-500 font-medium">当月</th>
                              <th className="text-right py-1.5 px-2 text-slate-500 font-medium">前月</th>
                              <th className="text-right py-1.5 px-2 text-slate-500 font-medium">増減</th>
                            </tr>
                          </thead>
                          <tbody>
                            {combined.map((kw, i) => (
                              <tr key={i} className="border-b border-slate-50">
                                <td className="py-1.5 px-2 text-slate-400">{i + 1}</td>
                                <td className="py-1.5 px-2 text-slate-700 font-medium">{kw.keyword}</td>
                                <td className="py-1.5 px-2 text-right font-semibold text-[#003D6B]">{kw.current.toLocaleString()}</td>
                                <td className="py-1.5 px-2 text-right text-slate-500">{kw.previous.toLocaleString()}</td>
                                <td className={`py-1.5 px-2 text-right font-semibold ${kw.diff > 0 ? "text-emerald-600" : kw.diff < 0 ? "text-red-600" : "text-slate-400"}`}>
                                  {kw.diff > 0 ? `+${kw.diff.toLocaleString()}` : kw.diff < 0 ? kw.diff.toLocaleString() : "±0"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}

                <p className="text-xs text-slate-400 mb-2">最新の検索語句 TOP20</p>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
                  {searchKeywords.slice(0, 20).map((kw, i) => (
                    <div key={i} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-bold text-slate-300 w-5">{i + 1}</span>
                        <span className="text-xs text-slate-700 truncate">{kw.keyword}</span>
                      </div>
                      <span className="text-xs font-semibold text-[#003D6B] flex-shrink-0 ml-2">{kw.count}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* 計測履歴 */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-500">全計測履歴</h3>
              <button onClick={() => setHistoryDateSort(historyDateSort === "desc" ? "asc" : "desc")}
                className="px-3 py-1 rounded-lg text-[11px] font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition">
                {historyDateSort === "desc" ? "新しい順 ↓" : "古い順 ↑"}
              </button>
            </div>
            {history.length === 0 ? (
              <p className="text-slate-400 text-sm text-center py-6">計測履歴がありません</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-2 px-3 text-slate-500 font-medium">キーワード</th>
                    <th className="text-center py-2 px-3 text-slate-500 font-medium">順位</th>
                    <th className="text-center py-2 px-3 text-slate-500 font-medium">計測地点</th>
                    <th className="text-right py-2 px-3 text-slate-500 font-medium">計測日時</th>
                  </tr>
                </thead>
                <tbody>
                  {[...history].sort((a, b) => {
                    const ta = new Date(a.searched_at).getTime();
                    const tb = new Date(b.searched_at).getTime();
                    return historyDateSort === "desc" ? tb - ta : ta - tb;
                  }).slice(0, 50).map((log) => {
                    const kws = normalizeKw(log.search_words);
                    return (
                      <tr key={log.id} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="py-2 px-3 text-slate-700">{kws}</td>
                        <td className="py-2 px-3 text-center">
                          <span className={`font-bold ${log.rank > 0 ? (log.rank <= 3 ? "text-emerald-600" : log.rank <= 10 ? "text-blue-600" : "text-amber-600") : "text-slate-400"}`}>
                            {log.rank > 0 ? `${log.rank}位` : "圏外"}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-center text-xs text-slate-600">
                          {(log as any).point_label || (log.gbp_latitude ? `${log.gbp_latitude.toFixed(2)}, ${log.gbp_longitude.toFixed(2)}` : "-")}
                        </td>
                        <td className="py-2 px-3 text-right text-xs text-slate-400">{new Date(log.searched_at).toLocaleString("ja-JP")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
