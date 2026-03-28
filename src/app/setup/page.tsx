"use client";

import { useState } from "react";

const suggestedCategories = [
  { main: "焼肉店", selected: true },
  { main: "レストラン", selected: true },
  { main: "バーベキューレストラン", selected: false },
];

const suggestedKeywords = [
  { keyword: "渋谷 焼肉", volume: 12100, difficulty: "高", selected: true },
  { keyword: "渋谷 焼肉 おすすめ", volume: 4400, difficulty: "中", selected: true },
  { keyword: "道玄坂 焼肉", volume: 1900, difficulty: "低", selected: true },
  { keyword: "渋谷 和牛", volume: 3200, difficulty: "中", selected: true },
  { keyword: "渋谷 焼肉 デート", volume: 2900, difficulty: "中", selected: false },
  { keyword: "渋谷 焼肉 個室", volume: 2100, difficulty: "中", selected: false },
  { keyword: "渋谷 焼肉 ランチ", volume: 5500, difficulty: "高", selected: false },
  { keyword: "渋谷 焼肉 食べ放題", volume: 3800, difficulty: "高", selected: false },
];

export default function SetupPage() {
  const [activeTab, setActiveTab] = useState<"hearing" | "keywords" | "profile" | "description">("hearing");

  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">初期整備</h1>
        <p className="text-sm text-slate-500 mt-1">GBP最適化の初期設定・ヒアリング</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-white rounded-xl p-1 shadow-sm border border-slate-100 mb-6">
        {[
          { key: "hearing", label: "ヒアリングシート" },
          { key: "keywords", label: "対策KW設定" },
          { key: "profile", label: "プロフィール整備" },
          { key: "description", label: "説明文生成" },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as typeof activeTab)}
            className={`flex-1 py-2.5 text-sm rounded-lg transition font-medium ${
              activeTab === tab.key
                ? "bg-blue-600 text-white shadow-sm"
                : "text-slate-500 hover:bg-slate-50"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Hearing sheet tab */}
      {activeTab === "hearing" && (
        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-sm font-semibold text-slate-500">ヒアリングシート</h3>
            <div className="flex gap-2">
              <button className="text-xs px-3 py-1.5 bg-purple-50 text-purple-600 rounded-lg font-medium">リンクをコピー</button>
              <button className="text-xs px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg font-medium">保存</button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-4">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide">基礎情報</h4>
              {[
                { label: "店舗名", value: "焼肉ダイニング 炎 渋谷店" },
                { label: "住所", value: "東京都渋谷区道玄坂1-2-3" },
                { label: "電話番号", value: "03-1234-5678" },
                { label: "営業時間", value: "ランチ 11:30-14:00 / ディナー 17:00-23:00" },
                { label: "定休日", value: "不定休" },
                { label: "Webサイト", value: "https://yakiniku-homura.jp" },
              ].map((field) => (
                <div key={field.label}>
                  <label className="text-xs font-medium text-slate-600 block mb-1">{field.label}</label>
                  <input
                    type="text"
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2"
                    defaultValue={field.value}
                  />
                </div>
              ))}
            </div>

            <div className="space-y-4">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide">トンマナ・雰囲気</h4>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-2">店舗の雰囲気</label>
                <div className="flex flex-wrap gap-2">
                  {["落ち着いた", "にぎやか", "高級感", "カジュアル", "デート向き", "家族向け", "隠れ家的"].map((tag) => (
                    <button
                      key={tag}
                      className="text-xs px-3 py-1.5 rounded-full border border-slate-200 hover:border-blue-300 hover:bg-blue-50 transition"
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-2">口コミ返信のトーン</label>
                <div className="flex flex-wrap gap-2">
                  {["丁寧・フォーマル", "親しみやすい", "簡潔", "感謝を強調"].map((tag) => (
                    <button
                      key={tag}
                      className="text-xs px-3 py-1.5 rounded-full border border-slate-200 hover:border-blue-300 hover:bg-blue-50 transition"
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">口コミ返信の注意事項</label>
                <textarea
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 h-20"
                  placeholder="例: 具体的なクレーム内容には触れない等..."
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-2">他媒体の使用許可</label>
                <div className="space-y-2">
                  {["食べログ", "ホットペッパー", "Instagram", "TikTok"].map((media) => (
                    <label key={media} className="flex items-center gap-2">
                      <input type="checkbox" className="rounded" defaultChecked />
                      <span className="text-sm text-slate-600">{media}への連携を許可</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Keywords tab */}
      {activeTab === "keywords" && (
        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-sm font-semibold text-slate-500">対策キーワード設定</h3>
            <button className="px-4 py-2 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 transition">
              🤖 AIでKW候補を生成
            </button>
          </div>

          <div className="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-100">
            <p className="text-xs text-blue-700">
              💡 店舗名「焼肉ダイニング 炎 渋谷店」の業種から、MEOに最適なキーワード候補を自動生成しました。
              選択したKWは口コミ返信・投稿文章・Q&A・レポートに一斉反映されます。
            </p>
          </div>

          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-xs text-slate-400 text-left py-2 font-medium w-8">選択</th>
                <th className="text-xs text-slate-400 text-left py-2 font-medium">キーワード</th>
                <th className="text-xs text-slate-400 text-center py-2 font-medium">月間検索Vol</th>
                <th className="text-xs text-slate-400 text-center py-2 font-medium">難易度</th>
                <th className="text-xs text-slate-400 text-center py-2 font-medium">状態</th>
              </tr>
            </thead>
            <tbody>
              {suggestedKeywords.map((kw) => (
                <tr key={kw.keyword} className="border-b border-slate-50">
                  <td className="py-3">
                    <input type="checkbox" className="rounded" defaultChecked={kw.selected} />
                  </td>
                  <td className="py-3 text-sm font-medium text-slate-700">{kw.keyword}</td>
                  <td className="py-3 text-center text-sm text-slate-600">{kw.volume.toLocaleString()}</td>
                  <td className="py-3 text-center">
                    <span className={`badge ${
                      kw.difficulty === "低" ? "badge-success" :
                      kw.difficulty === "中" ? "badge-warning" : "badge-danger"
                    }`}>
                      {kw.difficulty}
                    </span>
                  </td>
                  <td className="py-3 text-center">
                    <span className="badge badge-info">候補</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-4 flex gap-3">
            <input
              type="text"
              className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2"
              placeholder="任意のキーワードを追加..."
            />
            <button className="px-4 py-2 bg-slate-100 text-slate-600 text-sm rounded-lg hover:bg-slate-200 transition">
              追加
            </button>
          </div>

          <div className="mt-6 flex gap-3">
            <button className="px-6 py-2.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition font-medium">
              選択したKWを確定 → 全機能に反映
            </button>
            <button className="px-4 py-2.5 border border-slate-200 text-sm rounded-lg hover:bg-slate-50 transition">
              ボリューム再測定
            </button>
          </div>
        </div>
      )}

      {/* Profile tab */}
      {activeTab === "profile" && (
        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
          <h3 className="text-sm font-semibold text-slate-500 mb-6">プロフィール情報の整備</h3>

          <div className="space-y-6">
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-2">カテゴリ設定（AIが推奨）</label>
              <div className="space-y-2">
                {suggestedCategories.map((cat, i) => (
                  <label key={cat.main} className="flex items-center gap-3 p-3 border border-slate-100 rounded-lg hover:bg-slate-50">
                    <input type="checkbox" className="rounded" defaultChecked={cat.selected} />
                    <span className="text-sm text-slate-700">{cat.main}</span>
                    {i === 0 && <span className="badge badge-info">メインカテゴリ</span>}
                    {cat.selected && i > 0 && <span className="badge badge-purple">サブカテゴリ</span>}
                    <span className="text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full ml-auto">AI推奨</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-600 block mb-2">属性設定</label>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                {[
                  "Wi-Fi あり", "個室あり", "テラス席あり", "クレジットカード可",
                  "電子マネー可", "QRコード決済可", "駐車場なし", "予約可能",
                  "テイクアウト可", "デリバリーなし", "バリアフリー", "ペット不可",
                ].map((attr, idx) => (
                  <label key={attr} className="flex items-center gap-2 p-2 border border-slate-100 rounded-lg text-sm">
                    <input type="checkbox" className="rounded" defaultChecked={idx % 2 === 0} />
                    <span className="text-slate-600">{attr}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-600 block mb-2">メニュー一括登録</label>
              <div className="border-2 border-dashed border-slate-200 rounded-lg p-8 text-center">
                <p className="text-sm text-slate-500 mb-2">CSVファイルをドラッグ&ドロップ</p>
                <p className="text-xs text-slate-400 mb-3">または</p>
                <button className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition">
                  ファイルを選択
                </button>
                <p className="text-xs text-slate-400 mt-2">対応形式: CSV, Excel（自動でGBPのメニュー・商品・サービスに反映）</p>
              </div>
            </div>

            <button className="px-6 py-2.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition font-medium">
              GBPに反映する
            </button>
          </div>
        </div>
      )}

      {/* Additional features shown across all tabs */}
      {(activeTab === "hearing" || activeTab === "profile") && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
          {/* 反映前情報の自動保存 */}
          <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
            <h3 className="text-sm font-semibold text-slate-500 mb-3">初期整備反映前の自動保存</h3>
            <p className="text-xs text-slate-400 mb-3">GBPに反映する前の状態をすべて自動バックアップ。いつでも復元可能。</p>
            <div className="space-y-2">
              {[
                { date: "2026-03-01 10:00", items: "全項目", status: "保存済み" },
                { date: "2026-02-15 14:30", items: "カテゴリ・説明文", status: "保存済み" },
              ].map((b) => (
                <div key={b.date} className="flex items-center justify-between p-2 bg-slate-50 rounded-lg">
                  <div>
                    <p className="text-xs text-slate-600">{b.date}</p>
                    <p className="text-[10px] text-slate-400">{b.items}</p>
                  </div>
                  <div className="flex gap-1">
                    <span className="badge badge-success">{b.status}</span>
                    <button className="text-[10px] px-2 py-1 bg-blue-50 text-blue-600 rounded">復元</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 基礎情報と多媒体の一致確認 */}
          <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
            <h3 className="text-sm font-semibold text-slate-500 mb-3">いただいた基礎情報と多媒体の一致を確認</h3>
            <p className="text-xs text-slate-400 mb-3">ヒアリングDBの基礎情報と食べログ/ホットペッパー/HP等の各APIからNAP情報を取得→項目別に自動比較→不一致箇所をハイライト表示</p>
            <div className="space-y-2">
              {[
                { platform: "食べログ", match: false, detail: "電話番号が不一致: 03-9876-5432" },
                { platform: "ホットペッパー", match: true, detail: "全項目一致" },
                { platform: "自社HP", match: false, detail: "営業時間が不一致: 17:00-22:30" },
                { platform: "Instagram", match: true, detail: "全項目一致" },
              ].map((p) => (
                <div key={p.platform} className="flex items-center justify-between p-2 bg-slate-50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${p.match ? "bg-emerald-500" : "bg-red-500"}`} />
                    <div>
                      <p className="text-xs font-medium text-slate-700">{p.platform}</p>
                      <p className="text-[10px] text-slate-400">{p.detail}</p>
                    </div>
                  </div>
                  {!p.match && <button className="text-[10px] px-2 py-1 bg-red-50 text-red-600 rounded">修正依頼</button>}
                </div>
              ))}
            </div>
          </div>

          {/* ROI自動算出 */}
          <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
            <h3 className="text-sm font-semibold text-slate-500 mb-3">ROI自動算出</h3>
            <p className="text-xs text-slate-400 mb-3">MEO対策費用 vs 推定来店数・売上の投資対効果を自動計算</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-blue-50 rounded-lg p-3 text-center">
                <p className="text-[10px] text-blue-500">月間MEO費用</p>
                <p className="text-lg font-bold text-blue-700">¥50,000</p>
              </div>
              <div className="bg-emerald-50 rounded-lg p-3 text-center">
                <p className="text-[10px] text-emerald-500">推定売上増加</p>
                <p className="text-lg font-bold text-emerald-700">¥320,000</p>
              </div>
              <div className="bg-purple-50 rounded-lg p-3 text-center">
                <p className="text-[10px] text-purple-500">推定来店数増</p>
                <p className="text-lg font-bold text-purple-700">+64人/月</p>
              </div>
              <div className="bg-amber-50 rounded-lg p-3 text-center">
                <p className="text-[10px] text-amber-600">ROI</p>
                <p className="text-lg font-bold text-amber-700">640%</p>
              </div>
            </div>
          </div>

          {/* 業界平均ベンチマーク */}
          <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
            <h3 className="text-sm font-semibold text-slate-500 mb-3">業界平均ベンチマーク</h3>
            <p className="text-xs text-slate-400 mb-3">同業種・同エリアの平均値と比較して自店舗の立ち位置を可視化</p>
            <div className="space-y-2">
              {[
                { item: "口コミ数", self: 287, avg: 210, better: true },
                { item: "平均評価", self: 4.2, avg: 3.8, better: true },
                { item: "写真数", self: 45, avg: 62, better: false },
                { item: "投稿頻度/月", self: 4, avg: 8, better: false },
                { item: "返信率", self: "65%", avg: "78%", better: false },
              ].map((row) => (
                <div key={row.item} className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0">
                  <span className="text-xs text-slate-600">{row.item}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-400">業界平均: {row.avg}</span>
                    <span className={`text-xs font-bold ${row.better ? "text-emerald-600" : "text-red-600"}`}>
                      自店舗: {row.self} {row.better ? "✓" : "✗"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 自動メール配信レポート設定 */}
          <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 md:col-span-2">
            <h3 className="text-sm font-semibold text-slate-500 mb-3">自動メール配信レポート設定</h3>
            <p className="text-xs text-slate-400 mb-3">設定した頻度でクライアントにレポートを自動メール送信</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">配信頻度</label>
                <select className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2">
                  <option>毎週月曜日</option>
                  <option>毎月1日</option>
                  <option>毎月15日</option>
                  <option>隔週月曜日</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">送信先メール</label>
                <input type="email" className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2" defaultValue="client@example.com" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">レポート形式</label>
                <select className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2">
                  <option>PDF + サマリーメール</option>
                  <option>PDFのみ</option>
                  <option>Webリンク</option>
                </select>
              </div>
            </div>
            <button className="mt-3 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition">
              自動配信を有効化
            </button>
          </div>
        </div>
      )}

      {/* Description tab */}
      {activeTab === "description" && (
        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
          <h3 className="text-sm font-semibold text-slate-500 mb-4">説明文の自動生成</h3>
          <p className="text-xs text-slate-400 mb-4">
            ヒアリング情報 + 対策KW + AIO/LLMO最適化 + Chubby独自ルールを組み合わせて最適な説明文を生成します
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">含めるキーワード</label>
              <div className="flex flex-wrap gap-1 mb-4">
                {["渋谷 焼肉", "和牛", "個室", "デート"].map((kw) => (
                  <span key={kw} className="badge badge-info">{kw} ✕</span>
                ))}
              </div>
              <button className="w-full px-4 py-3 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 transition font-medium mb-4">
                🤖 説明文を生成する
              </button>
              <div className="p-3 bg-slate-50 rounded-lg text-xs text-slate-500 space-y-1">
                <p>文字数: 750文字中 480文字使用</p>
                <p>KW含有率: 良好（自然な配置）</p>
                <p>AIO最適化: 適用済み</p>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">生成された説明文</label>
              <textarea
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 h-[240px]"
                defaultValue={`渋谷・道玄坂エリアで極上の焼肉をお探しなら「焼肉ダイニング 炎」へ。厳選されたA5ランクの黒毛和牛を中心に、上質なお肉を炭火焼きでご提供いたします。

デートや記念日に最適な落ち着いた個室も完備。渋谷駅から徒歩5分の好立地で、大切な方とのお食事にぴったりの空間をご用意しております。

ランチタイムはお得なセットメニューをご用意。ディナーでは職人が丁寧に仕込んだ特選和牛コースが人気です。

渋谷で焼肉をお楽しみいただくなら、ぜひ当店へお越しください。スタッフ一同、心よりお待ちしております。`}
              />
              <div className="flex gap-2 mt-3">
                <button className="flex-1 px-3 py-2 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700">
                  GBPに反映
                </button>
                <button className="px-3 py-2 border border-slate-200 text-xs rounded-lg hover:bg-slate-50">
                  再生成
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
