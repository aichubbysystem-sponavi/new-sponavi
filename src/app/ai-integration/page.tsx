"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import api from "@/lib/api";

interface DifyStatus {
  connected: boolean;
  error?: string;
}

export default function AiIntegrationPage() {
  const [difyStatus, setDifyStatus] = useState<DifyStatus | null>(null);
  const [testing, setTesting] = useState(false);

  const testDifyConnection = async () => {
    setTesting(true);
    try {
      const res = await api.post("/api/chat", {
        query: "接続テスト。一言で返答してください。",
        userId: "test-connection",
      }, { timeout: 30000 });
      setDifyStatus({ connected: !!res.data.answer });
    } catch (e: any) {
      setDifyStatus({ connected: false, error: e?.response?.data?.error || e?.message || "接続失敗" });
    } finally {
      setTesting(false);
    }
  };

  useEffect(() => { testDifyConnection(); }, []);

  const integrations = [
    {
      name: "Dify AI社長",
      description: "社内ナレッジベースRAG。MEOマニュアル・会議録・業務ルールから回答",
      status: difyStatus === null ? "checking" : difyStatus.connected ? "connected" : "error",
      statusLabel: difyStatus === null ? "確認中..." : difyStatus.connected ? "接続済み" : "未接続",
      error: difyStatus?.error,
      details: [
        { label: "ホスト", value: "VPS (162.43.39.90)" },
        { label: "エンジン", value: "Dify Chatflow" },
        { label: "ナレッジベース", value: "Chubby社内ナレッジ" },
        { label: "応答モード", value: "Blocking (同期)" },
      ],
      actions: [
        { label: "AI社長とチャット", href: "/chatbot", primary: true },
      ],
    },
    {
      name: "Slack Bot",
      description: "@AI社長メンションで質問応答。社長の訂正から自動学習",
      status: "connected",
      statusLabel: "稼働中",
      details: [
        { label: "接続方式", value: "Socket Mode" },
        { label: "稼働サーバー", value: "XサーバーVPS (PM2)" },
        { label: "監視チャンネル", value: "#chubby-core" },
        { label: "リマインダー", value: "15分間隔チェック" },
      ],
      actions: [],
    },
    {
      name: "ナレッジベース",
      description: "AI社長が参照する知識データ。自動更新・手動追加に対応",
      status: "connected",
      statusLabel: "同期中",
      details: [
        { label: "埋め込みモデル", value: "text-embedding-3-small" },
        { label: "インデックス", value: "高品質 (ベクトル検索)" },
        { label: "チャンク長", value: "1024トークン" },
        { label: "データソース", value: "4スプレッドシート + tldv会議録228件 + 社内PDF" },
      ],
      actions: [],
    },
    {
      name: "tldv 会議録同期",
      description: "オンライン会議の録画・議事録を自動でナレッジベースに同期",
      status: "connected",
      statusLabel: "自動同期中",
      details: [
        { label: "同期スケジュール", value: "毎日 06:00 (JST)" },
        { label: "同期済み件数", value: "228件" },
        { label: "同期方式", value: "差分同期 (新規のみ)" },
      ],
      actions: [],
    },
    {
      name: "スプレッドシート監視",
      description: "業務スプレッドシートのエラーを自動検知・Slack通知",
      status: "connected",
      statusLabel: "監視中",
      details: [
        { label: "チェックスケジュール", value: "毎日 07:00 (JST)" },
        { label: "監視対象", value: "4シート (初期整備/顧客管理/レポート/業務ルール)" },
        { label: "通知先", value: "Slack #alerts" },
      ],
      actions: [],
    },
    {
      name: "口コミAI返信",
      description: "Claude Haiku 4.5でGBP口コミへの返信案を自動生成",
      status: "connected",
      statusLabel: "利用可能",
      details: [
        { label: "モデル", value: "claude-haiku-4-5-20251001" },
        { label: "最大文字数", value: "150文字" },
        { label: "トーン", value: "評価に応じて自動調整" },
        { label: "GBP投稿", value: "ワンクリック対応" },
      ],
      actions: [
        { label: "口コミ管理へ", href: "/reviews", primary: false },
      ],
    },
    {
      name: "口コミAI分析",
      description: "Claude Haiku 4.5で口コミの感情分析・キーワード抽出",
      status: "connected",
      statusLabel: "利用可能",
      details: [
        { label: "分析内容", value: "ポジティブ/ネガティブワード + 総評" },
        { label: "レポート連携", value: "P10/P11に自動反映" },
        { label: "保存先", value: "Supabase report_analysis" },
      ],
      actions: [
        { label: "口コミ分析へ", href: "/review-analysis", primary: false },
      ],
    },
  ];

  const statusStyles: Record<string, { dot: string; bg: string; text: string }> = {
    connected: { dot: "bg-emerald-400", bg: "bg-emerald-50", text: "text-emerald-700" },
    error: { dot: "bg-red-400", bg: "bg-red-50", text: "text-red-700" },
    checking: { dot: "bg-amber-400 animate-pulse", bg: "bg-amber-50", text: "text-amber-700" },
  };

  const connectedCount = integrations.filter((i) => i.status === "connected").length;

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">AI統合管理</h1>
          <p className="text-slate-500 text-sm mt-1">Difyナレッジベース・Slack連携・自動タスク</p>
        </div>
        <button
          onClick={testDifyConnection}
          disabled={testing}
          className={`px-4 py-2 rounded-lg text-sm font-semibold ${testing ? "bg-slate-200 text-slate-400" : "bg-[#003D6B] hover:bg-[#002a4a]"}`}
          style={{ color: testing ? undefined : "#fff" }}
        >
          {testing ? "テスト中..." : "接続テスト"}
        </button>
      </div>

      {/* サマリーカード */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
          <p className="text-[11px] font-medium text-slate-400 mb-1">AI連携数</p>
          <p className="text-2xl font-bold text-[#003D6B]">{integrations.length}<span className="text-xs font-normal text-slate-400 ml-1">サービス</span></p>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
          <p className="text-[11px] font-medium text-slate-400 mb-1">稼働中</p>
          <p className="text-2xl font-bold text-emerald-600">{connectedCount}<span className="text-xs font-normal text-slate-400 ml-1">/ {integrations.length}</span></p>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
          <p className="text-[11px] font-medium text-slate-400 mb-1">Difyステータス</p>
          <div className="flex items-center gap-1.5 mt-1">
            <div className={`w-2.5 h-2.5 rounded-full ${statusStyles[difyStatus === null ? "checking" : difyStatus.connected ? "connected" : "error"].dot}`} />
            <span className={`text-sm font-semibold ${statusStyles[difyStatus === null ? "checking" : difyStatus.connected ? "connected" : "error"].text}`}>
              {difyStatus === null ? "確認中" : difyStatus.connected ? "正常" : "異常"}
            </span>
          </div>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
          <p className="text-[11px] font-medium text-slate-400 mb-1">クイックアクセス</p>
          <Link href="/chatbot" className="text-sm font-semibold text-[#003D6B] hover:underline">AI社長とチャット →</Link>
        </div>
      </div>

      {/* 連携サービス一覧 */}
      <div className="space-y-3">
        {integrations.map((integration, i) => {
          const style = statusStyles[integration.status] || statusStyles.error;
          return (
            <div key={i} className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <h3 className="text-base font-bold text-slate-800">{integration.name}</h3>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${style.bg} ${style.text}`}>
                      <span className={`w-2 h-2 rounded-full ${style.dot}`} />
                      {integration.statusLabel}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {integration.actions.map((action, j) => (
                      <Link key={j} href={action.href}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                          action.primary ? "bg-[#003D6B] hover:bg-[#002a4a] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        }`}>
                        {action.label}
                      </Link>
                    ))}
                  </div>
                </div>
                <p className="text-sm text-slate-500 mb-3">{integration.description}</p>
                {integration.error && (
                  <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3">エラー: {integration.error}</p>
                )}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {integration.details.map((detail, j) => (
                    <div key={j} className="bg-slate-50 rounded-lg px-3 py-2">
                      <p className="text-[10px] text-slate-400">{detail.label}</p>
                      <p className="text-xs font-medium text-slate-700">{detail.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
