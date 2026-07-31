"use client";

import { useState } from "react";
import api from "@/lib/api";

// 全店舗まとめCSVエクスポート
// 各項目 = /api/export?type=xxx&month=YYYY-MM（社長・幹部・社員のみ）

interface ExportItem {
  type: string;
  label: string;
  desc: string;
  note?: string;
}

const ITEMS: ExportItem[] = [
  {
    type: "insights",
    label: "レポート数値（インサイト）",
    desc: "Google検索・マップ表示、ウェブサイト・ルート・通話・予約などの月次数値",
  },
  {
    type: "search-keywords",
    label: "検索語句",
    desc: "店舗ごとの検索語句と表示回数（表示回数順）",
  },
  {
    type: "grid-ranking",
    label: "多地点順位",
    desc: "中心順位・平均順位・TOP3/TOP10/圏外地点数（店舗×キーワード、同月内は最新計測）",
  },
  {
    type: "reviews",
    label: "口コミ一覧",
    desc: "選択月に投稿された全店舗の口コミ本文・評価・返信状態",
  },
  {
    type: "review-analysis",
    label: "口コミ分析（AI）",
    desc: "AI分析済みのポジティブ/ネガティブワード・総評（分析実行済みの店舗のみ）",
  },
  {
    type: "review-language",
    label: "口コミ国別分析",
    desc: "店舗×言語ごとの件数・構成比・星評価内訳・低評価数",
  },
  {
    type: "pmax",
    label: "P-MAX広告",
    desc: "店舗×言語×キャンペーンの表示回数・クリック・CTR・費用",
    note: "店舗名は広告キャンペーン名由来のため、GBP店舗名と表記が異なる場合があります",
  },
  {
    type: "posts",
    label: "投稿ログ",
    desc: "選択月にシステム経由で投稿されたGBP投稿の一覧（店舗・日時・本文）",
  },
];

// 既定は前月（レポート系データは前月=確定月が揃っているため）
function defaultMonth(): string {
  const parts = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit" })
    .format(new Date())
    .split("-");
  let y = Number(parts[0]);
  let m = Number(parts[1]) - 1;
  if (m === 0) { y -= 1; m = 12; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

export default function CsvExportPage() {
  const [month, setMonth] = useState(defaultMonth());
  const [downloading, setDownloading] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});

  const download = async (item: ExportItem) => {
    if (downloading) return;
    setDownloading(item.type);
    setResults((prev) => ({ ...prev, [item.type]: "" }));
    try {
      const res = await api.get(`/api/export?type=${item.type}&month=${month}`, {
        responseType: "blob",
        timeout: 180000,
      });
      const rowCount = res.headers?.["x-row-count"];
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${item.label}_${month}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setResults((prev) => ({
        ...prev,
        [item.type]: rowCount !== undefined ? `✓ ${Number(rowCount).toLocaleString()}行` : "✓ 完了",
      }));
    } catch (e: any) {
      // blobレスポンスのエラーはJSONを読み出してメッセージ表示
      let msg = "エクスポートに失敗しました";
      try {
        const text = await e?.response?.data?.text?.();
        if (text) msg = JSON.parse(text)?.error || msg;
      } catch {}
      setResults((prev) => ({ ...prev, [item.type]: `✗ ${msg}` }));
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="animate-fade-in max-w-4xl">
      <h1 className="text-2xl font-bold text-slate-800 mb-2">CSV一括出力</h1>
      <p className="text-sm text-slate-500 mb-6">
        各データを全店舗まとめてCSVでダウンロードできます（店舗の切り替え不要）
      </p>

      {/* 月選択 */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 mb-6 flex items-center gap-4">
        <label className="text-sm font-medium text-slate-700">対象月</label>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
        />
        <p className="text-xs text-slate-400">
          レポート数値・検索語句などは前月（確定月）までのデータが対象です
        </p>
      </div>

      {/* 項目一覧 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {ITEMS.map((item) => (
          <div key={item.type} className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 flex flex-col">
            <div className="flex-1">
              <h3 className="font-semibold text-slate-800 text-sm mb-1">{item.label}</h3>
              <p className="text-xs text-slate-500">{item.desc}</p>
              {item.note && <p className="text-xs text-amber-600 mt-1">※{item.note}</p>}
            </div>
            <div className="mt-3 flex items-center justify-between">
              <button
                onClick={() => download(item)}
                disabled={!!downloading || !month}
                className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                  downloading === item.type
                    ? "bg-slate-200 text-slate-500"
                    : "bg-[#003D6B] text-white hover:bg-[#002a4d]"
                }`}
              >
                {downloading === item.type ? "生成中..." : "CSVダウンロード"}
              </button>
              {results[item.type] && (
                <span className={`text-xs ${results[item.type].startsWith("✗") ? "text-red-500" : "text-emerald-600"}`}>
                  {results[item.type]}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-slate-400 mt-6">
        ※ CSVはExcelでそのまま開けます（UTF-8 BOM付き）。データが0行の月はヘッダーのみのファイルになります。
        <br />
        ※ 解約済み店舗のデータは除外されます。ダウンロード操作は操作ログに記録されます。
        <br />
        ※ 店舗診断・店舗パフォーマンスは店舗ごとに外部APIを呼ぶ構造のため一括出力に対応していません。
      </p>
    </div>
  );
}
