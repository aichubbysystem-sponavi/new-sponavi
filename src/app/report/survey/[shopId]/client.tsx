"use client";

import { useState } from "react";

const QUESTIONS = [
  { id: "overall", question: "全体的な満足度はいかがでしたか？", options: ["とても満足", "満足", "普通", "やや不満", "不満"] },
  { id: "service", question: "接客・サービスはいかがでしたか？", options: ["とても良かった", "良かった", "普通", "少し気になった", "改善してほしい"] },
  { id: "quality", question: "商品・料理の品質はいかがでしたか？", options: ["非常に良い", "良い", "普通", "もう少し", "改善希望"] },
  { id: "atmosphere", question: "お店の雰囲気・清潔感はいかがでしたか？", options: ["とても良い", "良い", "普通", "気になった", "改善希望"] },
  { id: "value", question: "価格に対する満足度は？", options: ["とてもお得", "適正", "普通", "やや高い", "高い"] },
  { id: "recommend", question: "友人・知人に勧めたいですか？", options: ["ぜひ勧めたい", "勧めたい", "どちらとも", "あまり勧めない", "勧めない"] },
  { id: "freetext", question: "その他、ご感想やご要望があればお聞かせください", options: [] },
];

export default function SurveyForm({ shopId, shopName }: { shopId: string; shopName: string }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [rating, setRating] = useState(0);
  const [step, setStep] = useState<"form" | "loading" | "result">("form");
  const [result, setResult] = useState<{ action: string; reviewText: string; googleReviewUrl?: string; message: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSubmit = async () => {
    if (rating === 0) return;
    setStep("loading");
    try {
      const res = await fetch("/api/report/survey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopId,
          shopName,
          rating,
          answers: QUESTIONS.filter((q) => answers[q.id]).map((q) => ({
            question: q.question,
            answer: answers[q.id],
          })),
        }),
      });
      const data = await res.json();
      setResult(data);
      setStep("result");
    } catch {
      setStep("form");
    }
  };

  if (step === "loading") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl p-8 shadow-lg text-center max-w-md">
          <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-600">回答を送信中...</p>
        </div>
      </div>
    );
  }

  if (step === "result" && result) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl p-8 shadow-lg max-w-lg w-full">
          <div className="text-center mb-6">
            <div className="text-4xl mb-3">{result.action === "google" ? "🎉" : "🙏"}</div>
            <h2 className="text-xl font-bold text-gray-800">{result.message}</h2>
          </div>

          {result.reviewText && (
            <div className="bg-gray-50 rounded-xl p-4 mb-6">
              <p className="text-xs text-gray-500 mb-2 font-semibold">
                {result.action === "google" ? "口コミ文（コピーしてGoogleに貼り付け）" : "ご回答内容"}
              </p>
              <p className="text-sm text-gray-700 leading-relaxed">{result.reviewText}</p>
              {result.action === "google" && (
                <button onClick={() => { navigator.clipboard.writeText(result.reviewText); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                  className="mt-3 px-4 py-2 rounded-lg text-xs font-semibold bg-blue-100 text-blue-700 hover:bg-blue-200 transition w-full">
                  {copied ? "コピーしました!" : "口コミ文をコピー"}
                </button>
              )}
            </div>
          )}

          {result.action === "google" && result.googleReviewUrl && (
            <a href={result.googleReviewUrl} target="_blank" rel="noopener noreferrer"
              className="block w-full text-center px-6 py-3 rounded-xl text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 transition shadow-md">
              Googleマップで口コミを投稿する →
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 py-8 px-4">
      <div className="max-w-lg mx-auto">
        {/* ヘッダー */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-800">{shopName}</h1>
          <p className="text-sm text-gray-500 mt-1">ご来店ありがとうございました</p>
          <p className="text-xs text-gray-400 mt-0.5">簡単なアンケートにご協力ください（1分）</p>
        </div>

        {/* 評価 */}
        <div className="bg-white rounded-2xl p-6 shadow-lg mb-4">
          <p className="text-sm font-semibold text-gray-700 mb-3">総合評価 *</p>
          <div className="flex justify-center gap-2">
            {[1, 2, 3, 4, 5].map((star) => (
              <button key={star} onClick={() => setRating(star)}
                className={`text-3xl transition-transform hover:scale-110 ${star <= rating ? "text-yellow-400" : "text-gray-300"}`}>
                ★
              </button>
            ))}
          </div>
          {rating > 0 && (
            <p className="text-center text-xs text-gray-400 mt-2">
              {rating >= 5 ? "最高の評価をありがとうございます！" : rating >= 4 ? "ありがとうございます！" : rating >= 3 ? "ご意見を改善に活かします" : "貴重なご意見をありがとうございます"}
            </p>
          )}
        </div>

        {/* 質問 */}
        {QUESTIONS.map((q) => (
          <div key={q.id} className="bg-white rounded-2xl p-5 shadow-lg mb-3">
            <p className="text-sm font-semibold text-gray-700 mb-3">{q.question}</p>
            {q.options.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {q.options.map((opt) => (
                  <button key={opt} onClick={() => setAnswers({ ...answers, [q.id]: opt })}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${
                      answers[q.id] === opt
                        ? "bg-blue-600 text-white shadow-sm"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}>
                    {opt}
                  </button>
                ))}
              </div>
            ) : (
              <textarea value={answers[q.id] || ""} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                placeholder="自由にお書きください（任意）"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-300" rows={3} />
            )}
          </div>
        ))}

        {/* 送信ボタン */}
        <button onClick={handleSubmit} disabled={rating === 0}
          className={`w-full py-3.5 rounded-xl text-sm font-bold transition shadow-md mt-4 ${
            rating === 0 ? "bg-gray-200 text-gray-400" : "bg-blue-600 text-white hover:bg-blue-700"
          }`}>
          回答を送信する
        </button>
        <p className="text-[10px] text-gray-400 text-center mt-3">※ 回答内容はサービス改善のために利用されます</p>
      </div>
    </div>
  );
}
