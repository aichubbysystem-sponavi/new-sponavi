"use client";

import { useState, useEffect, useCallback } from "react";
import { useShop } from "@/components/shop-provider";
import api from "@/lib/api";

interface Question {
  name?: string;
  author?: { displayName?: string };
  text?: string;
  createTime?: string;
  topAnswers?: { author?: { displayName?: string }; text?: string }[];
}

export default function AioPage() {
  const { apiConnected, selectedShopId, selectedShop } = useShop();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [suggestions, setSuggestions] = useState<{ q: string; a: string }[]>([]);
  const [msg, setMsg] = useState("");

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

  // AI Q&A生成
  const generateQA = async () => {
    if (!selectedShop) return;
    setGenerating(true);
    setSuggestions([]);
    try {
      const res = await api.post("/api/report/reply-suggest", {
        comment: `店舗「${selectedShop.name}」のGoogleビジネスプロフィールのQ&Aセクションに掲載する、MEO対策・AIO対策に効果的な質問と回答を5組作成してください。

以下の形式で出力:
Q1: (質問)
A1: (回答)
Q2: (質問)
A2: (回答)
...

条件:
- 実際のお客様が検索しそうな自然な質問
- 回答に店舗の業種に関連するキーワードを自然に含める
- 各回答は80〜150文字
- AI Overviewに引用されやすい具体的で簡潔な回答`,
        starRating: 5,
        shopName: selectedShop.name,
      }, { timeout: 30000 });

      const text = res.data.reply || "";
      const pairs: { q: string; a: string }[] = [];
      const qMatches = text.match(/Q\d+[:：]\s*(.+)/g) || [];
      const aMatches = text.match(/A\d+[:：]\s*(.+)/g) || [];
      for (let i = 0; i < Math.min(qMatches.length, aMatches.length); i++) {
        pairs.push({
          q: qMatches[i].replace(/Q\d+[:：]\s*/, "").trim(),
          a: aMatches[i].replace(/A\d+[:：]\s*/, "").trim(),
        });
      }
      setSuggestions(pairs.length > 0 ? pairs : [{ q: text.slice(0, 100), a: "パース失敗。上のテキストを手動で使用してください。" }]);
    } catch (e: any) {
      setMsg(`Q&A生成失敗: ${e?.message}`);
    } finally {
      setGenerating(false);
    }
  };

  const unanswered = questions.filter((q) => !q.topAnswers || q.topAnswers.length === 0).length;

  return (
    <div className="animate-fade-in">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-slate-800">AIO対策・Q&A管理</h1>
        <p className="text-sm text-slate-500 mt-1">GBP Q&Aの管理・AI Overview対策のQ&A自動生成</p>
      </div>

      {msg && <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-700">{msg}</div>}

      {!apiConnected || !selectedShopId ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">{apiConnected ? "店舗を選択してください" : "Go APIに接続してください"}</p>
        </div>
      ) : (
        <>
          {/* KPI */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
              <p className="text-[11px] font-medium text-slate-400 mb-1">Q&A数</p>
              <p className="text-2xl font-bold text-[#003D6B]">{questions.length}<span className="text-xs font-normal text-slate-400 ml-1">件</span></p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
              <p className="text-[11px] font-medium text-slate-400 mb-1">未回答</p>
              <p className={`text-2xl font-bold ${unanswered > 0 ? "text-red-600" : "text-emerald-600"}`}>{unanswered}</p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
              <p className="text-[11px] font-medium text-slate-400 mb-1">AIO対策提案</p>
              <p className="text-2xl font-bold text-purple-600">{suggestions.length}<span className="text-xs font-normal text-slate-400 ml-1">件</span></p>
            </div>
          </div>

          {/* AI Q&A生成 */}
          <div className="bg-purple-50 rounded-xl p-5 shadow-sm border border-purple-200 mb-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-semibold text-purple-700">AIO対策 Q&A自動生成</h3>
                <p className="text-xs text-purple-500 mt-0.5">AI Overviewに引用されやすいQ&Aをクロードが生成します</p>
              </div>
              <button onClick={generateQA} disabled={generating}
                className={`px-5 py-2.5 rounded-lg text-sm font-semibold ${generating ? "bg-slate-200 text-slate-400" : "bg-purple-600 hover:bg-purple-700"}`}
                style={{ color: generating ? undefined : "#fff" }}>
                {generating ? "生成中..." : "Q&Aを生成"}
              </button>
            </div>

            {suggestions.length > 0 && (
              <div className="space-y-3 mt-4">
                {suggestions.map((s, i) => (
                  <div key={i} className="bg-white rounded-lg p-4 border border-purple-100">
                    <div className="flex items-start gap-2 mb-2">
                      <span className="text-purple-600 font-bold text-sm">Q{i + 1}</span>
                      <p className="text-sm text-slate-800 font-medium">{s.q}</p>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-emerald-600 font-bold text-sm">A{i + 1}</span>
                      <p className="text-sm text-slate-600">{s.a}</p>
                    </div>
                    <button onClick={() => navigator.clipboard.writeText(`Q: ${s.q}\nA: ${s.a}`)}
                      className="mt-2 text-[10px] text-purple-500 hover:text-purple-700 px-2 py-0.5 rounded bg-purple-50 border border-purple-200">
                      コピー
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 既存Q&A一覧 */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-100">
            <div className="p-4 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-500">GBP Q&A一覧（{questions.length}件）</h3>
            </div>
            {loading ? (
              <div className="p-12 text-center"><p className="text-slate-400 text-sm">読み込み中...</p></div>
            ) : questions.length === 0 ? (
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
                        {q.topAnswers && q.topAnswers.length > 0 ? (
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
                        ) : (
                          <p className="text-xs text-red-500 mt-2">⚠ 未回答</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
