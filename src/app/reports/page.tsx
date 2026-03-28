"use client";

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  LineChart, Line,
} from "recharts";
import { competitors, rankingData, monthlyInsights } from "@/lib/mock-data";

const radarData = [
  { subject: "口コミ数", 自店舗: 70, 競合平均: 80 },
  { subject: "評価", 自店舗: 84, 競合平均: 76 },
  { subject: "投稿頻度", 自店舗: 65, 競合平均: 70 },
  { subject: "写真数", 自店舗: 55, 競合平均: 72 },
  { subject: "返信率", 自店舗: 45, 競合平均: 60 },
  { subject: "Q&A", 自店舗: 30, 競合平均: 50 },
];

const conversionFunnel = [
  { stage: "検索表示", value: 12450, rate: "100%" },
  { stage: "プロフィール閲覧", value: 3820, rate: "30.7%" },
  { stage: "Webクリック", value: 567, rate: "14.8%" },
  { stage: "経路検索", value: 389, rate: "10.2%" },
  { stage: "電話タップ", value: 245, rate: "6.4%" },
];

const salesForecast = [
  { month: "1月", 実績: 820000, 予測: 0 },
  { month: "2月", 実績: 910000, 予測: 0 },
  { month: "3月", 実績: 980000, 予測: 980000 },
  { month: "4月", 実績: 0, 予測: 1050000 },
  { month: "5月", 実績: 0, 予測: 1120000 },
  { month: "6月", 実績: 0, 予測: 1080000 },
];

const externalFactors = [
  { date: "3/15 (土)", weather: "☀️ 晴れ", temp: "18°C", tourist: "高", event: "なし", impact: "+15%" },
  { date: "3/16 (日)", weather: "☁️ 曇り", temp: "14°C", tourist: "中", event: "なし", impact: "+5%" },
  { date: "3/17 (月)", weather: "🌧️ 雨", temp: "10°C", tourist: "低", event: "なし", impact: "-12%" },
  { date: "3/18 (火)", weather: "☀️ 晴れ", temp: "16°C", tourist: "中", event: "春祭り", impact: "+8%" },
];

const menuAnalysis = [
  { name: "特選和牛盛り合わせ", orders: 245, revenue: 612500, trend: "up", rank: 1 },
  { name: "カルビ定食（ランチ）", orders: 189, revenue: 283500, trend: "up", rank: 2 },
  { name: "タン塩", orders: 178, revenue: 267000, trend: "stable", rank: 3 },
  { name: "ハラミ", orders: 156, revenue: 234000, trend: "up", rank: 4 },
  { name: "冷麺", orders: 45, revenue: 40500, trend: "down", rank: 8 },
  { name: "ユッケジャンスープ", orders: 32, revenue: 28800, trend: "down", rank: 10 },
];

const gbpExtraMetrics = [
  { metric: "投稿の平均表示回数", value: "3,240", change: "+12%" },
  { metric: "写真の平均クリック率", value: "4.8%", change: "+0.5%" },
  { metric: "投稿からのWebサイト遷移率", value: "2.1%", change: "+0.3%" },
  { metric: "Q&A閲覧数", value: "890", change: "+22%" },
  { metric: "メニュー閲覧数", value: "1,450", change: "+8%" },
];

const aiSearchMetrics = [
  { platform: "Google AI Overview", views: 142, clicks: 23, ctr: "16.2%", topQuery: "渋谷 焼肉 おすすめ" },
  { platform: "ChatGPT", views: 89, clicks: 12, ctr: "13.5%", topQuery: "shibuya yakiniku" },
  { platform: "Gemini", views: 67, clicks: 8, ctr: "11.9%", topQuery: "渋谷 焼肉 個室" },
  { platform: "Perplexity", views: 34, clicks: 5, ctr: "14.7%", topQuery: "渋谷 焼肉 デート" },
];

const realtimeReviews = [
  { period: "今日", count: 2, avg: 4.5 },
  { period: "今週", count: 5, avg: 4.2 },
  { period: "今月", count: 18, avg: 4.4 },
  { period: "先月", count: 16, avg: 4.2 },
];

export default function ReportsPage() {
  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">レポート</h1>
          <p className="text-sm text-slate-500 mt-1">パフォーマンス分析・競合比較</p>
        </div>
        <div className="flex gap-2">
          {/* 全店舗・業種別切替 */}
          <select className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white">
            <option>焼肉ダイニング 炎 渋谷店</option>
            <option>全店舗（横断レポート）</option>
            <option>飲食店（業種別）</option>
            <option>渋谷エリア（地域別）</option>
          </select>
          <select className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white">
            <option>2026年3月</option>
            <option>2026年2月</option>
            <option>2026年1月</option>
          </select>
          <button className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition">
            レポートDL
          </button>
          <button className="px-4 py-2 border border-slate-200 text-sm rounded-lg hover:bg-slate-50 transition">
            自動メール配信設定
          </button>
        </div>
      </div>

      {/* 自社の口コミ分析 */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 mb-6">
        <h3 className="text-sm font-semibold text-slate-500 mb-4">自社の口コミ分析</h3>
        <p className="text-xs text-slate-400 mb-4">GOOD/BAD/MORE分析、口コミ増加量と評価の推移をグラフで表示（期間設定あり）</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div className="bg-emerald-50 rounded-lg p-4 text-center">
            <p className="text-xs text-emerald-600 font-medium">GOOD</p>
            <p className="text-2xl font-bold text-emerald-700">68%</p>
            <p className="text-[10px] text-emerald-500">接客・味・雰囲気</p>
          </div>
          <div className="bg-red-50 rounded-lg p-4 text-center">
            <p className="text-xs text-red-600 font-medium">BAD</p>
            <p className="text-2xl font-bold text-red-700">12%</p>
            <p className="text-[10px] text-red-500">待ち時間・価格</p>
          </div>
          <div className="bg-blue-50 rounded-lg p-4 text-center">
            <p className="text-xs text-blue-600 font-medium">MORE</p>
            <p className="text-2xl font-bold text-blue-700">20%</p>
            <p className="text-[10px] text-blue-500">メニュー拡充・駐車場</p>
          </div>
        </div>
        <div className="flex gap-2">
          <select className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 bg-white">
            <option>過去1ヶ月</option>
            <option>過去3ヶ月</option>
            <option>過去6ヶ月</option>
            <option>過去1年</option>
          </select>
          <button className="text-xs px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg font-medium">グラフ表示</button>
        </div>
      </div>

      {/* 競合店舗の口コミ獲得推移 */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 mb-6">
        <h3 className="text-sm font-semibold text-slate-500 mb-4">競合店舗の口コミ獲得推移</h3>
        <p className="text-xs text-slate-400 mb-4">口コミ獲得数・評価の推移、返信率をレポーティング</p>
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-xs text-slate-400 text-left py-2 font-medium">競合店舗</th>
              <th className="text-xs text-slate-400 text-center py-2 font-medium">今月口コミ数</th>
              <th className="text-xs text-slate-400 text-center py-2 font-medium">評価推移</th>
              <th className="text-xs text-slate-400 text-center py-2 font-medium">返信率</th>
            </tr>
          </thead>
          <tbody>
            {[
              { name: "焼肉A 渋谷店", reviews: 24, rating: "4.1→4.2", replyRate: "82%" },
              { name: "焼肉B 道玄坂店", reviews: 18, rating: "3.9→3.8", replyRate: "45%" },
              { name: "焼肉C 宇田川店", reviews: 31, rating: "4.3→4.4", replyRate: "91%" },
            ].map((c) => (
              <tr key={c.name} className="border-b border-slate-50">
                <td className="py-3 text-sm text-slate-700">{c.name}</td>
                <td className="py-3 text-center text-sm font-bold text-slate-600">{c.reviews}件</td>
                <td className="py-3 text-center text-sm text-slate-600">{c.rating}</td>
                <td className="py-3 text-center text-sm text-slate-600">{c.replyRate}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 業種ごとインサイト + 顧客専用ダッシュボード */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
          <h3 className="text-sm font-semibold text-slate-500 mb-3">設定した業種ごとにインサイトを確認</h3>
          <p className="text-xs text-slate-400 mb-3">大小のカテゴリ（大：飲食店・美容系・ショップ販売｜小：焼肉・イタリアン等）地域別、任意の店舗</p>
          <div className="flex gap-2 mb-3">
            {["飲食店", "焼肉", "渋谷区", "任意の店舗"].map((f) => (
              <button key={f} className="text-[10px] px-2.5 py-1 bg-slate-50 text-slate-600 rounded-lg hover:bg-blue-50 hover:text-blue-600 transition">
                {f}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-blue-50 rounded-lg p-2 text-center">
              <p className="text-[10px] text-blue-500">渋谷区・焼肉 平均口コミ</p>
              <p className="text-lg font-bold text-blue-700">★ 3.9</p>
            </div>
            <div className="bg-emerald-50 rounded-lg p-2 text-center">
              <p className="text-[10px] text-emerald-500">自店舗 vs 業界平均</p>
              <p className="text-lg font-bold text-emerald-700">+0.3 上回り</p>
            </div>
          </div>
        </div>
        <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl p-5 text-white">
          <h3 className="text-sm font-bold mb-2">顧客専用ダッシュボード（レポートの不要化）</h3>
          <p className="text-xs text-white/80 mb-3">
            顧客専用ログインURL発行→閲覧権限のみのダッシュボードを表示
          </p>
          <div className="flex gap-2">
            <button className="px-3 py-1.5 bg-white text-blue-600 text-xs rounded-lg font-medium">
              ダッシュボードURL発行
            </button>
            <button className="px-3 py-1.5 bg-white/20 text-white text-xs rounded-lg font-medium">
              表示項目を設定
            </button>
          </div>
        </div>
      </div>

      {/* Conversion funnel */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 mb-6">
        <h3 className="text-sm font-semibold text-slate-500 mb-4">コンバージョンファネル</h3>
        <div className="flex items-end justify-center gap-3 py-4">
          {conversionFunnel.map((stage, i) => (
            <div key={stage.stage} className="flex flex-col items-center">
              <span className="text-xs font-bold text-slate-700 mb-1">{stage.value.toLocaleString()}</span>
              <div
                className="rounded-t-lg transition-all"
                style={{
                  width: `${120 - i * 15}px`,
                  height: `${180 - i * 30}px`,
                  background: `linear-gradient(to top, ${
                    i === 0 ? "#3b82f6" : i === 1 ? "#6366f1" : i === 2 ? "#8b5cf6" : i === 3 ? "#a855f7" : "#c084fc"
                  }, ${
                    i === 0 ? "#60a5fa" : i === 1 ? "#818cf8" : i === 2 ? "#a78bfa" : i === 3 ? "#c084fc" : "#d8b4fe"
                  })`,
                }}
              />
              <span className="text-[11px] text-slate-500 mt-2 text-center">{stage.stage}</span>
              <span className="text-[10px] font-bold text-blue-600">{stage.rate}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
        {/* Competitor comparison */}
        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
          <h3 className="text-sm font-semibold text-slate-500 mb-4">競合比較（レーダーチャート）</h3>
          <ResponsiveContainer width="100%" height={300}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="#e2e8f0" />
              <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11 }} />
              <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 10 }} />
              <Radar name="自店舗" dataKey="自店舗" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} strokeWidth={2} />
              <Radar name="競合平均" dataKey="競合平均" stroke="#ef4444" fill="#ef4444" fillOpacity={0.1} strokeWidth={2} />
              <Legend />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        {/* Competitor table */}
        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
          <h3 className="text-sm font-semibold text-slate-500 mb-4">競合店舗スコア比較</h3>
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-xs text-slate-400 text-left py-2 font-medium">店舗名</th>
                <th className="text-xs text-slate-400 text-center py-2 font-medium">評価</th>
                <th className="text-xs text-slate-400 text-center py-2 font-medium">口コミ数</th>
                <th className="text-xs text-slate-400 text-center py-2 font-medium">MEOスコア</th>
              </tr>
            </thead>
            <tbody>
              {competitors
                .sort((a, b) => b.score - a.score)
                .map((c, i) => (
                  <tr key={c.name} className={`border-b border-slate-50 ${c.isSelf ? "bg-blue-50/50" : ""}`}>
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-bold w-5 ${i === 0 ? "text-yellow-500" : "text-slate-300"}`}>{i + 1}</span>
                        <span className={`text-sm ${c.isSelf ? "font-bold text-blue-700" : "text-slate-700"}`}>
                          {c.name}
                          {c.isSelf && <span className="ml-1 text-[10px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full">自店舗</span>}
                        </span>
                      </div>
                    </td>
                    <td className="text-center"><span className="text-sm text-yellow-500">★ {c.rating}</span></td>
                    <td className="text-center text-sm text-slate-600">{c.reviews}</td>
                    <td className="text-center">
                      <span className={`text-sm font-bold ${c.score >= 80 ? "text-emerald-600" : c.score >= 60 ? "text-amber-600" : "text-red-600"}`}>{c.score}</span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          <div className="mt-4 p-3 bg-amber-50 rounded-lg border border-amber-100">
            <p className="text-xs font-medium text-amber-700">💡 改善ポイント</p>
            <ul className="text-xs text-amber-600 mt-1 space-y-0.5">
              <li>・口コミ返信率が競合平均より15%低い → AI自動返信の活用推奨</li>
              <li>・写真数が競合より少ない → 週2回の写真投稿を推奨</li>
              <li>・Q&A充実度が大幅に不足 → AIO対策として10件以上推奨</li>
            </ul>
          </div>
        </div>
      </div>

      {/* 売上予測 */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 mb-6">
        <h3 className="text-sm font-semibold text-slate-500 mb-4">売上予測（MEO数値ベース）</h3>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={salesForecast}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `¥${(v / 10000).toFixed(0)}万`} />
            <Tooltip formatter={(v) => `¥${Number(v).toLocaleString()}`} />
            <Legend />
            <Line type="monotone" dataKey="実績" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} />
            <Line type="monotone" dataKey="予測" stroke="#8b5cf6" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
        <p className="text-xs text-slate-400 mt-2">※ 電話タップ数・経路検索数・Webクリック数から推定来店数を算出し、客単価を掛けて売上予測を生成</p>
      </div>

      {/* 外部要因分析 */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 mb-6">
        <h3 className="text-sm font-semibold text-slate-500 mb-4">外部要因分析（天気・観光客・イベント）</h3>
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-xs text-slate-400 text-left py-2 font-medium">日付</th>
              <th className="text-xs text-slate-400 text-center py-2 font-medium">天気</th>
              <th className="text-xs text-slate-400 text-center py-2 font-medium">気温</th>
              <th className="text-xs text-slate-400 text-center py-2 font-medium">外国人観光客</th>
              <th className="text-xs text-slate-400 text-center py-2 font-medium">周辺イベント</th>
              <th className="text-xs text-slate-400 text-center py-2 font-medium">来客影響</th>
            </tr>
          </thead>
          <tbody>
            {externalFactors.map((row) => (
              <tr key={row.date} className="border-b border-slate-50">
                <td className="py-3 text-sm text-slate-700">{row.date}</td>
                <td className="py-3 text-center text-sm">{row.weather}</td>
                <td className="py-3 text-center text-sm text-slate-600">{row.temp}</td>
                <td className="py-3 text-center">
                  <span className={`badge ${row.tourist === "高" ? "badge-success" : row.tourist === "中" ? "badge-warning" : "badge-info"}`}>{row.tourist}</span>
                </td>
                <td className="py-3 text-center text-sm text-slate-600">{row.event}</td>
                <td className="py-3 text-center">
                  <span className={`text-sm font-bold ${row.impact.startsWith("+") ? "text-emerald-600" : "text-red-600"}`}>{row.impact}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 人気メニュー分析 (POSレジ連携) */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-500">人気メニュー分析（POSレジ連携）</h3>
          <span className="badge badge-info">POS連携中</span>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-xs text-slate-400 text-left py-2 font-medium">順位</th>
              <th className="text-xs text-slate-400 text-left py-2 font-medium">メニュー名</th>
              <th className="text-xs text-slate-400 text-center py-2 font-medium">注文数</th>
              <th className="text-xs text-slate-400 text-center py-2 font-medium">売上</th>
              <th className="text-xs text-slate-400 text-center py-2 font-medium">トレンド</th>
            </tr>
          </thead>
          <tbody>
            {menuAnalysis.map((item) => (
              <tr key={item.name} className="border-b border-slate-50">
                <td className="py-3 text-sm font-bold text-slate-400">{item.rank}</td>
                <td className="py-3 text-sm font-medium text-slate-700">{item.name}</td>
                <td className="py-3 text-center text-sm text-slate-600">{item.orders}</td>
                <td className="py-3 text-center text-sm text-slate-600">¥{item.revenue.toLocaleString()}</td>
                <td className="py-3 text-center">
                  <span className={`text-sm ${item.trend === "up" ? "text-emerald-500" : item.trend === "down" ? "text-red-500" : "text-slate-400"}`}>
                    {item.trend === "up" ? "📈" : item.trend === "down" ? "📉" : "➡️"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* リアルタイム口コミ */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
          <h3 className="text-sm font-semibold text-slate-500 mb-4">リアルタイム口コミ数</h3>
          <div className="grid grid-cols-2 gap-3">
            {realtimeReviews.map((r) => (
              <div key={r.period} className="bg-slate-50 rounded-lg p-3 text-center">
                <p className="text-xs text-slate-400">{r.period}</p>
                <p className="text-2xl font-bold text-slate-700">{r.count}<span className="text-xs text-slate-400 ml-1">件</span></p>
                <p className="text-xs text-yellow-500">★ {r.avg}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-400 mt-3">任意の日付・月で比較可能</p>
        </div>

        {/* GBP外の独自計測 */}
        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
          <h3 className="text-sm font-semibold text-slate-500 mb-4">GBP外の独自計測指標</h3>
          <div className="space-y-3">
            {gbpExtraMetrics.map((m) => (
              <div key={m.metric} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                <span className="text-sm text-slate-700">{m.metric}</span>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-slate-800">{m.value}</span>
                  <span className="text-xs text-emerald-600 font-medium bg-emerald-50 px-2 py-0.5 rounded-full">{m.change}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* AIモード検索の表示・クリック */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 mb-6">
        <h3 className="text-sm font-semibold text-slate-500 mb-4">AIモード検索の表示数・クリック数</h3>
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-xs text-slate-400 text-left py-2 font-medium">AIプラットフォーム</th>
              <th className="text-xs text-slate-400 text-center py-2 font-medium">表示回数</th>
              <th className="text-xs text-slate-400 text-center py-2 font-medium">クリック数</th>
              <th className="text-xs text-slate-400 text-center py-2 font-medium">CTR</th>
              <th className="text-xs text-slate-400 text-left py-2 font-medium">トップクエリ</th>
            </tr>
          </thead>
          <tbody>
            {aiSearchMetrics.map((row) => (
              <tr key={row.platform} className="border-b border-slate-50">
                <td className="py-3 text-sm font-medium text-slate-700">{row.platform}</td>
                <td className="py-3 text-center text-sm text-slate-600">{row.views}</td>
                <td className="py-3 text-center text-sm text-slate-600">{row.clicks}</td>
                <td className="py-3 text-center text-sm font-bold text-blue-600">{row.ctr}</td>
                <td className="py-3 text-sm text-slate-500">{row.topQuery}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Insights detail */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 mb-6">
        <h3 className="text-sm font-semibold text-slate-500 mb-4">インサイト詳細推移</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={monthlyInsights}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            <Legend />
            <Bar dataKey="検索表示" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            <Bar dataKey="プロフィール" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
            <Bar dataKey="経路検索" fill="#10b981" radius={[4, 4, 0, 0]} />
            <Bar dataKey="電話" fill="#f59e0b" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Keyword rankings + 任意時間での順位測定 */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-500">キーワード順位トラッキング</h3>
          <div className="flex gap-2">
            <select className="text-[10px] border border-slate-200 rounded-lg px-2 py-1 bg-white">
              <option>現在の順位</option>
              <option>09:00 の順位</option>
              <option>12:00 の順位</option>
              <option>18:00 の順位</option>
              <option>21:00 の順位</option>
            </select>
            <button className="text-[10px] px-2 py-1 bg-blue-50 text-blue-600 rounded-lg font-medium">今すぐ測定</button>
          </div>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-xs text-slate-400 text-left py-2 font-medium">キーワード</th>
              <th className="text-xs text-slate-400 text-center py-2 font-medium">現在順位</th>
              <th className="text-xs text-slate-400 text-center py-2 font-medium">変動</th>
              <th className="text-xs text-slate-400 text-center py-2 font-medium">月間検索Vol</th>
              <th className="text-xs text-slate-400 text-center py-2 font-medium">対策状況</th>
            </tr>
          </thead>
          <tbody>
            {rankingData.map((kw) => (
              <tr key={kw.keyword} className="border-b border-slate-50">
                <td className="py-3 text-sm text-slate-700 font-medium">{kw.keyword}</td>
                <td className="text-center"><span className="text-lg font-bold text-blue-600">{kw.rank}位</span></td>
                <td className="text-center">
                  <span className={`badge ${kw.change > 0 ? "badge-success" : kw.change < 0 ? "badge-danger" : "badge-info"}`}>
                    {kw.change > 0 ? `↑${kw.change}` : kw.change < 0 ? `↓${Math.abs(kw.change)}` : "→ 変動なし"}
                  </span>
                </td>
                <td className="text-center text-sm text-slate-600">{kw.volume.toLocaleString()}</td>
                <td className="text-center">
                  <span className={`badge ${kw.rank <= 3 ? "badge-success" : kw.rank <= 5 ? "badge-warning" : "badge-danger"}`}>
                    {kw.rank <= 3 ? "上位表示" : kw.rank <= 5 ? "改善中" : "要対策"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* クライアント意見収集 */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
        <h3 className="text-sm font-semibold text-slate-500 mb-3">クライアントの意見収集</h3>
        <p className="text-xs text-slate-400 mb-3">月1回のアンケートまたはインタビューでクライアントのフィードバックを収集</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
            <p className="text-xs font-medium text-blue-700">次回アンケート予定</p>
            <p className="text-sm font-bold text-blue-800 mt-1">2026年4月1日</p>
          </div>
          <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-100">
            <p className="text-xs font-medium text-emerald-700">前回の満足度</p>
            <p className="text-sm font-bold text-emerald-800 mt-1">4.2 / 5.0</p>
          </div>
          <div className="p-3 bg-purple-50 rounded-lg border border-purple-100">
            <p className="text-xs font-medium text-purple-700">回答率</p>
            <p className="text-sm font-bold text-purple-800 mt-1">78%</p>
          </div>
        </div>
        <button className="mt-3 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition">
          アンケートを送信
        </button>
      </div>
    </div>
  );
}
