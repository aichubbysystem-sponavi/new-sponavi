"use client";

import FeatureCard from "@/components/feature-card";

const diagnosisResult = {
  storeName: "焼肉ダイニング 炎 渋谷店",
  score: 78,
  reviewCount: 287,
  avgRating: 4.2,
  photoCount: 45,
  postFrequency: "週1回",
  napConsistency: "要改善",
  pmaxRecommend: true,
};

const leadList = [
  { company: "渋谷イタリアン ベラ", score: 92, status: "HOT", lastAction: "3/15 診断実施", email: "bella@example.com" },
  { company: "カフェ モーニング 表参道", score: 78, status: "WARM", lastAction: "3/12 資料DL", email: "morning@example.com" },
  { company: "鮨処 さかえ 新宿", score: 65, status: "WARM", lastAction: "3/10 診断実施", email: "sakae@example.com" },
  { company: "美容室 BLOOM 代官山", score: 45, status: "COLD", lastAction: "3/5 サイト訪問", email: "bloom@example.com" },
  { company: "焼き鳥 とり源 池袋", score: 88, status: "HOT", lastAction: "3/16 問い合わせ", email: "torigen@example.com" },
];

export default function LeadPage() {
  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">リード獲得・分析</h1>
          <p className="text-sm text-slate-500 mt-1">店舗調査・リードスコアリング・営業支援</p>
        </div>
      </div>

      {/* Store diagnosis tool */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 mb-6">
        <h3 className="text-sm font-semibold text-slate-500 mb-3">店舗調査ツール</h3>
        <p className="text-xs text-slate-400 mb-4">GoogleマップのリンクまたはGBP名を入力すると、現状のMEO強度がわかります。P-MAXの必要性も自動判定します。</p>
        <div className="flex gap-3 mb-6">
          <input
            type="text"
            className="flex-1 text-sm border border-slate-200 rounded-lg px-4 py-2.5"
            placeholder="GoogleマップのリンクまたはGBP名を入力..."
            defaultValue="焼肉ダイニング 炎 渋谷店"
          />
          <button className="px-6 py-2.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition font-medium">
            診断する
          </button>
        </div>

        {/* Diagnosis result */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="bg-blue-50 rounded-lg p-3 text-center">
            <p className="text-xs text-blue-500">MEOスコア</p>
            <p className="text-2xl font-bold text-blue-700">{diagnosisResult.score}</p>
          </div>
          <div className="bg-yellow-50 rounded-lg p-3 text-center">
            <p className="text-xs text-yellow-600">口コミ評価</p>
            <p className="text-2xl font-bold text-yellow-700">★{diagnosisResult.avgRating}</p>
          </div>
          <div className="bg-emerald-50 rounded-lg p-3 text-center">
            <p className="text-xs text-emerald-500">口コミ数</p>
            <p className="text-2xl font-bold text-emerald-700">{diagnosisResult.reviewCount}</p>
          </div>
          <div className="bg-purple-50 rounded-lg p-3 text-center">
            <p className="text-xs text-purple-500">P-MAX推奨</p>
            <p className="text-2xl font-bold text-purple-700">{diagnosisResult.pmaxRecommend ? "推奨" : "不要"}</p>
          </div>
        </div>

        <div className="p-3 bg-amber-50 rounded-lg border border-amber-100">
          <p className="text-xs font-medium text-amber-700">💡 業種別成功事例</p>
          <ul className="text-xs text-amber-600 mt-1 space-y-0.5">
            <li>・渋谷区の焼肉店は口コミ増加15件以上のところが軒並み順位UP</li>
            <li>・写真を多く追加している店舗が表示回数が増加傾向</li>
            <li>・「渋谷 焼肉」での検索では、飲食カテゴリの店舗が1ページ目の70%を占有</li>
          </ul>
        </div>
      </div>

      {/* Lead scoring */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 mb-6">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-500">リードスコアリング</h3>
          <div className="flex gap-2">
            <button className="text-xs px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg font-medium">CRM連携</button>
            <button className="text-xs px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-lg font-medium">CSV出力</button>
          </div>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-xs text-slate-400 text-left py-3 px-5 font-medium">店舗名</th>
              <th className="text-xs text-slate-400 text-center py-3 font-medium">スコア</th>
              <th className="text-xs text-slate-400 text-center py-3 font-medium">ステータス</th>
              <th className="text-xs text-slate-400 text-center py-3 font-medium">最終アクション</th>
              <th className="text-xs text-slate-400 text-center py-3 px-5 font-medium">アクション</th>
            </tr>
          </thead>
          <tbody>
            {leadList.map((lead) => (
              <tr key={lead.company} className="border-b border-slate-50 hover:bg-slate-50/50">
                <td className="py-3 px-5 text-sm font-medium text-slate-700">{lead.company}</td>
                <td className="py-3 text-center">
                  <span className={`text-sm font-bold ${
                    lead.score >= 80 ? "text-emerald-600" : lead.score >= 60 ? "text-amber-600" : "text-slate-400"
                  }`}>{lead.score}</span>
                </td>
                <td className="py-3 text-center">
                  <span className={`badge ${
                    lead.status === "HOT" ? "badge-danger" : lead.status === "WARM" ? "badge-warning" : "badge-info"
                  }`}>{lead.status}</span>
                </td>
                <td className="py-3 text-center text-xs text-slate-500">{lead.lastAction}</td>
                <td className="py-3 px-5 text-center">
                  <button className="text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 mr-1">詳細</button>
                  <button className="text-xs px-2 py-1 bg-emerald-50 text-emerald-600 rounded hover:bg-emerald-100">営業</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* All features */}
      <h3 className="text-sm font-semibold text-slate-500 mb-3">リード獲得・分析 機能一覧</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <FeatureCard icon="🔍" title="店舗調査" description="GoogleマップのリンクまたはGBP名を入力すればMEO強度がわかり、対策すべきか否か判断。P-MAXの必要性も自動判定。" status="active" />
        <FeatureCard icon="📝" title="自社サイトへの記事投稿" description="登録した店舗の紹介記事が、自社ドメインのサイトに自動生成される。SEO効果あり。" status="active" />
        <FeatureCard icon="🗺️" title="マイマップ作成" description="業種、インフルエンサー、地域など任意の条件でカスタムマップを制作。" status="beta" />
        <FeatureCard icon="📊" title="広告枠" description="自社サイト内の広告枠を管理。リード獲得のための広告配置を最適化。" status="coming" />
        <FeatureCard icon="🎯" title="リードスコアリング" description="店舗調査を行ったお客様の関心度をスコア化し、営業優先度を自動判定。" status="active" />
        <FeatureCard icon="🔄" title="CRM連携" description="見込み客の情報をSalesforce等の営業管理ツールに自動連携。" status="coming" />
        <FeatureCard icon="📈" title="業種別MEO成功事例の自動提示" description="店舗調査結果に合わせて、同業種の改善事例やビフォーアフターを自動表示。" status="active" />
        <FeatureCard icon="📰" title="業界情報コンテンツ配信" description="週次・月次で計測データをもとに記事を作成し、自社サイトにコンテンツとして配信。" status="beta" />
      </div>
    </div>
  );
}
