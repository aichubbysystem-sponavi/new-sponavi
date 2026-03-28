"use client";

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import FeatureCard from "@/components/feature-card";

const pmaxData = [
  { week: "W1", クリック: 245, CV: 12, 費用: 15000 },
  { week: "W2", クリック: 312, CV: 18, 費用: 18000 },
  { week: "W3", クリック: 289, CV: 15, 費用: 16500 },
  { week: "W4", クリック: 378, CV: 22, 費用: 20000 },
];

const campaigns = [
  { name: "焼肉 炎 渋谷 P-MAX", status: "active", budget: 50000, spent: 35200, clicks: 1224, cv: 67, cpa: 525, roas: 380 },
];

export default function PmaxPage() {
  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">P-MAX広告</h1>
          <p className="text-sm text-slate-500 mt-1">P-MAXキャンペーンの作成・管理・最適化</p>
        </div>
        <div className="flex gap-2">
          <button className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition">
            + 新規キャンペーン作成
          </button>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: "クリック数", value: "1,224", change: "+12.4%", color: "blue" },
          { label: "コンバージョン", value: "67", change: "+18.2%", color: "emerald" },
          { label: "CPA", value: "¥525", change: "-8.3%", color: "purple" },
          { label: "ROAS", value: "380%", change: "+15.1%", color: "amber" },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
            <p className="text-xs text-slate-500">{kpi.label}</p>
            <p className="text-2xl font-bold text-slate-800 mt-1">{kpi.value}</p>
            <span className={`text-xs font-medium ${
              kpi.change.startsWith("+") ? "text-emerald-600" : "text-emerald-600"
            }`}>{kpi.change} 前月比</span>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 mb-6">
        <h3 className="text-sm font-semibold text-slate-500 mb-4">週次パフォーマンス</h3>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={pmaxData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="week" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            <Legend />
            <Bar dataKey="クリック" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            <Bar dataKey="CV" fill="#10b981" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Campaign detail */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 mb-6">
        <div className="p-5 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-500">キャンペーン一覧</h3>
        </div>
        {campaigns.map((c) => (
          <div key={c.name} className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <h4 className="text-sm font-medium text-slate-800">{c.name}</h4>
                <span className="badge badge-success">配信中</span>
              </div>
              <div className="flex gap-2">
                <button className="text-xs px-3 py-1.5 bg-slate-50 text-slate-600 rounded-lg">編集</button>
                <button className="text-xs px-3 py-1.5 bg-red-50 text-red-600 rounded-lg">停止</button>
              </div>
            </div>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
              <div className="bg-slate-50 rounded-lg p-2 text-center">
                <p className="text-[10px] text-slate-400">予算</p>
                <p className="text-sm font-bold text-slate-700">¥{c.budget.toLocaleString()}</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-2 text-center">
                <p className="text-[10px] text-slate-400">消化額</p>
                <p className="text-sm font-bold text-slate-700">¥{c.spent.toLocaleString()}</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-2 text-center">
                <p className="text-[10px] text-slate-400">クリック</p>
                <p className="text-sm font-bold text-slate-700">{c.clicks}</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-2 text-center">
                <p className="text-[10px] text-slate-400">CV</p>
                <p className="text-sm font-bold text-slate-700">{c.cv}</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-2 text-center">
                <p className="text-[10px] text-slate-400">CPA</p>
                <p className="text-sm font-bold text-slate-700">¥{c.cpa}</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-2 text-center">
                <p className="text-[10px] text-slate-400">ROAS</p>
                <p className="text-sm font-bold text-emerald-600">{c.roas}%</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* AI budget recommendation */}
      <div className="bg-gradient-to-r from-purple-500 to-blue-600 rounded-xl p-5 text-white mb-6">
        <h3 className="text-sm font-bold mb-2">🤖 AI予算最適化レコメンド</h3>
        <p className="text-xs text-white/80 mb-3">
          過去のパフォーマンスデータから、日予算を¥2,000→¥2,500に増額すると、CVが推定20%増加する見込みです。
          週末（金土）に予算を集中させるとROASが更に改善する可能性があります。
        </p>
        <button className="px-4 py-2 bg-white text-purple-600 text-xs rounded-lg font-medium">
          レコメンドを適用
        </button>
      </div>

      {/* LP auto generation */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 mb-6">
        <h3 className="text-sm font-semibold text-slate-500 mb-3">LP自動生成</h3>
        <p className="text-xs text-slate-400 mb-4">
          店舗情報から広告用ランディングページを自動生成。検索語句に合わせてリアルタイムで最適化されます。
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {["渋谷 焼肉 おすすめ", "渋谷 焼肉 デート", "渋谷 和牛 ランチ"].map((kw) => (
            <div key={kw} className="border border-slate-100 rounded-lg p-3">
              <p className="text-xs text-blue-600 font-medium mb-1">{kw}</p>
              <div className="h-24 bg-slate-50 rounded flex items-center justify-center text-xs text-slate-400">
                LP プレビュー
              </div>
              <button className="w-full mt-2 text-[10px] px-2 py-1 bg-blue-50 text-blue-600 rounded text-center">プレビュー</button>
            </div>
          ))}
        </div>
      </div>

      {/* All features */}
      <h3 className="text-sm font-semibold text-slate-500 mb-3">P-MAX広告 機能一覧</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <FeatureCard icon="📝" title="広告文の自動作成" description="口コミからお客様が喜んでいる内容をピックアップして広告文を作成。過去の型も参照。" status="active" />
        <FeatureCard icon="🔑" title="キーワード自動作成" description="過去の実績データからその店舗に合ったキーワードを自動生成。" status="active" />
        <FeatureCard icon="🔗" title="サイトリンクの作成" description="雛形通りにサイトリンクアセットを自動作成。" status="active" />
        <FeatureCard icon="📢" title="コールアウトの作成" description="雛形通りにコールアウトアセットを自動作成。" status="active" />
        <FeatureCard icon="📋" title="構造化スニペットの作成" description="雛形通りに構造化スニペットアセットを自動作成。" status="active" />
        <FeatureCard icon="📊" title="P-MAXレポート作成" description="雛形通りにパフォーマンスレポートを自動生成。クライアントへの報告用。" status="active" />
        <FeatureCard icon="🎯" title="ターゲット設定" description="過去の実績から店舗に合ったターゲティングを自動設定。" status="active" />
        <FeatureCard icon="📈" title="実数値の自動計測" description="決められた型を自動で広告キャンペーンごとに計測・レポート。" status="active" />
        <FeatureCard icon="⚙️" title="アカウント〜キャンペーン作成" description="広告管理画面を開かずに、サイト上でアカウント作成からキャンペーン作成まで完結。" status="active" />
        <FeatureCard icon="💰" title="予算最適化レコメンド" description="AIが過去のパフォーマンスから最適な日予算・月予算を提案。" status="active" />
        <FeatureCard icon="🌐" title="LP自動生成" description="店舗情報から広告用LPを自動生成。検索語句に合わせてリアルタイムで最適化。" status="beta" />
        <FeatureCard icon="📉" title="業種別の平均値" description="同じシステムを使っている店舗の業種別平均値でスコアリングし、改善分析。" status="active" />
        <FeatureCard icon="🔄" title="多媒体連動" description="システムで広告文等を変更した際、他媒体の情報も同時に更新。" status="coming" />
        <FeatureCard icon="🔧" title="成果悪化時の改善案" description="パフォーマンスが悪化した際にAIが改善案を自動提案。" status="active" />
      </div>
    </div>
  );
}
