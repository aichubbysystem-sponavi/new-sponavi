"use client";

import { useState, useRef, useEffect } from "react";
import { useShop } from "@/components/shop-provider";
import api from "@/lib/api";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

const QUICK_QUESTIONS = [
  "MEO対策の基本的な流れを教えて",
  "口コミ返信のコツは？",
  "GBP投稿のベストプラクティスは？",
  "順位が下がった時の対処法",
  "新規店舗の初期整備手順",
  "写真投稿のポイント",
];

export default function ChatbotPage() {
  const { selectedShop } = useShop();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const sendMessage = async (text?: string) => {
    const query = text || input.trim();
    if (!query || loading) return;

    setInput("");
    setError("");
    const userMsg: Message = { role: "user", content: query, timestamp: new Date() };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await api.post("/api/chat", {
        query,
        conversationId,
        userId: `web-${selectedShop?.name || "user"}`,
      }, { timeout: 100000 });

      const aiMsg: Message = { role: "assistant", content: res.data.answer || "回答を取得できませんでした", timestamp: new Date() };
      setMessages((prev) => [...prev, aiMsg]);

      if (res.data.conversationId) {
        setConversationId(res.data.conversationId);
      }
    } catch (e: any) {
      const errMsg = e?.response?.data?.error || e?.message || "エラーが発生しました";
      setError(errMsg);
      setMessages((prev) => [...prev, { role: "assistant", content: `エラー: ${errMsg}`, timestamp: new Date() }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleNewChat = () => {
    setMessages([]);
    setConversationId(null);
    setError("");
  };

  return (
    <div className="animate-fade-in flex flex-col" style={{ height: "calc(100vh - 100px)" }}>
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">AI社長</h1>
          <p className="text-sm text-slate-500 mt-0.5">MEO・GBP・業務に関する質問にAIが回答します</p>
        </div>
        <div className="flex items-center gap-2">
          {conversationId && (
            <button
              onClick={handleNewChat}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-all"
            >
              新しい会話
            </button>
          )}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-medium text-emerald-700">Dify連携中</span>
          </div>
        </div>
      </div>

      {/* チャットエリア */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto bg-white rounded-xl shadow-sm border border-slate-100 p-4 mb-3">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 rounded-full bg-[#003D6B] flex items-center justify-center mb-4">
              <span className="text-2xl text-white font-bold">AI</span>
            </div>
            <h3 className="text-lg font-bold text-slate-700 mb-2">AI社長に質問してみましょう</h3>
            <p className="text-sm text-slate-400 mb-6 max-w-md">
              MEO対策、GBP運用、業務マニュアルなど、社内ナレッジベースから回答します。
              {selectedShop && <span className="block mt-1">現在選択中: {selectedShop.name}</span>}
            </p>

            {/* クイック質問 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 w-full max-w-lg">
              {QUICK_QUESTIONS.map((q, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(q)}
                  className="text-left px-4 py-3 rounded-xl border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 hover:border-[#003D6B]/30 transition-all"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[75%] ${msg.role === "user" ? "order-1" : ""}`}>
                  <div className={`flex items-start gap-2 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                    {/* アバター */}
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                      msg.role === "user" ? "bg-[#003D6B]" : "bg-slate-700"
                    }`}>
                      <span className="text-xs text-white font-bold">{msg.role === "user" ? "You" : "AI"}</span>
                    </div>
                    {/* メッセージ */}
                    <div className={`rounded-2xl px-4 py-3 ${
                      msg.role === "user"
                        ? "bg-[#003D6B] text-white"
                        : "bg-slate-100 text-slate-800"
                    }`}>
                      <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                    </div>
                  </div>
                  <p className={`text-[10px] text-slate-400 mt-1 ${msg.role === "user" ? "text-right mr-10" : "ml-10"}`}>
                    {msg.timestamp.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </div>
            ))}

            {/* タイピングインジケーター */}
            {loading && (
              <div className="flex justify-start">
                <div className="flex items-start gap-2">
                  <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs text-white font-bold">AI</span>
                  </div>
                  <div className="bg-slate-100 rounded-2xl px-4 py-3">
                    <div className="flex gap-1.5">
                      <div className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                      <div className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                      <div className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 入力エリア */}
      <div className="flex-shrink-0 bg-white rounded-xl shadow-sm border border-slate-100 p-3">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="AI社長に質問する...（Enterで送信、Shift+Enterで改行）"
            className="flex-1 border border-slate-200 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#003D6B]/20"
            rows={1}
            disabled={loading}
          />
          <button
            onClick={() => sendMessage()}
            disabled={loading || !input.trim()}
            className={`px-5 py-3 rounded-xl text-sm font-semibold transition-all flex-shrink-0 ${
              loading || !input.trim()
                ? "bg-slate-200 text-slate-400"
                : "bg-[#003D6B] hover:bg-[#002a4a]"
            }`}
            style={{ color: loading || !input.trim() ? undefined : "#fff" }}
          >
            {loading ? "回答中..." : "送信"}
          </button>
        </div>
        <p className="text-[10px] text-slate-400 mt-1.5 text-center">
          AI社長はDifyナレッジベース（MEOマニュアル・会議録・業務ルール）を参照して回答します
        </p>
      </div>
    </div>
  );
}
