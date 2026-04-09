"use client";

import { useState, useEffect, useCallback } from "react";
import { useShop } from "@/components/shop-provider";
import api from "@/lib/api";

interface Question {
  name?: string;
  author?: { displayName?: string };
  text?: string;
  createTime?: string;
  updateTime?: string;
  totalAnswerCount?: number;
  topAnswers?: { author?: { displayName?: string }; text?: string; createTime?: string }[];
}

export default function AioPage() {
  const { apiConnected, selectedShopId } = useShop();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchQuestions = useCallback(async () => {
    if (!selectedShopId) return;
    setLoading(true);
    try {
      const res = await api.get(`/api/shop/${selectedShopId}/question`);
      setQuestions(res.data?.questions || []);
    } catch { setQuestions([]); }
    finally { setLoading(false); }
  }, [selectedShopId]);

  useEffect(() => { fetchQuestions(); }, [fetchQuestions]);

  return (
    <div className="animate-fade-in">
      <h1 className="text-2xl font-bold text-slate-800 mb-2">AIO対策</h1>
      <p className="text-sm text-slate-500 mb-6">Q&A管理・AI Overview対策</p>

      {!apiConnected || !selectedShopId ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">{apiConnected ? "店舗を選択してください" : "Go APIに接続し、店舗を登録すると利用できます"}</p>
        </div>
      ) : loading ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">読み込み中...</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100">
          <div className="p-4 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-500">GBP Q&A（{questions.length}件）</h3>
          </div>
          {questions.length === 0 ? (
            <div className="p-12 text-center"><p className="text-slate-400 text-sm">Q&Aデータがありません</p></div>
          ) : (
            <div className="divide-y divide-slate-50">
              {questions.map((q, i) => (
                <div key={i} className="p-4">
                  <div className="flex items-start gap-3">
                    <span className="text-lg text-[#003D6B] font-bold mt-0.5">Q</span>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-slate-500">{q.author?.displayName || "匿名"}</span>
                        <span className="text-xs text-slate-400">{q.createTime ? new Date(q.createTime).toLocaleDateString("ja-JP") : ""}</span>
                      </div>
                      <p className="text-sm text-slate-800 font-medium">{q.text || "（質問テキストなし）"}</p>
                      {q.topAnswers && q.topAnswers.length > 0 && (
                        <div className="mt-3 space-y-2">
                          {q.topAnswers.map((a, j) => (
                            <div key={j} className="flex items-start gap-2 bg-blue-50 rounded-lg p-3">
                              <span className="text-sm text-blue-600 font-bold">A</span>
                              <div>
                                <p className="text-xs text-blue-500 mb-0.5">{a.author?.displayName || "オーナー"}</p>
                                <p className="text-sm text-blue-800">{a.text}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {(!q.topAnswers || q.topAnswers.length === 0) && (
                        <p className="text-xs text-amber-500 mt-2">⚠ 未回答</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
