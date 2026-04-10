"use client";

import { useEffect, useCallback, useState } from "react";
import api from "@/lib/api";
import { useShop } from "@/components/shop-provider";

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

export default function RankingPage() {
  const { apiConnected, selectedShopId, selectedShop } = useShop();
  const [keywords, setKeywords] = useState("");
  const [points, setPoints] = useState<MeasurePoint[]>(DEFAULT_POINTS);
  const [newPointLabel, setNewPointLabel] = useState("");
  const [newPointLat, setNewPointLat] = useState("");
  const [newPointLng, setNewPointLng] = useState("");
  const [measuring, setMeasuring] = useState(false);
  const [progress, setProgress] = useState("");
  const [results, setResults] = useState<RankResult[]>([]);
  const [history, setHistory] = useState<RankLog[]>([]);
  const [error, setError] = useState("");
  const [searchKeywords, setSearchKeywords] = useState<{ keyword: string; count: number }[]>([]);
  const [kwLoading, setKwLoading] = useState(false);

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
        setPoints([]);
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

  const fetchSearchKeywords = useCallback(async () => {
    if (!selectedShopId) return;
    setKwLoading(true);
    try {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const res = await api.post("/api/shop/performance/search_keyword", {
        shops: [selectedShopId],
        start: start.toISOString(),
        end: end.toISOString(),
      }, { timeout: 30000 });
      const data = Array.isArray(res.data) ? res.data : [];
      if (data.length > 0 && data[0].values) {
        setSearchKeywords(data[0].values.map((v: any) => ({
          keyword: v.searchKeyword || v.SearchKeyword || "",
          count: v.insightsValue?.value || v.InsightsValue?.Value || 0,
        })).filter((k: any) => k.keyword).sort((a: any, b: any) => b.count - a.count));
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
      <h1 className="text-2xl font-bold text-slate-800 mb-2">店舗検索ランキング</h1>
      <p className="text-sm text-slate-500 mb-6">キーワード順位を計測（最大100位まで・複数地点対応）</p>

      {!apiConnected || !selectedShopId ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">{apiConnected ? "店舗を選択してください" : "Go APIに接続し、店舗を登録すると利用できます"}</p>
        </div>
      ) : (
        <>
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
                      } else {
                        setError("シートにキーワードが見つかりませんでした");
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

          {/* 順位推移サマリー */}
          {history.length > 0 && (() => {
            // キーワードごとにグループ化して最新と前回を比較
            const groups = new Map<string, RankLog[]>();
            history.forEach((log) => {
              const kw = (() => { try { return JSON.parse(log.search_words).join(", "); } catch { return log.search_words; } })();
              if (!groups.has(kw)) groups.set(kw, []);
              groups.get(kw)!.push(log);
            });

            const summaries = Array.from(groups.entries()).map(([kw, logs]) => {
              const sorted = [...logs].sort((a, b) => new Date(b.searched_at).getTime() - new Date(a.searched_at).getTime());
              const latest = sorted[0];
              const prev = sorted.length >= 2 ? sorted[1] : null;
              const change = prev && latest.rank > 0 && prev.rank > 0 ? prev.rank - latest.rank : null;
              return { keyword: kw, latest, prev, change, history: sorted.slice(0, 10) };
            });

            return (
              <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 mb-6">
                <h3 className="text-sm font-semibold text-slate-500 mb-4">キーワード順位サマリー</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {summaries.map((s, i) => (
                    <div key={i} className="border border-slate-100 rounded-xl p-4">
                      <p className="text-sm font-medium text-slate-700 mb-2">{s.keyword}</p>
                      <div className="flex items-end gap-3 mb-3">
                        <span className={`text-3xl font-bold ${s.latest.rank > 0 ? (s.latest.rank <= 3 ? "text-emerald-600" : s.latest.rank <= 10 ? "text-blue-600" : s.latest.rank <= 20 ? "text-amber-600" : "text-orange-600") : "text-slate-400"}`}>
                          {s.latest.rank > 0 ? `${s.latest.rank}位` : "圏外"}
                        </span>
                        {s.change !== null && (
                          <span className={`text-sm font-semibold mb-1 ${s.change > 0 ? "text-emerald-600" : s.change < 0 ? "text-red-600" : "text-slate-400"}`}>
                            {s.change > 0 ? `↑${s.change}` : s.change < 0 ? `↓${Math.abs(s.change)}` : "→"}
                          </span>
                        )}
                      </div>
                      {/* ミニ推移バー */}
                      <div className="flex gap-1 items-end h-10">
                        {s.history.slice().reverse().map((h, j) => {
                          const val = h.rank > 0 ? Math.max(5, 100 - h.rank) : 5;
                          const color = h.rank > 0 ? (h.rank <= 3 ? "bg-emerald-400" : h.rank <= 10 ? "bg-blue-400" : h.rank <= 20 ? "bg-amber-400" : "bg-orange-400") : "bg-slate-200";
                          return (
                            <div key={j} className="flex-1 flex flex-col items-center gap-0.5" title={`${new Date(h.searched_at).toLocaleDateString("ja-JP")}: ${h.rank > 0 ? h.rank + "位" : "圏外"}`}>
                              <div className={`w-full rounded-sm ${color}`} style={{ height: `${val}%` }} />
                            </div>
                          );
                        })}
                      </div>
                      <p className="text-[10px] text-slate-400 mt-1">
                        最終計測: {new Date(s.latest.searched_at).toLocaleString("ja-JP")}
                        {s.prev && ` | 前回: ${s.prev.rank > 0 ? s.prev.rank + "位" : "圏外"}`}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* 検索語句 */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-500">検索語句ランキング（GBP API）</h3>
              <button onClick={fetchSearchKeywords} disabled={kwLoading}
                className={`px-3 py-1 rounded-lg text-[11px] font-semibold ${kwLoading ? "bg-slate-200 text-slate-400" : "bg-[#003D6B] hover:bg-[#002a4a]"}`}
                style={{ color: kwLoading ? undefined : "#fff" }}>
                {kwLoading ? "取得中..." : "検索語句を取得"}
              </button>
            </div>
            {searchKeywords.length === 0 ? (
              <p className="text-slate-400 text-sm text-center py-4">「検索語句を取得」ボタンでGBPの検索語句データを表示します</p>
            ) : (
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
            )}
          </div>

          {/* 計測履歴 */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
            <h3 className="text-sm font-semibold text-slate-500 mb-4">全計測履歴</h3>
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
                  {history.slice(0, 50).map((log) => {
                    const kws = (() => { try { return JSON.parse(log.search_words).join(", "); } catch { return log.search_words; } })();
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
