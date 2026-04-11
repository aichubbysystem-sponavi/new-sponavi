"use client";

import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

interface Props {
  shop: any;
  totalReviews: number;
  unrepliedCount: number;
  avgRating: number;
  recentReviews: any[];
  monthlyStats: { month: string; count: number; avgRating: number }[];
  rankingData: any[];
  analysis: any;
}

export default function DashboardClient({
  shop, totalReviews, unrepliedCount, avgRating, recentReviews, monthlyStats, rankingData, analysis,
}: Props) {

  const ratingMap: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, ONE_STAR: 1, TWO_STARS: 2, THREE_STARS: 3, FOUR_STARS: 4, FIVE_STARS: 5 };
  const starToNum = (s: string) => ratingMap[(s || "").toUpperCase().replace(/_STARS?/, "")] || 0;

  // 順位データをグループ化
  const rankGroups = new Map<string, { rank: number; prevRank: number }>();
  for (const log of rankingData) {
    let kw: string;
    try { kw = JSON.parse(log.search_words).join(", "); } catch { kw = log.search_words; }
    if (!rankGroups.has(kw)) rankGroups.set(kw, { rank: log.rank, prevRank: 0 });
    else if (rankGroups.get(kw)!.prevRank === 0) rankGroups.get(kw)!.prevRank = log.rank;
  }
  const rankSummary = Array.from(rankGroups.entries()).slice(0, 8).map(([kw, d]) => ({
    keyword: kw, rank: d.rank, prevRank: d.prevRank || d.rank,
  }));

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* ヘッダー */}
      <div className="bg-[#003D6B] text-white px-6 py-5">
        <div className="max-w-5xl mx-auto">
          <p className="text-[10px] text-blue-200 tracking-wider">SPOTLIGHT NAVIGATOR</p>
          <h1 className="text-xl font-bold mt-1">{shop.name}</h1>
          <p className="text-xs text-blue-200 mt-0.5">{shop.state}{shop.city}{shop.address}</p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* KPIカード */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
            <p className="text-[10px] text-slate-400 font-medium mb-1">総口コミ数</p>
            <p className="text-3xl font-bold text-[#003D6B]">{totalReviews.toLocaleString()}</p>
          </div>
          <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
            <p className="text-[10px] text-slate-400 font-medium mb-1">平均評価</p>
            <p className="text-3xl font-bold text-amber-500">★ {avgRating}</p>
          </div>
          <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
            <p className="text-[10px] text-slate-400 font-medium mb-1">未返信</p>
            <p className={`text-3xl font-bold ${unrepliedCount > 0 ? "text-red-500" : "text-emerald-500"}`}>{unrepliedCount}</p>
          </div>
          <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
            <p className="text-[10px] text-slate-400 font-medium mb-1">返信率</p>
            <p className="text-3xl font-bold text-emerald-600">{totalReviews > 0 ? Math.round(((totalReviews - unrepliedCount) / totalReviews) * 100) : 0}%</p>
          </div>
        </div>

        {/* グラフ */}
        {monthlyStats.length > 1 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
              <h3 className="text-xs font-semibold text-slate-500 mb-3">月別平均評価推移</h3>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={monthlyStats}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="month" tick={{ fontSize: 9 }} />
                  <YAxis domain={[1, 5]} tick={{ fontSize: 9 }} />
                  <Tooltip formatter={(v: any) => [`★ ${Number(v).toFixed(2)}`, "評価"]} />
                  <ReferenceLine y={3.5} stroke="#ef4444" strokeDasharray="5 5" />
                  <Line type="monotone" dataKey="avgRating" stroke="#003D6B" strokeWidth={2} dot={{ r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
              <h3 className="text-xs font-semibold text-slate-500 mb-3">月別口コミ増加数</h3>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={monthlyStats}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="month" tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 9 }} />
                  <Tooltip formatter={(v: any) => [`${v}件`, "増加数"]} />
                  <Bar dataKey="count" fill="#003D6B" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* キーワード順位 */}
        {rankSummary.length > 0 && (
          <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 mb-6">
            <h3 className="text-xs font-semibold text-slate-500 mb-3">キーワード順位</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {rankSummary.map((r, i) => {
                const diff = r.prevRank - r.rank;
                return (
                  <div key={i} className="flex items-center justify-between py-2 px-3 bg-slate-50 rounded-lg">
                    <span className="text-xs text-slate-700 truncate flex-1">{r.keyword}</span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {diff !== 0 && (
                        <span className={`text-[10px] font-semibold ${diff > 0 ? "text-emerald-600" : "text-red-600"}`}>
                          {diff > 0 ? `↑${diff}` : `↓${Math.abs(diff)}`}
                        </span>
                      )}
                      <span className={`text-base font-bold ${r.rank <= 3 ? "text-emerald-600" : r.rank <= 10 ? "text-blue-600" : r.rank <= 20 ? "text-amber-600" : "text-orange-600"}`}>
                        {r.rank > 0 ? `${r.rank}位` : "圏外"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* AI分析 */}
        {analysis && (
          <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 mb-6">
            <h3 className="text-xs font-semibold text-slate-500 mb-3">口コミAI分析</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
              {analysis.positive_words && (
                <div>
                  <p className="text-[10px] text-emerald-600 font-semibold mb-1">ポジティブワード</p>
                  <div className="flex flex-wrap gap-1">
                    {(typeof analysis.positive_words === "string" ? JSON.parse(analysis.positive_words) : analysis.positive_words).slice(0, 8).map((w: string, i: number) => (
                      <span key={i} className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-50 text-emerald-700 font-medium">{w}</span>
                    ))}
                  </div>
                </div>
              )}
              {analysis.negative_words && (
                <div>
                  <p className="text-[10px] text-red-600 font-semibold mb-1">ネガティブワード</p>
                  <div className="flex flex-wrap gap-1">
                    {(typeof analysis.negative_words === "string" ? JSON.parse(analysis.negative_words) : analysis.negative_words).slice(0, 8).map((w: string, i: number) => (
                      <span key={i} className="px-2 py-0.5 rounded-full text-[10px] bg-red-50 text-red-700 font-medium">{w}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {analysis.summary && <p className="text-xs text-slate-600 bg-slate-50 rounded-lg p-3">{analysis.summary}</p>}
          </div>
        )}

        {/* 最新口コミ */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 mb-6">
          <h3 className="text-xs font-semibold text-slate-500 mb-3">最新の口コミ</h3>
          {recentReviews.length === 0 ? (
            <p className="text-slate-400 text-xs text-center py-4">口コミデータがありません</p>
          ) : (
            <div className="space-y-3">
              {recentReviews.map((r, i) => (
                <div key={i} className={`rounded-lg p-3 border ${!r.reply_comment ? "border-amber-200 bg-amber-50/30" : "border-slate-100"}`}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-700">{r.reviewer_name}</span>
                      <span className="text-amber-400 text-xs">{"★".repeat(starToNum(r.star_rating))}{"☆".repeat(5 - starToNum(r.star_rating))}</span>
                    </div>
                    <span className="text-[10px] text-slate-400">{new Date(r.create_time).toLocaleDateString("ja-JP")}</span>
                  </div>
                  {r.comment && <p className="text-xs text-slate-600 line-clamp-2">{
                    r.comment.includes("(Original)") ? r.comment.split("(Original)").pop()?.trim() :
                    r.comment.split(/\s*\(Translated by Google\)\s*/)[0] || r.comment
                  }</p>}
                  {r.reply_comment && (
                    <div className="mt-2 bg-blue-50 rounded p-2 border border-blue-100">
                      <p className="text-[10px] text-blue-500 font-semibold">返信済み</p>
                      <p className="text-xs text-blue-700 line-clamp-2">{r.reply_comment}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* フッター */}
        <div className="text-center py-4">
          <p className="text-[10px] text-slate-400">Powered by SPOTLIGHT NAVIGATOR</p>
        </div>
      </div>
    </div>
  );
}
