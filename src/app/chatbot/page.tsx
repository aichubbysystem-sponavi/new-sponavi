"use client";

import { useState } from "react";
import FeatureCard from "@/components/feature-card";

const chatHistory = [
  { role: "user", text: "口コミの削除申請はどうやればいいですか？" },
  { role: "ai", text: "口コミの削除申請は以下の手順で行えます：\n\n1. Googleマップで該当の口コミを開く\n2. 口コミ右上の「︙」をクリック\n3. 「レビューを報告」を選択\n4. 違反の種類を選択して送信\n\nなお、Googleのポリシーに違反していない口コミは削除されない場合があります。ネガティブな口コミには丁寧に返信することで、他のユーザーに好印象を与えられます。\n\n口コミ管理画面から自動返信候補も生成できますので、ぜひご活用ください。" },
  { role: "user", text: "投稿が拒否されました。原因は？" },
  { role: "ai", text: "投稿が拒否される主な原因は以下の通りです：\n\n1. テキスト内にNGワード（電話番号、URL等）が含まれている\n2. 写真がGoogleのガイドラインに違反している\n3. 同一内容の重複投稿\n4. 不適切なコンテンツと判定された\n\n当システムの「投稿エラー原因特定」機能を使えば、文章を1行ずつ検証して原因を自動特定できます。投稿管理画面からお試しください。" },
];

const quests = [
  { title: "口コミに3件返信する", progress: 1, total: 3, xp: 50, status: "in_progress" },
  { title: "今週の投稿を2件予約する", progress: 2, total: 2, xp: 30, status: "completed" },
  { title: "写真を5枚アップロード", progress: 0, total: 5, xp: 40, status: "not_started" },
  { title: "Q&Aを2件追加する", progress: 0, total: 2, xp: 60, status: "not_started" },
  { title: "営業時間を確認する", progress: 1, total: 1, xp: 10, status: "completed" },
];

export default function ChatbotPage() {
  const [input, setInput] = useState("");

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">チャットボット</h1>
          <p className="text-sm text-slate-500 mt-1">AIサポート・タスク管理・LINE連携</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
        {/* Chat */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 flex flex-col" style={{ height: "500px" }}>
          <div className="p-4 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-500 flex items-center gap-2">
              🤖 AIカスタマーセンター
            </h3>
          </div>
          <div className="flex-1 p-4 overflow-y-auto space-y-3">
            {chatHistory.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] p-3 rounded-xl text-sm whitespace-pre-wrap ${
                  msg.role === "user"
                    ? "bg-blue-600 text-white rounded-br-sm"
                    : "bg-slate-100 text-slate-700 rounded-bl-sm"
                }`}>
                  {msg.text}
                </div>
              </div>
            ))}
          </div>
          <div className="p-4 border-t border-slate-100">
            <div className="flex gap-2">
              <input
                type="text"
                className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2"
                placeholder="MEOについて質問する..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
              <button className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition">
                送信
              </button>
            </div>
            <div className="flex gap-2 mt-2">
              {["口コミ削除方法", "投稿エラーの対処", "順位が下がった"].map((q) => (
                <button
                  key={q}
                  className="text-[10px] px-2 py-1 bg-slate-50 text-slate-500 rounded-full hover:bg-slate-100"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Task quest bot */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100" style={{ height: "500px" }}>
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-500 flex items-center gap-2">
              🎮 タスク追いかけボット
            </h3>
            <div className="flex items-center gap-2">
              <span className="text-xs text-purple-600 font-bold">Lv.5</span>
              <span className="text-xs text-slate-400">190 XP</span>
            </div>
          </div>
          <div className="p-4 overflow-y-auto" style={{ height: "calc(100% - 56px)" }}>
            <div className="mb-4 p-3 bg-purple-50 rounded-lg border border-purple-100">
              <p className="text-xs font-medium text-purple-700">今日のクエスト</p>
              <p className="text-xs text-purple-600 mt-1">3つのタスクを完了してレベルアップ！</p>
            </div>
            <div className="space-y-3">
              {quests.map((quest, i) => (
                <div key={i} className={`p-3 rounded-lg border ${
                  quest.status === "completed" ? "border-emerald-100 bg-emerald-50/50" :
                  quest.status === "in_progress" ? "border-blue-100 bg-blue-50/50" :
                  "border-slate-100"
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm ${
                        quest.status === "completed" ? "text-emerald-500" :
                        quest.status === "in_progress" ? "text-blue-500" : "text-slate-300"
                      }`}>
                        {quest.status === "completed" ? "✅" :
                         quest.status === "in_progress" ? "⏳" : "⬜"}
                      </span>
                      <span className={`text-sm ${
                        quest.status === "completed" ? "text-emerald-700 line-through" : "text-slate-700"
                      }`}>{quest.title}</span>
                    </div>
                    <span className="text-[10px] text-purple-500 font-bold">+{quest.xp} XP</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        quest.status === "completed" ? "bg-emerald-500" :
                        quest.status === "in_progress" ? "bg-blue-500" : "bg-slate-200"
                      }`}
                      style={{ width: `${(quest.progress / quest.total) * 100}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">{quest.progress}/{quest.total}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* LINE integration */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 mb-6">
        <h3 className="text-sm font-semibold text-slate-500 mb-3">LINE連携</h3>
        <p className="text-xs text-slate-400 mb-4">LINEから基礎情報の変更依頼、口コミ返信、削除申請などが可能</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="p-3 bg-green-50 rounded-lg border border-green-100">
            <p className="text-xs font-medium text-green-700">📱 変更指示</p>
            <p className="text-xs text-green-600 mt-1">LINEで営業時間や電話番号の変更をAIに依頼</p>
          </div>
          <div className="p-3 bg-green-50 rounded-lg border border-green-100">
            <p className="text-xs font-medium text-green-700">💬 口コミ返信</p>
            <p className="text-xs text-green-600 mt-1">LINEで口コミを確認し返信候補を選択・送信</p>
          </div>
          <div className="p-3 bg-green-50 rounded-lg border border-green-100">
            <p className="text-xs font-medium text-green-700">🗑️ 削除申請</p>
            <p className="text-xs text-green-600 mt-1">LINE上でワンタップで口コミ削除申請を実行</p>
          </div>
        </div>
      </div>

      {/* All features */}
      <h3 className="text-sm font-semibold text-slate-500 mb-3">チャットボット 機能一覧</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <FeatureCard icon="❓" title="MEOについての質問コーナー" description="チャットボットで削除申請の仕方、投稿方法などをすぐに確認。" status="active" />
        <FeatureCard icon="💚" title="LINEでの変更指示" description="LINEで基礎情報の変更依頼、口コミ返信、削除申請などが可能。" status="active" />
        <FeatureCard icon="🤖" title="AIカスタマーセンター" description="チャットツールと連携して使用。MEOに関するあらゆる質問に対応。" status="active" />
        <FeatureCard icon="🎮" title="タスク追いかけボット" description="ゲームのクエストのように、日々のMEO作業をタスク化してモチベーション管理。" status="beta" />
      </div>
    </div>
  );
}
