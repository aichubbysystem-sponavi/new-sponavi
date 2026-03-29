"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line,
} from "recharts";
import { reviews as mockReviews, reviewTrend, reviewRatingDistribution, sentimentAnalysis, wordCloud } from "@/lib/mock-data";
import { featureDetails } from "@/lib/feature-details";
import api from "@/lib/api";

export default function ReviewsPage() {
  const [selectedReview, setSelectedReview] = useState<number | null>(null);
  const [selectedReply, setSelectedReply] = useState<number | null>(null);
  const [reviews, setReviews] = useState(mockReviews);
  const [apiConnected, setApiConnected] = useState(false);

  const fetchReviews = useCallback(async () => {
    try {
      const res = await api.get("/api/reviews");
      if (Array.isArray(res.data) && res.data.length > 0) {
        setReviews(res.data);
        setApiConnected(true);
      }
    } catch {
      // API未接続時はモックデータを使用
    }
  }, []);

  useEffect(() => { fetchReviews(); }, [fetchReviews]);

  return (
    <div className="animate-fade-in">
      {!apiConnected && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <span className="text-amber-600 text-sm">Go APIに未接続のため、デモデータを表示しています</span>
        </div>
      )}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">口コミ管理</h1>
          <p className="text-sm text-slate-500 mt-1">口コミの確認・AI返信・分析</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="badge badge-danger">未返信: 3件</span>
          <button className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition">
            アンケートリンク生成
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Rating distribution */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
          <h3 className="text-sm font-semibold text-slate-500 mb-3">評価分布</h3>
          <div className="space-y-2">
            {reviewRatingDistribution.map((r) => (
              <div key={r.rating} className="flex items-center gap-2">
                <span className="text-sm w-8 text-yellow-500 font-medium">{r.rating}</span>
                <div className="flex-1 h-5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-yellow-400 rounded-full"
                    style={{ width: `${r.percentage}%` }}
                  />
                </div>
                <span className="text-xs text-slate-500 w-12 text-right">{r.count}件</span>
              </div>
            ))}
          </div>
        </div>

        {/* Trend chart */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
          <h3 className="text-sm font-semibold text-slate-500 mb-3">口コミ推移</h3>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={reviewTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line type="monotone" dataKey="件数" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Sentiment */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
          <h3 className="text-sm font-semibold text-slate-500 mb-3">口コミ内容分析</h3>
          <div className="space-y-3">
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-sm text-emerald-600 font-medium">ポジティブ</span>
                <span className="text-sm font-bold text-emerald-600">{sentimentAnalysis.positive.percentage}%</span>
              </div>
              <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${sentimentAnalysis.positive.percentage}%` }} />
              </div>
              <div className="flex gap-1 mt-1 flex-wrap">
                {sentimentAnalysis.positive.topics.map((t) => (
                  <span key={t} className="text-[10px] bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded">{t}</span>
                ))}
              </div>
            </div>
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-sm text-amber-600 font-medium">中立</span>
                <span className="text-sm font-bold text-amber-600">{sentimentAnalysis.neutral.percentage}%</span>
              </div>
              <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-amber-500 rounded-full" style={{ width: `${sentimentAnalysis.neutral.percentage}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-sm text-red-600 font-medium">ネガティブ</span>
                <span className="text-sm font-bold text-red-600">{sentimentAnalysis.negative.percentage}%</span>
              </div>
              <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-red-500 rounded-full" style={{ width: `${sentimentAnalysis.negative.percentage}%` }} />
              </div>
              <div className="flex gap-1 mt-1 flex-wrap">
                {sentimentAnalysis.negative.topics.map((t) => (
                  <span key={t} className="text-[10px] bg-red-50 text-red-600 px-1.5 py-0.5 rounded">{t}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Word cloud */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 mb-6">
        <h3 className="text-sm font-semibold text-slate-500 mb-3">口コミキーワード</h3>
        <div className="flex flex-wrap gap-2 justify-center py-3">
          {wordCloud.map((w) => (
            <span
              key={w.word}
              className="px-3 py-1 rounded-full bg-blue-50 text-blue-700 font-medium cursor-pointer hover:bg-blue-100 transition"
              style={{ fontSize: `${Math.max(12, Math.min(24, w.count / 4 + 8))}px` }}
            >
              {w.word}
              <span className="text-blue-400 text-xs ml-1">({w.count})</span>
            </span>
          ))}
        </div>
      </div>

      {/* Reviews list */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-500">口コミ一覧</h3>
          <div className="flex gap-2">
            <button className="text-xs px-3 py-1.5 bg-red-50 text-red-600 rounded-lg font-medium hover:bg-red-100">未返信のみ</button>
            <button className="text-xs px-3 py-1.5 bg-slate-50 text-slate-600 rounded-lg font-medium hover:bg-slate-100">すべて</button>
          </div>
        </div>

        <div className="divide-y divide-slate-50">
          {reviews.map((review) => (
            <div key={review.id} className="p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white text-sm font-bold">
                    {review.author[0]}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-slate-800">{review.author}</span>
                      <span className="text-xs text-slate-400">{review.date}</span>
                      {review.language !== "ja" && (
                        <span className="badge badge-purple">{review.language.toUpperCase()}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <span key={i} className={i < review.rating ? "star" : "star-empty"}>★</span>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {review.topics.map((t) => (
                    <span key={t} className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{t}</span>
                  ))}
                  {review.replied ? (
                    <span className="badge badge-success">返信済み</span>
                  ) : (
                    <span className="badge badge-danger">未返信</span>
                  )}
                </div>
              </div>

              <p className="text-sm text-slate-600 mt-3 leading-relaxed">{review.text}</p>

              {/* AI Reply section */}
              {!review.replied && review.aiReplies.length > 0 && (
                <div className="mt-4 bg-blue-50/50 rounded-lg p-4 border border-blue-100">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-sm">🤖</span>
                    <span className="text-sm font-semibold text-blue-700">AI返信候補</span>
                    <span className="text-xs text-blue-400">（クリックで選択）</span>
                  </div>
                  <div className="space-y-2">
                    {review.aiReplies.map((reply, i) => (
                      <div
                        key={i}
                        onClick={() => {
                          setSelectedReview(review.id);
                          setSelectedReply(i);
                        }}
                        className={`p-3 rounded-lg cursor-pointer transition text-sm leading-relaxed ${
                          selectedReview === review.id && selectedReply === i
                            ? "bg-blue-100 border-2 border-blue-400 text-blue-800"
                            : "bg-white border border-blue-100 text-slate-600 hover:border-blue-300"
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-bold text-blue-500">候補 {i + 1}</span>
                        </div>
                        {reply}
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 mt-3">
                    <button className="flex-1 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition font-medium">
                      選択した返信を送信
                    </button>
                    <button className="px-4 py-2 bg-white text-blue-600 text-sm rounded-lg border border-blue-200 hover:bg-blue-50 transition">
                      再生成
                    </button>
                    <button className="px-4 py-2 bg-white text-slate-600 text-sm rounded-lg border border-slate-200 hover:bg-slate-50 transition">
                      編集
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Enquete link */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 mt-6 mb-6">
        <h3 className="text-sm font-semibold text-slate-500 mb-3">アンケートによる口コミ獲得</h3>
        <p className="text-xs text-slate-400 mb-3">
          お客様がアンケートに回答すると口コミ文章が自動生成。★3以下は自社システムに反映、★4以上はGoogleマップに誘導。
        </p>
        <div className="flex gap-3">
          <button className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition">
            アンケートリンクを生成
          </button>
          <button className="px-4 py-2 border border-slate-200 text-sm rounded-lg hover:bg-slate-50 transition">
            QRコードを生成
          </button>
        </div>
      </div>

      {/* All review features */}
      <h3 className="text-sm font-semibold text-slate-500 mb-3">口コミ管理 全機能</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {[
          { icon: "🤖", title: "AI自動返信", desc: "口コミに対してAIで返信内容を考え自動返信。NGワード・AIOテンプレ対応。" },
          { icon: "✋", title: "半自動返信", desc: "1つの口コミに対して5つほど返信候補を生成。クリックで返信、編集・再生成も可能。" },
          { icon: "🔔", title: "未返信件数お知らせ", desc: "未返信の口コミが何件あるかパッと見てわかる通知表示。" },
          { icon: "📊", title: "口コミ評価推移", desc: "評価の上下をグラフで表示。3.5の重要ラインに赤線表示。" },
          { icon: "📈", title: "口コミ増加量推移", desc: "いつ何件増えたかをグラフ表示。期間で絞り込み可能。" },
          { icon: "🏪", title: "競合店舗の月間口コミ返信率", desc: "競合の全体口コミに対する返信率を表示。" },
          { icon: "🔍", title: "口コミの内容分析", desc: "接客・内装・料理・サービス等のカテゴリ別に良い/悪い口コミを分析。" },
          { icon: "📋", title: "アンケートによる口コミ獲得", desc: "アンケート回答で口コミ文章を生成。★3以下は自社、★4以上はGoogleへ誘導。" },
          { icon: "🌍", title: "多言語対応", desc: "返信文の候補を決定したら口コミと同じ言語に翻訳して返信。" },
          { icon: "🤖", title: "LLMO最適なQ&A・返信文作成", desc: "AIOに適した口コミ返信文テンプレートを自動作成。" },
          { icon: "🏆", title: "いい口コミキーワードランキング", desc: "料理・接客等、何で喜ばれているかをランキング表示。" },
          { icon: "💬", title: "口コミハイライト", desc: "レビューに多く含まれるワードをGOOD/BADで可視化。" },
        ].map((f, i) => {
          const feature = featureDetails.find((fd) => fd.title === f.title);
          const inner = (
            <div className="p-3 border border-slate-100 rounded-lg bg-white flex items-start gap-3 hover:shadow-md hover:border-blue-200 transition-all cursor-pointer group">
              <span className="text-lg">{f.icon}</span>
              <div className="flex-1">
                <p className="text-xs font-semibold text-slate-700">{f.title}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">{f.desc}</p>
              </div>
              <span className="opacity-0 group-hover:opacity-100 text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded transition whitespace-nowrap">詳細 →</span>
            </div>
          );
          return feature ? (
            <Link key={i} href={`/feature/${feature.slug}/`}>{inner}</Link>
          ) : (
            <div key={i}>{inner}</div>
          );
        })}
      </div>
    </div>
  );
}
