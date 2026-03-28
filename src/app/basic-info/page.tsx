"use client";

import FeatureCard from "@/components/feature-card";

const changeLog = [
  { date: "3/17 14:22", field: "営業時間", oldValue: "17:00-23:00", newValue: "17:00-22:00", source: "Google", status: "reverted" },
  { date: "3/15 09:10", field: "電話番号", oldValue: "03-1234-5678", newValue: "03-9999-0000", source: "第三者", status: "blocked" },
  { date: "3/12 11:35", field: "カテゴリ", oldValue: "焼肉店", newValue: "レストラン", source: "Google提案", status: "pending" },
];

const napCheck = [
  { platform: "Google ビジネスプロフィール", name: "✓", address: "✓", phone: "✓", hours: "✓" },
  { platform: "食べログ", name: "✓", address: "✓", phone: "✗", hours: "✓" },
  { platform: "ホットペッパー", name: "✓", address: "✓", phone: "✓", hours: "✗" },
  { platform: "自社HP", name: "✓", address: "✓", phone: "✓", hours: "✓" },
];

export default function BasicInfoPage() {
  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">基礎情報管理</h1>
          <p className="text-sm text-slate-500 mt-1">GBP基礎情報の監視・変更検知・管理</p>
        </div>
        <button className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition">
          基礎情報を編集
        </button>
      </div>

      {/* Alerts */}
      <div className="bg-red-50 rounded-xl p-4 border border-red-100 mb-6">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm">🚨</span>
          <span className="text-sm font-semibold text-red-700">変更検知アラート</span>
          <span className="badge badge-danger">2件</span>
        </div>
        <p className="text-xs text-red-600">Googleが営業時間を自動変更しました。第三者による電話番号の変更をブロックしました。</p>
      </div>

      {/* Change log */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 mb-6">
        <div className="p-5 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-500">変更履歴・検知ログ</h3>
        </div>
        <div className="divide-y divide-slate-50">
          {changeLog.map((log, i) => (
            <div key={i} className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full ${
                  log.status === "blocked" ? "bg-red-500" :
                  log.status === "reverted" ? "bg-amber-500" : "bg-blue-500"
                }`} />
                <div>
                  <p className="text-sm text-slate-700">
                    <span className="font-medium">{log.field}</span> が変更されました
                    <span className="text-xs text-slate-400 ml-2">by {log.source}</span>
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {log.oldValue} → <span className="text-red-500">{log.newValue}</span>
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-400">{log.date}</span>
                <span className={`badge ${
                  log.status === "blocked" ? "badge-danger" :
                  log.status === "reverted" ? "badge-warning" : "badge-info"
                }`}>
                  {log.status === "blocked" ? "ブロック済" :
                   log.status === "reverted" ? "元に戻し済" : "確認待ち"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* NAP check */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 mb-6">
        <div className="p-5 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-500">NAP情報クロスチェック</h3>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-xs text-slate-400 text-left py-3 px-5 font-medium">媒体</th>
              <th className="text-xs text-slate-400 text-center py-3 font-medium">店舗名</th>
              <th className="text-xs text-slate-400 text-center py-3 font-medium">住所</th>
              <th className="text-xs text-slate-400 text-center py-3 font-medium">電話番号</th>
              <th className="text-xs text-slate-400 text-center py-3 font-medium">営業時間</th>
            </tr>
          </thead>
          <tbody>
            {napCheck.map((row) => (
              <tr key={row.platform} className="border-b border-slate-50">
                <td className="py-3 px-5 text-sm text-slate-700">{row.platform}</td>
                {[row.name, row.address, row.phone, row.hours].map((val, i) => (
                  <td key={i} className="py-3 text-center">
                    <span className={val === "✓" ? "text-emerald-500 text-lg" : "text-red-500 text-lg font-bold"}>
                      {val}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Special hours */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 mb-6">
        <h3 className="text-sm font-semibold text-slate-500 mb-3">祝日・特別営業時間</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            { date: "3/20 (木)", label: "春分の日", hours: "11:30-22:00", status: "設定済" },
            { date: "4/29 (火)", label: "昭和の日", hours: "未設定", status: "要設定" },
            { date: "5/3-5 (土-月)", label: "GW", hours: "未設定", status: "要設定" },
          ].map((h) => (
            <div key={h.date} className={`p-3 rounded-lg border ${
              h.status === "設定済" ? "border-emerald-100 bg-emerald-50/50" : "border-amber-100 bg-amber-50/50"
            }`}>
              <p className="text-xs text-slate-500">{h.date}</p>
              <p className="text-sm font-medium text-slate-700">{h.label}</p>
              <p className="text-xs text-slate-500 mt-1">{h.hours}</p>
              <span className={`text-[10px] font-medium ${
                h.status === "設定済" ? "text-emerald-600" : "text-amber-600"
              }`}>{h.status}</span>
            </div>
          ))}
        </div>
      </div>

      {/* All features */}
      <h3 className="text-sm font-semibold text-slate-500 mb-3">基礎情報管理 機能一覧</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <FeatureCard icon="🚨" title="情報変更の自動検知" description="Googleが勝手に営業時間等を変更した場合に即時アラート。自動で元に戻すことも可能。" status="active" />
        <FeatureCard icon="🛡️" title="第三者による改ざん防止" description="第三者による情報変更をシャットアウト。変更をブロックしログに記録。" status="active" />
        <FeatureCard icon="🌍" title="外国語ページ作成" description="Googleが提供している各言語ページを自動作成。英語・韓国語・中国語等。" status="active" />
        <FeatureCard icon="📷" title="写真重複アラート" description="重複している写真がある場合にアラートで通知。重複写真の特定も可能。" status="active" />
        <FeatureCard icon="✅" title="NAP情報の確認" description="各媒体のNAP（Name/Address/Phone）情報をクロスチェック。不一致を自動検出。" status="active" />
        <FeatureCard icon="🏷️" title="カテゴリの最適解提案" description="業種・エリアに基づいてMEOに最適なカテゴリの組み合わせをAIが提案。" status="active" />
        <FeatureCard icon="🍽️" title="メニュー一括追加" description="CSVアップロードでメニュー・商品・サービスを一括登録。多言語翻訳も自動。" status="active" />
        <FeatureCard icon="✏️" title="メニュー・商品の編集" description="システムから直接変更可能。手動・自動どちらにも対応。行の追加・削除も簡単。" status="active" />
        <FeatureCard icon="💾" title="写真・動画のデータベース" description="写真や動画を一元管理できるストレージ機能。各媒体への配信元として利用。" status="beta" />
        <FeatureCard icon="📅" title="祝日・特別営業時間の一括管理" description="年末年始・GW・お盆等の特別営業時間をカレンダー形式で事前設定＆自動反映。" status="active" />
        <FeatureCard icon="📋" title="GBP属性の充実度チェック" description="設定可能な属性のうち未設定の項目をリスト化して提案。充実度を%で表示。" status="active" />
        <FeatureCard icon="🔗" title="パンくず機能" description="GBP内のナビゲーション構造を最適化。" status="coming" />
      </div>
    </div>
  );
}
