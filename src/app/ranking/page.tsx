"use client";

import { useEffect, useCallback, useState } from "react";
import api from "@/lib/api";
import { useShop } from "@/components/shop-provider";

interface RankResult {
  keyword: string;
  rank: number;
  totalResults: number;
}

interface RankLog {
  id: string;
  search_words: string;
  rank: number;
  searched_at: string;
}

export default function RankingPage() {
  const { apiConnected, selectedShopId, selectedShop } = useShop();
  const [keywords, setKeywords] = useState("");
  const [measuring, setMeasuring] = useState(false);
  const [results, setResults] = useState<RankResult[]>([]);
  const [history, setHistory] = useState<RankLog[]>([]);
  const [error, setError] = useState("");

  const fetchHistory = useCallback(async () => {
    if (!selectedShopId) return;
    try {
      const res = await api.get(`/api/report/ranking?shopId=${selectedShopId}`);
      setHistory(Array.isArray(res.data) ? res.data : []);
    } catch { setHistory([]); }
  }, [selectedShopId]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const handleMeasure = async () => {
    if (!selectedShopId || !keywords.trim()) return;
    setMeasuring(true);
    setError("");
    setResults([]);

    const kwList = keywords.split("\n").map((k) => k.trim()).filter(Boolean);

    try {
      const res = await api.post("/api/report/ranking", {
        shopId: selectedShopId,
        keywords: kwList,
      }, { timeout: 50000 });

      setResults(res.data.results || []);
      await fetchHistory();
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || "計測に失敗しました");
    } finally {
      setMeasuring(false);
    }
  };

  return (
    <div className="animate-fade-in">
      <h1 className="text-2xl font-bold text-slate-800 mb-2">店舗検索ランキング</h1>
      <p className="text-sm text-slate-500 mb-6">キーワード順位を計測（最大20位まで検出）</p>

      {!apiConnected || !selectedShopId ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">{apiConnected ? "店舗を選択してください" : "Go APIに接続し、店舗を登録すると利用できます"}</p>
        </div>
      ) : (
        <>
          {/* 計測フォーム */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 mb-6">
            <h3 className="text-sm font-semibold text-slate-500 mb-3">キーワード順位計測</h3>
            <p className="text-xs text-slate-400 mb-3">計測したいキーワードを1行に1つ入力してください（例：「名古屋 居酒屋」）</p>
            <textarea
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder={"新宿 居酒屋\n渋谷 焼肉\n東京 ラーメン"}
              className="w-full border border-slate-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#003D6B]/20 min-h-[100px] resize-y"
            />
            <div className="flex items-center justify-between mt-3">
              <span className="text-xs text-slate-400">
                {selectedShop?.name} の順位を計測します（半径2km以内）
              </span>
              <button
                onClick={handleMeasure}
                disabled={measuring || !keywords.trim()}
                className={`px-6 py-2 rounded-lg text-sm font-semibold transition-all ${
                  measuring ? "bg-slate-200 text-slate-400" : "bg-[#003D6B] hover:bg-[#002a4a]"
                }`}
                style={{ color: measuring ? undefined : "#fff" }}
              >
                {measuring ? "計測中..." : "順位を計測"}
              </button>
            </div>
          </div>

          {/* エラー */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-700">{error}</div>
          )}

          {/* 計測結果 */}
          {results.length > 0 && (
            <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 mb-6">
              <h3 className="text-sm font-semibold text-slate-500 mb-4">計測結果</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {results.map((r, i) => (
                  <div key={i} className={`rounded-xl p-4 border ${r.rank > 0 ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}>
                    <p className="text-xs text-slate-500 mb-1">{r.keyword}</p>
                    <p className={`text-3xl font-bold ${r.rank > 0 ? (r.rank <= 3 ? "text-emerald-600" : r.rank <= 10 ? "text-blue-600" : "text-amber-600") : "text-slate-400"}`}>
                      {r.rank > 0 ? `${r.rank}位` : "圏外"}
                    </p>
                    {r.rank === 0 && <p className="text-[10px] text-slate-400 mt-1">100位以内に見つかりませんでした</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 計測履歴 */}
          <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
            <h3 className="text-sm font-semibold text-slate-500 mb-4">計測履歴（最新100件）</h3>
            {history.length === 0 ? (
              <p className="text-slate-400 text-sm text-center py-6">計測履歴がありません。キーワードを入力して計測してください。</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-2 px-3 text-slate-500 font-medium">キーワード</th>
                    <th className="text-center py-2 px-3 text-slate-500 font-medium">順位</th>
                    <th className="text-right py-2 px-3 text-slate-500 font-medium">計測日時</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((log) => {
                    const kws = (() => { try { return JSON.parse(log.search_words).join(", "); } catch { return log.search_words; } })();
                    return (
                      <tr key={log.id} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="py-2 px-3 text-slate-700">{kws}</td>
                        <td className="py-2 px-3 text-center">
                          <span className={`font-bold ${log.rank > 0 ? (log.rank <= 3 ? "text-emerald-600" : log.rank <= 10 ? "text-blue-600" : "text-amber-600") : "text-slate-400"}`}>
                            {log.rank > 0 ? `${log.rank}位` : "圏外"}
                          </span>
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
