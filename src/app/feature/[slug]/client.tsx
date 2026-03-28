"use client";

import Link from "next/link";
import { getFeatureBySlug, type DemoType } from "@/lib/feature-details";

// ============================================================
// Demo UI Components
// ============================================================

function ApiDemo({ title }: { title: string }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 p-4 bg-emerald-50 rounded-lg border border-emerald-100">
        <span className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
        <span className="text-sm font-medium text-emerald-700">API接続中</span>
        <span className="text-xs text-emerald-500 ml-auto">レスポンスタイム: 124ms</span>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <h4 className="text-xs font-semibold text-slate-500 mb-3">データフロー</h4>
        <div className="flex items-center justify-between gap-2">
          {["リクエスト", "認証", "データ取得", "変換", "レスポンス"].map((step, i) => (
            <div key={step} className="flex items-center gap-2">
              <div className="flex flex-col items-center">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold ${
                  i <= 3 ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500"
                }`}>
                  {i + 1}
                </div>
                <span className="text-[10px] text-slate-500 mt-1">{step}</span>
              </div>
              {i < 4 && <span className="text-slate-300 mb-4">→</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-slate-900 rounded-lg p-4 overflow-x-auto">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] font-mono text-emerald-400">200 OK</span>
          <span className="text-[10px] font-mono text-slate-500">application/json</span>
        </div>
        <pre className="text-xs font-mono text-slate-300 leading-relaxed">{`{
  "status": "success",
  "data": {
    "feature": "${title}",
    "connected": true,
    "lastSync": "2026-03-23T09:00:00Z",
    "records": 1247
  }
}`}</pre>
      </div>
    </div>
  );
}

function AiDemo() {
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <h4 className="text-xs font-semibold text-slate-500 mb-3">入力</h4>
        <textarea
          className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 h-20"
          defaultValue="焼肉ダイニング 炎 渋谷店の情報をもとに生成してください"
          readOnly
        />
        <div className="flex gap-2 mt-3">
          <select className="text-xs border border-slate-200 rounded-lg px-3 py-1.5">
            <option>トーン: カジュアル</option>
            <option>トーン: フォーマル</option>
            <option>トーン: 親しみやすい</option>
          </select>
          <select className="text-xs border border-slate-200 rounded-lg px-3 py-1.5">
            <option>言語: 日本語</option>
            <option>言語: 英語</option>
            <option>言語: 中国語</option>
          </select>
        </div>
      </div>

      <div className="bg-purple-50 rounded-lg border border-purple-100 p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
          <span className="text-xs font-semibold text-purple-700">AI生成完了</span>
        </div>
        <div className="flex items-center gap-4 text-xs text-purple-600">
          <span>処理時間: 2.3秒</span>
          <span>トークン数: 256</span>
          <span>信頼度: 94%</span>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <h4 className="text-xs font-semibold text-slate-500 mb-3">生成結果プレビュー</h4>
        <div className="bg-slate-50 rounded-lg p-3 text-sm text-slate-700 leading-relaxed">
          渋谷・道玄坂エリアで極上の焼肉をお探しなら「焼肉ダイニング 炎」へ。厳選されたA5ランクの黒毛和牛を中心に、上質なお肉を炭火焼きでご提供いたします。
          デートや記念日に最適な個室も完備しております。
        </div>
        <div className="flex gap-2 mt-3">
          <button className="flex-1 px-3 py-2 bg-blue-600 text-white text-xs rounded-lg">適用する</button>
          <button className="px-3 py-2 border border-slate-200 text-xs rounded-lg">再生成</button>
          <button className="px-3 py-2 border border-slate-200 text-xs rounded-lg">編集</button>
        </div>
      </div>
    </div>
  );
}

function AnalyticsDemo() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "今月", value: "1,247", change: "+12.4%" },
          { label: "前月比", value: "+148", change: "成長" },
          { label: "平均値", value: "89.3", change: "良好" },
          { label: "目標達成率", value: "94%", change: "順調" },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-white rounded-lg border border-slate-200 p-4">
            <p className="text-[10px] text-slate-400">{kpi.label}</p>
            <p className="text-xl font-bold text-slate-800 mt-1">{kpi.value}</p>
            <span className="text-[10px] font-medium text-emerald-600">{kpi.change}</span>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-xs font-semibold text-slate-500">推移グラフ</h4>
          <div className="flex gap-1">
            {["日次", "週次", "月次"].map((f) => (
              <button key={f} className="text-[10px] px-2 py-1 bg-slate-50 text-slate-600 rounded">{f}</button>
            ))}
          </div>
        </div>
        <div className="h-40 flex items-end gap-2 px-4">
          {[45, 62, 58, 75, 68, 82, 78, 90, 85, 94, 88, 96].map((v, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <div
                className="w-full bg-gradient-to-t from-blue-500 to-blue-300 rounded-t"
                style={{ height: `${v * 1.4}px` }}
              />
              <span className="text-[8px] text-slate-400">{i + 1}月</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <select className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 bg-white">
          <option>期間: 過去3ヶ月</option>
          <option>期間: 過去6ヶ月</option>
          <option>期間: 過去1年</option>
        </select>
        <button className="text-xs px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg font-medium">レポートDL</button>
        <button className="text-xs px-3 py-1.5 bg-slate-50 text-slate-600 rounded-lg">CSVエクスポート</button>
      </div>
    </div>
  );
}

function SettingsDemo({ title }: { title: string }) {
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <h4 className="text-xs font-semibold text-slate-500 mb-4">設定</h4>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">機能名</label>
            <input type="text" className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2" defaultValue={title} readOnly />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">対象店舗</label>
            <select className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2">
              <option>焼肉ダイニング 炎 渋谷店</option>
              <option>全店舗</option>
            </select>
          </div>
          <div className="space-y-3">
            {[
              { label: "自動実行", enabled: true },
              { label: "通知を送信", enabled: true },
              { label: "ログを保存", enabled: true },
              { label: "テストモード", enabled: false },
            ].map((toggle) => (
              <div key={toggle.label} className="flex items-center justify-between">
                <span className="text-sm text-slate-700">{toggle.label}</span>
                <div className={`w-10 h-5 rounded-full relative cursor-pointer transition ${toggle.enabled ? "bg-blue-600" : "bg-slate-200"}`}>
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition ${toggle.enabled ? "left-5" : "left-0.5"}`} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        <button className="flex-1 px-4 py-2.5 bg-blue-600 text-white text-sm rounded-lg font-medium">設定を保存</button>
        <button className="px-4 py-2.5 border border-slate-200 text-sm rounded-lg">リセット</button>
      </div>
    </div>
  );
}

function PublishDemo() {
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <h4 className="text-xs font-semibold text-slate-500 mb-3">投稿エディタ</h4>
        <div className="flex gap-2 mb-3 border-b border-slate-100 pb-2">
          {["B", "I", "U", "Link", "Img", "Video"].map((btn) => (
            <button key={btn} className="w-8 h-8 flex items-center justify-center bg-slate-50 rounded text-xs font-bold text-slate-600 hover:bg-slate-100">{btn}</button>
          ))}
        </div>
        <textarea
          className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 h-24"
          defaultValue="本日のおすすめは、当店自慢のA5ランク黒毛和牛の特選盛り合わせです！渋谷で極上の焼肉をお探しなら、ぜひ焼肉ダイニング炎へ。"
          readOnly
        />
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <h4 className="text-xs font-semibold text-slate-500 mb-3">プレビュー</h4>
        <div className="bg-slate-50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-full bg-blue-500" />
            <div>
              <p className="text-xs font-medium text-slate-700">焼肉ダイニング 炎 渋谷店</p>
              <p className="text-[10px] text-slate-400">3月23日 18:00 に予約投稿</p>
            </div>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            本日のおすすめは、当店自慢のA5ランク黒毛和牛の特選盛り合わせです！
          </p>
          <div className="mt-2 h-32 bg-slate-200 rounded-lg flex items-center justify-center text-slate-400 text-xs">
            画像プレビュー
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <h4 className="text-xs font-semibold text-slate-500 mb-3">スケジュール設定</h4>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-slate-400">公開日</label>
            <input type="date" className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2" defaultValue="2026-03-23" />
          </div>
          <div>
            <label className="text-[10px] text-slate-400">公開時間</label>
            <input type="time" className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2" defaultValue="18:00" />
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <button className="flex-1 px-4 py-2.5 bg-blue-600 text-white text-sm rounded-lg font-medium">予約投稿</button>
        <button className="px-4 py-2.5 bg-emerald-600 text-white text-sm rounded-lg font-medium">直接投稿</button>
        <button className="px-4 py-2.5 border border-slate-200 text-sm rounded-lg">下書き保存</button>
      </div>
    </div>
  );
}

function MonitorDemo() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {[
          { level: "critical", message: "営業時間が第三者により変更されました", time: "2分前", icon: "!!" },
          { level: "warning", message: "NAP情報の不一致が1件検出されました", time: "15分前", icon: "!" },
          { level: "info", message: "新しい口コミが投稿されました（★4）", time: "1時間前", icon: "i" },
        ].map((alert, i) => (
          <div key={i} className={`p-4 rounded-lg border flex items-start gap-3 ${
            alert.level === "critical" ? "bg-red-50 border-red-200" :
            alert.level === "warning" ? "bg-amber-50 border-amber-200" :
            "bg-blue-50 border-blue-200"
          }`}>
            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white ${
              alert.level === "critical" ? "bg-red-500" :
              alert.level === "warning" ? "bg-amber-500" :
              "bg-blue-500"
            }`}>{alert.icon}</span>
            <div className="flex-1">
              <p className={`text-sm font-medium ${
                alert.level === "critical" ? "text-red-700" :
                alert.level === "warning" ? "text-amber-700" :
                "text-blue-700"
              }`}>{alert.message}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">{alert.time}</p>
            </div>
            <button className="text-xs px-2 py-1 bg-white rounded border border-slate-200">対応</button>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg border border-slate-200">
        <div className="p-3 border-b border-slate-100 flex items-center justify-between">
          <h4 className="text-xs font-semibold text-slate-500">監視ログ</h4>
          <span className="text-[10px] text-slate-400">直近24時間</span>
        </div>
        <div className="divide-y divide-slate-50">
          {[
            { time: "09:00", action: "定期スキャン完了", status: "success" },
            { time: "08:45", action: "変更検知チェック", status: "success" },
            { time: "08:30", action: "NAP一貫性チェック", status: "warning" },
            { time: "08:00", action: "API接続テスト", status: "success" },
            { time: "07:30", action: "バックアップ完了", status: "success" },
          ].map((log, i) => (
            <div key={i} className="px-4 py-2.5 flex items-center gap-3">
              <span className="text-xs text-slate-400 font-mono w-12">{log.time}</span>
              <span className={`w-2 h-2 rounded-full ${log.status === "success" ? "bg-emerald-500" : "bg-amber-500"}`} />
              <span className="text-xs text-slate-600">{log.action}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <h4 className="text-xs font-semibold text-slate-500 mb-3">通知設定</h4>
        <div className="space-y-2">
          {["メール通知", "LINE通知", "Slack通知", "ブラウザ通知"].map((type) => (
            <div key={type} className="flex items-center justify-between py-1">
              <span className="text-xs text-slate-600">{type}</span>
              <div className="w-10 h-5 rounded-full bg-blue-600 relative cursor-pointer">
                <div className="absolute top-0.5 left-5 w-4 h-4 rounded-full bg-white shadow" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AuthDemo() {
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <h4 className="text-xs font-semibold text-slate-500 mb-3">接続ステータス</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[
            { name: "Google Business Profile", status: "connected", expiry: "2026-06-15" },
            { name: "Google Ads (MCC)", status: "connected", expiry: "2026-05-20" },
            { name: "Meta Business", status: "connected", expiry: "2026-04-10" },
            { name: "TikTok Ads", status: "pending", expiry: "-" },
          ].map((conn) => (
            <div key={conn.name} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <div>
                <p className="text-xs font-medium text-slate-700">{conn.name}</p>
                <p className="text-[10px] text-slate-400">有効期限: {conn.expiry}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${conn.status === "connected" ? "bg-emerald-500" : "bg-amber-500"}`} />
                <button className={`text-[10px] px-2 py-1 rounded ${
                  conn.status === "connected" ? "bg-emerald-50 text-emerald-600" : "bg-blue-600 text-white"
                }`}>
                  {conn.status === "connected" ? "接続済み" : "認証する"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <h4 className="text-xs font-semibold text-slate-500 mb-3">権限テーブル</h4>
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-[10px] text-slate-400 text-left py-2 font-medium">権限</th>
              <th className="text-[10px] text-slate-400 text-center py-2 font-medium">管理者</th>
              <th className="text-[10px] text-slate-400 text-center py-2 font-medium">代理店</th>
              <th className="text-[10px] text-slate-400 text-center py-2 font-medium">店舗</th>
              <th className="text-[10px] text-slate-400 text-center py-2 font-medium">閲覧者</th>
            </tr>
          </thead>
          <tbody>
            {[
              { perm: "データ閲覧", vals: [true, true, true, true] },
              { perm: "投稿作成", vals: [true, true, true, false] },
              { perm: "設定変更", vals: [true, true, false, false] },
              { perm: "ユーザー管理", vals: [true, false, false, false] },
            ].map((row) => (
              <tr key={row.perm} className="border-b border-slate-50">
                <td className="py-2 text-xs text-slate-700">{row.perm}</td>
                {row.vals.map((val, i) => (
                  <td key={i} className="py-2 text-center">
                    <span className={val ? "text-emerald-500" : "text-red-400"}>{val ? "OK" : "--"}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button className="w-full px-4 py-2.5 bg-blue-600 text-white text-sm rounded-lg font-medium">
        OAuth認証を開始
      </button>
    </div>
  );
}

function getDemoComponent(demoType: DemoType, title: string) {
  switch (demoType) {
    case "api": return <ApiDemo title={title} />;
    case "ai": return <AiDemo />;
    case "analytics": return <AnalyticsDemo />;
    case "settings": return <SettingsDemo title={title} />;
    case "publish": return <PublishDemo />;
    case "monitor": return <MonitorDemo />;
    case "auth": return <AuthDemo />;
    default: return <ApiDemo title={title} />;
  }
}

function getDemoTypeLabel(demoType: DemoType): string {
  switch (demoType) {
    case "api": return "API連携";
    case "ai": return "AI生成";
    case "analytics": return "分析・レポート";
    case "settings": return "管理・設定";
    case "publish": return "投稿・配信";
    case "monitor": return "監視・通知";
    case "auth": return "認証・課金";
    default: return "";
  }
}

// ============================================================
// Main Client Component
// ============================================================

export default function FeatureDetailClient({ slug }: { slug: string }) {
  const feature = getFeatureBySlug(slug);

  if (!feature) {
    return (
      <div className="animate-fade-in p-10 text-center">
        <p className="text-lg text-slate-500">機能が見つかりませんでした</p>
        <Link href="/" className="text-sm text-blue-600 hover:underline mt-2 inline-block">
          ダッシュボードに戻る
        </Link>
      </div>
    );
  }

  const categoryPathMap: Record<string, string> = {
    "口コミ管理": "/reviews/",
    "投稿管理": "/posts/",
    "リード獲得・分析": "/lead/",
    "サイテーション": "/citation/",
    "多媒体管理": "/media/",
    "基礎情報管理": "/basic-info/",
    "P-MAX広告": "/pmax/",
    "広告管理": "/ads/",
    "オーガニック投稿": "/organic/",
    "OTA連携": "/ota/",
    "チャットボット": "/chatbot/",
    "システム管理": "/admin/",
  };

  const categoryPath = categoryPathMap[feature.category] || "/";

  return (
    <div className="animate-fade-in max-w-4xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-6">
        <Link href={categoryPath} className="text-sm text-blue-600 hover:underline flex items-center gap-1">
          &larr; {feature.category}
        </Link>
        <span className="text-slate-300">/</span>
        <span className="text-sm text-slate-500">{feature.title}</span>
      </div>

      {/* Header */}
      <div className="flex items-start gap-3 mb-6">
        <span className="text-3xl">{feature.icon}</span>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-bold text-slate-800">{feature.title}</h1>
            {feature.status === "active" && (
              <span className="text-xs bg-emerald-50 text-emerald-600 px-3 py-1 rounded-full font-medium">稼働中</span>
            )}
            {feature.status === "coming" && (
              <span className="text-xs bg-blue-50 text-blue-600 px-3 py-1 rounded-full font-medium">開発中</span>
            )}
            {feature.status === "beta" && (
              <span className="text-xs bg-purple-50 text-purple-600 px-3 py-1 rounded-full font-medium">Beta</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">{feature.category}</span>
            <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">{getDemoTypeLabel(feature.demoType)}</span>
          </div>
        </div>
      </div>

      {/* Description */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 mb-6">
        <h3 className="text-sm font-semibold text-slate-500 mb-2">概要</h3>
        <p className="text-sm text-slate-600 leading-relaxed mb-3">{feature.description}</p>
        <p className="text-sm text-slate-500 leading-relaxed">{feature.details}</p>
      </div>

      {/* Demo UI */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-500">デモUI</h3>
          <span className="text-xs text-slate-400">{getDemoTypeLabel(feature.demoType)}テンプレート</span>
        </div>
        {getDemoComponent(feature.demoType, feature.title)}
      </div>

      {/* Tech stack */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 mb-6">
        <h3 className="text-sm font-semibold text-slate-500 mb-3">技術スタック</h3>
        <div className="flex flex-wrap gap-2">
          {feature.techStack.map((tech) => (
            <span key={tech} className="text-xs px-3 py-1.5 bg-slate-100 text-slate-700 rounded-full font-medium">
              {tech}
            </span>
          ))}
        </div>
      </div>

      {/* Back link */}
      <div className="text-center">
        <Link href={categoryPath} className="text-sm text-blue-600 hover:underline">
          &larr; {feature.category}ページに戻る
        </Link>
      </div>
    </div>
  );
}
