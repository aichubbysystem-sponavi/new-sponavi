"use client";

import { aioData } from "@/lib/mock-data";

export default function AioPage() {
  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">AIO対策</h1>
          <p className="text-sm text-slate-500 mt-1">AI Overview・LLM最適化（AIO/LLMO）</p>
        </div>
        <button className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition">
          Q&A一括生成
        </button>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-gradient-to-br from-blue-500 to-blue-700 rounded-xl p-5 text-white">
          <p className="text-sm text-blue-100">AI Overview 表示回数</p>
          <p className="text-4xl font-bold mt-2">{aioData.aiOverviewAppearances}</p>
          <p className="text-xs text-blue-200 mt-1">今月（Google AI）</p>
        </div>
        <div className="bg-gradient-to-br from-purple-500 to-purple-700 rounded-xl p-5 text-white">
          <p className="text-sm text-purple-100">AIからの引用数</p>
          <p className="text-4xl font-bold mt-2">{aioData.aiCitations}</p>
          <p className="text-xs text-purple-200 mt-1">全AIプラットフォーム合計</p>
        </div>
        <div className="bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-xl p-5 text-white">
          <p className="text-sm text-emerald-100">Q&A登録数</p>
          <p className="text-4xl font-bold mt-2">{aioData.qAndA.length}</p>
          <p className="text-xs text-emerald-200 mt-1">推奨: 10件以上</p>
        </div>
      </div>

      {/* AI queries */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
          <h3 className="text-sm font-semibold text-slate-500 mb-4">AI検索で表示されたクエリ</h3>
          <div className="space-y-3">
            {aioData.topQueries.map((q, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-700">&ldquo;{q.query}&rdquo;</p>
                  <p className="text-xs text-slate-400 mt-0.5">表示回数: {q.appearances}回</p>
                </div>
                <span className={`badge ${
                  q.source === "Google AI" ? "badge-info" :
                  q.source === "ChatGPT" ? "badge-success" : "badge-purple"
                }`}>
                  {q.source}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Q&A */}
        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-500">Q&A管理</h3>
            <button className="text-xs px-3 py-1.5 bg-purple-50 text-purple-600 rounded-lg font-medium hover:bg-purple-100">
              + AI生成で追加
            </button>
          </div>
          <div className="space-y-3">
            {aioData.qAndA.map((qa, i) => (
              <div key={i} className="p-4 border border-slate-100 rounded-lg">
                <p className="text-sm font-medium text-slate-800 flex items-center gap-2">
                  <span className="text-blue-500">Q.</span>
                  {qa.question}
                </p>
                <p className="text-sm text-slate-600 mt-2 flex items-start gap-2">
                  <span className="text-emerald-500 font-medium">A.</span>
                  <span>{qa.answer}</span>
                </p>
                <div className="flex gap-2 mt-2">
                  <button className="text-[10px] px-2 py-1 bg-slate-100 text-slate-500 rounded hover:bg-slate-200">編集</button>
                  <button className="text-[10px] px-2 py-1 bg-slate-100 text-slate-500 rounded hover:bg-slate-200">GBPに反映</button>
                </div>
              </div>
            ))}
          </div>

          {/* Recommendation */}
          <div className="mt-4 p-3 bg-amber-50 rounded-lg border border-amber-100">
            <p className="text-xs font-medium text-amber-700">💡 推奨アクション</p>
            <p className="text-xs text-amber-600 mt-1">
              Q&Aが3件のみです。AIO対策として10件以上が推奨されます。
              「Q&A一括生成」でヒアリングシートの情報からAIが自動生成できます。
            </p>
          </div>
        </div>
      </div>

      {/* 口コミの返信内容に各店舗別にAIO対策として、定型文を挿入 */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 mb-6">
        <h3 className="text-sm font-semibold text-slate-500 mb-4">口コミの返信内容に各店舗別にAIO対策として、定型文を挿入</h3>
        <p className="text-xs text-slate-400 mb-4">店舗別のAIO定型文テンプレをDB管理→口コミ返信時に自動挿入</p>
        <div className="space-y-3">
          {[
            { store: "焼肉ダイニング 炎 渋谷店", template: "渋谷で焼肉をお探しなら、A5和牛が自慢の当店へ。道玄坂徒歩5分、個室完備でデートにも最適です。", active: true },
            { store: "焼肉ダイニング 炎 新宿店", template: "新宿で本格焼肉なら当店へ。厳選和牛と落ち着いた個室空間で、接待やお祝いにもご利用いただけます。", active: true },
            { store: "焼肉ダイニング 炎 池袋店", template: "池袋駅東口すぐの焼肉ダイニング炎。ランチセットも好評、ファミリーでのご利用も歓迎です。", active: false },
          ].map((s) => (
            <div key={s.store} className="p-4 border border-slate-100 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-slate-700">{s.store}</p>
                <span className={`badge ${s.active ? "badge-success" : "badge-warning"}`}>{s.active ? "有効" : "無効"}</span>
              </div>
              <p className="text-xs text-slate-500 bg-slate-50 rounded p-2">{s.template}</p>
              <div className="flex gap-2 mt-2">
                <button className="text-[10px] px-2 py-1 bg-blue-50 text-blue-600 rounded">編集</button>
                <button className="text-[10px] px-2 py-1 bg-slate-100 text-slate-500 rounded">{s.active ? "無効化" : "有効化"}</button>
              </div>
            </div>
          ))}
        </div>
        <button className="mt-4 px-4 py-2 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 transition">
          + 店舗別テンプレートを追加
        </button>
      </div>

      {/* AIにどのような検索ワードで表示、クリックされたか */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 mb-6">
        <h3 className="text-sm font-semibold text-slate-500 mb-4">AIにどのような検索ワードで表示、クリックされたか</h3>
        <p className="text-xs text-slate-400 mb-4">AI検索の監視データから検索ワード別に表示/クリック回数を集計</p>
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-xs text-slate-400 text-left py-2 font-medium">検索ワード</th>
              <th className="text-xs text-slate-400 text-center py-2 font-medium">表示回数</th>
              <th className="text-xs text-slate-400 text-center py-2 font-medium">クリック数</th>
              <th className="text-xs text-slate-400 text-center py-2 font-medium">CTR</th>
              <th className="text-xs text-slate-400 text-left py-2 font-medium">AIソース</th>
            </tr>
          </thead>
          <tbody>
            {[
              { keyword: "渋谷 焼肉 おすすめ", views: 89, clicks: 14, ctr: "15.7%", source: "Google AI / ChatGPT" },
              { keyword: "道玄坂 焼肉 個室", views: 52, clicks: 8, ctr: "15.4%", source: "Gemini / Perplexity" },
              { keyword: "渋谷 和牛 デート", views: 41, clicks: 6, ctr: "14.6%", source: "ChatGPT / Copilot" },
              { keyword: "shibuya yakiniku", views: 34, clicks: 5, ctr: "14.7%", source: "ChatGPT / Perplexity" },
              { keyword: "渋谷 焼肉 ランチ", views: 28, clicks: 3, ctr: "10.7%", source: "Google AI" },
            ].map((row) => (
              <tr key={row.keyword} className="border-b border-slate-50">
                <td className="py-3 text-sm font-medium text-slate-700">{row.keyword}</td>
                <td className="py-3 text-center text-sm text-slate-600">{row.views}</td>
                <td className="py-3 text-center text-sm text-slate-600">{row.clicks}</td>
                <td className="py-3 text-center text-sm font-bold text-blue-600">{row.ctr}</td>
                <td className="py-3 text-xs text-slate-500">{row.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* AI別 表示・クリック内訳 */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 mb-6">
        <h3 className="text-sm font-semibold text-slate-500 mb-4">AIプラットフォーム別 表示・クリック内訳</h3>
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-xs text-slate-400 text-left py-2 font-medium">AIプラットフォーム</th>
              <th className="text-xs text-slate-400 text-center py-2 font-medium">表示回数</th>
              <th className="text-xs text-slate-400 text-center py-2 font-medium">クリック数</th>
              <th className="text-xs text-slate-400 text-center py-2 font-medium">CTR</th>
              <th className="text-xs text-slate-400 text-left py-2 font-medium">主な検索ワード</th>
            </tr>
          </thead>
          <tbody>
            {[
              { platform: "Google AI Overview", views: 142, clicks: 23, ctr: "16.2%", keywords: "渋谷 焼肉 おすすめ, 道玄坂 焼肉" },
              { platform: "ChatGPT", views: 89, clicks: 12, ctr: "13.5%", keywords: "shibuya yakiniku, 渋谷 焼肉 個室" },
              { platform: "Gemini", views: 67, clicks: 8, ctr: "11.9%", keywords: "渋谷 焼肉 デート, 渋谷 和牛" },
              { platform: "Perplexity", views: 34, clicks: 5, ctr: "14.7%", keywords: "渋谷区 おすすめ焼肉" },
              { platform: "Copilot", views: 21, clicks: 3, ctr: "14.3%", keywords: "shibuya beef restaurant" },
            ].map((row) => (
              <tr key={row.platform} className="border-b border-slate-50">
                <td className="py-3 text-sm font-medium text-slate-700">{row.platform}</td>
                <td className="py-3 text-center text-sm text-slate-600">{row.views}</td>
                <td className="py-3 text-center text-sm text-slate-600">{row.clicks}</td>
                <td className="py-3 text-center text-sm font-bold text-blue-600">{row.ctr}</td>
                <td className="py-3 text-xs text-slate-500">{row.keywords}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-slate-400 mt-3">任意の期間で絞り込み可能。どのAIに何回表示・クリックされたか、どの検索ワードで表示されたかを詳細分析。</p>
      </div>

      {/* Schema markup */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
        <h3 className="text-sm font-semibold text-slate-500 mb-4">構造化データ（Schema）ステータス</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 border border-emerald-100 bg-emerald-50/50 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-sm font-medium text-emerald-700">LocalBusiness</span>
            </div>
            <p className="text-xs text-emerald-600">設定済み - NAP情報を正確に記述</p>
          </div>
          <div className="p-4 border border-amber-100 bg-amber-50/50 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <span className="text-sm font-medium text-amber-700">Restaurant</span>
            </div>
            <p className="text-xs text-amber-600">一部設定 - メニュー情報の追加推奨</p>
          </div>
          <div className="p-4 border border-red-100 bg-red-50/50 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2 h-2 rounded-full bg-red-500" />
              <span className="text-sm font-medium text-red-700">FAQPage</span>
            </div>
            <p className="text-xs text-red-600">未設定 - Q&Aの構造化データを追加推奨</p>
          </div>
        </div>
        <button className="mt-4 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition">
          構造化データを自動最適化
        </button>
      </div>
    </div>
  );
}
