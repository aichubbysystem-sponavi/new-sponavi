"use client";

import { useState } from "react";
import { diagnosisItems, currentStore } from "@/lib/mock-data";

export default function DiagnosisPage() {
  const [diagnosisUrl, setDiagnosisUrl] = useState("");
  const [showResults, setShowResults] = useState(true);

  const overallScore = Math.round(
    diagnosisItems.reduce((sum, item) => sum + item.score, 0) / diagnosisItems.length
  );

  const goodCount = diagnosisItems.filter((i) => i.status === "good").length;
  const warningCount = diagnosisItems.filter((i) => i.status === "warning").length;
  const dangerCount = diagnosisItems.filter((i) => i.status === "danger").length;

  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">店舗診断</h1>
        <p className="text-sm text-slate-500 mt-1">GBPの状態をスコアリングして改善点を可視化</p>
      </div>

      {/* Search bar */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 mb-6">
        <h3 className="text-sm font-semibold text-slate-500 mb-3">店舗を診断する</h3>
        <div className="flex gap-3">
          <input
            type="text"
            className="flex-1 text-sm border border-slate-200 rounded-lg px-4 py-2.5"
            placeholder="Googleマップのリンク or 正式な店舗名を入力..."
            value={diagnosisUrl}
            onChange={(e) => setDiagnosisUrl(e.target.value)}
          />
          <button
            onClick={() => setShowResults(true)}
            className="px-6 py-2.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition font-medium"
          >
            診断する
          </button>
        </div>
      </div>

      {showResults && (
        <>
          {/* Score overview */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 text-center">
              <p className="text-sm text-slate-500 mb-2">総合スコア</p>
              <p className={`text-5xl font-bold ${
                overallScore >= 70 ? "text-emerald-600" : overallScore >= 50 ? "text-amber-600" : "text-red-600"
              }`}>
                {overallScore}
              </p>
              <p className="text-xs text-slate-400 mt-1">/ 100点</p>
            </div>
            <div className="bg-emerald-50 rounded-xl p-6 shadow-sm border border-emerald-100 text-center">
              <p className="text-sm text-emerald-600 mb-2">良好</p>
              <p className="text-4xl font-bold text-emerald-600">{goodCount}</p>
              <p className="text-xs text-emerald-500 mt-1">項目</p>
            </div>
            <div className="bg-amber-50 rounded-xl p-6 shadow-sm border border-amber-100 text-center">
              <p className="text-sm text-amber-600 mb-2">改善推奨</p>
              <p className="text-4xl font-bold text-amber-600">{warningCount}</p>
              <p className="text-xs text-amber-500 mt-1">項目</p>
            </div>
            <div className="bg-red-50 rounded-xl p-6 shadow-sm border border-red-100 text-center">
              <p className="text-sm text-red-600 mb-2">要対策</p>
              <p className="text-4xl font-bold text-red-600">{dangerCount}</p>
              <p className="text-xs text-red-500 mt-1">項目</p>
            </div>
          </div>

          {/* Diagnosis items */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-100">
            <div className="p-5 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-500">診断結果詳細 — {currentStore.name}</h3>
            </div>
            <div className="divide-y divide-slate-50">
              {diagnosisItems
                .sort((a, b) => a.score - b.score)
                .map((item) => (
                  <div key={item.item} className="p-5 flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold ${
                      item.status === "good" ? "bg-emerald-100 text-emerald-600" :
                      item.status === "warning" ? "bg-amber-100 text-amber-600" :
                      "bg-red-100 text-red-600"
                    }`}>
                      {item.score}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-medium text-slate-800">{item.item}</h4>
                        <span className={`badge ${
                          item.status === "good" ? "badge-success" :
                          item.status === "warning" ? "badge-warning" : "badge-danger"
                        }`}>
                          {item.status === "good" ? "良好" :
                           item.status === "warning" ? "改善推奨" : "要対策"}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">{item.detail}</p>
                      {/* Progress bar */}
                      <div className="mt-2 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            item.status === "good" ? "bg-emerald-500" :
                            item.status === "warning" ? "bg-amber-500" : "bg-red-500"
                          }`}
                          style={{ width: `${item.score}%` }}
                        />
                      </div>
                    </div>
                    <button className="text-xs px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg font-medium hover:bg-blue-100 transition whitespace-nowrap">
                      改善する
                    </button>
                  </div>
                ))}
            </div>
          </div>

          {/* P-MAX recommendation */}
          <div className="mt-6 bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl p-6 text-white">
            <h3 className="text-lg font-bold mb-2">P-MAX広告の推奨</h3>
            <p className="text-sm text-blue-100 mb-4">
              この店舗のMEOスコアと検索ボリュームから、P-MAX広告の出稿が効果的と判断されます。
              月間推定ROASは320%で、月額予算5万円から開始が推奨されます。
            </p>
            <div className="flex gap-3">
              <button className="px-4 py-2 bg-white text-blue-600 text-sm rounded-lg font-medium hover:bg-blue-50 transition">
                P-MAX設定を開始
              </button>
              <button className="px-4 py-2 bg-white/20 text-white text-sm rounded-lg font-medium hover:bg-white/30 transition">
                詳細を見る
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
