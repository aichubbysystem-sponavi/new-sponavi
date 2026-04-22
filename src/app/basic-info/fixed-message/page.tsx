"use client";

import { useState, useEffect, useCallback } from "react";
import { useShop } from "@/components/shop-provider";
import api from "@/lib/api";

interface FieldEntry {
  id?: string;
  title: string;
  message: string;
}

export default function FixedMessagePage() {
  const { apiConnected, selectedShopId, selectedShop, refreshShops } = useShop();
  const [fields, setFields] = useState<FieldEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const fetchData = useCallback(async () => {
    if (!selectedShopId) return;
    setLoading(true);
    setError("");
    setMsg("");

    // まず店舗データのプリロード済みfixed_messagesを使う
    const preloaded = (selectedShop as any)?.fixed_messages;
    console.log("[fixed_message] selectedShop keys:", selectedShop ? Object.keys(selectedShop) : "null");
    console.log("[fixed_message] preloaded:", JSON.stringify(preloaded)?.slice(0, 500));
    if (Array.isArray(preloaded) && preloaded.length > 0) {
      setFields(preloaded.map((m: any) => ({
        id: m.id || undefined,
        title: String(m.title || ""),
        message: String(m.message || ""),
      })));
      setLoading(false);
      return;
    }

    // フォールバック: APIエンドポイントから取得
    try {
      const res = await api.get(`/api/shop/${selectedShopId}/fixed_message`);
      const data = res.data;
      console.log("[fixed_message] API fallback response:", JSON.stringify(data)?.slice(0, 500));
      if (Array.isArray(data) && data.length > 0) {
        setFields(data.map((item: any) => ({
          id: item.id || undefined,
          title: String(item.title || ""),
          message: String(item.message || ""),
        })));
      } else {
        setFields([]);
      }
    } catch (e: any) {
      if (e?.response?.status === 404) {
        setFields([]);
      } else {
        setError(e?.userMessage || "差し込み文字列の取得に失敗しました");
      }
    } finally {
      setLoading(false);
    }
  }, [selectedShopId, selectedShop]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleTitleChange = (index: number, title: string) => {
    setFields(prev => prev.map((f, i) => (i === index ? { ...f, title } : f)));
  };

  const handleMessageChange = (index: number, message: string) => {
    setFields(prev => prev.map((f, i) => (i === index ? { ...f, message } : f)));
  };

  const handleRemoveField = (index: number) => {
    if (!confirm(`設定${index + 1}「${fields[index]?.title || ""}」を削除しますか？`)) return;
    setFields(prev => prev.filter((_, i) => i !== index));
  };

  const handleAddField = () => {
    setFields(prev => [...prev, { title: "", message: "" }]);
  };

  const handleSave = async () => {
    if (!selectedShopId) return;
    setSaving(true);
    setMsg("");
    try {
      // POST + { messages: [...] } 形式（旧システムと同じ形式）
      const messages = fields.filter(f => f.title.trim()).map(f => ({
        ...(f.id ? { id: f.id } : {}),
        title: f.title.trim(),
        message: f.message,
      }));
      await api.post(`/api/shop/${selectedShopId}/fixed_message`, { messages });
      setMsg("保存しました");
      await refreshShops(); // 店舗データを再取得してプリロード済みfixed_messagesを更新
    } catch (e: any) {
      setMsg(`保存失敗: ${e?.response?.data?.message || e?.userMessage || e?.message || "不明なエラー"}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="animate-fade-in">
      <h1 className="text-2xl font-bold text-slate-800 mb-2">差し込み文字列設定</h1>
      <p className="text-sm text-slate-500 mb-6">
        GBP投稿や口コミ返信に自動挿入されるテンプレート変数を店舗ごとに管理します
      </p>

      {selectedShop && (
        <div className="mb-6 flex items-center gap-2">
          <span className="text-xs text-slate-400">選択中の店舗:</span>
          <span className="text-sm font-semibold text-[#003D6B]">{selectedShop.name}</span>
        </div>
      )}

      {!apiConnected || !selectedShopId ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">
            {apiConnected ? "店舗を選択してください" : "Go APIに接続し、店舗を登録すると利用できます"}
          </p>
        </div>
      ) : loading ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">読み込み中...</p>
        </div>
      ) : error ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      ) : (
        <>
          {msg && (
            <div className={`p-3 rounded-lg mb-4 text-sm ${msg.includes("失敗") ? "bg-red-50 text-red-600 border border-red-200" : "bg-emerald-50 text-emerald-600 border border-emerald-200"}`}>
              {msg}
            </div>
          )}

          <div className="space-y-5 mb-6">
            {fields.length === 0 && (
              <div className="bg-white rounded-xl p-8 shadow-sm border border-slate-100 text-center">
                <p className="text-slate-400 text-sm">まだ差し込み文字列が登録されていません</p>
              </div>
            )}
            {fields.map((field, index) => (
              <div key={index} className="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-bold text-slate-700">設定{index + 1}</h3>
                  <button onClick={() => handleRemoveField(index)} className="text-xs text-red-400 hover:text-red-600 flex items-center gap-1">
                    <span>⊖</span> 削除
                  </button>
                </div>
                <div className="mb-4">
                  <label className="text-sm font-semibold text-slate-600 block mb-1">タイトル<span className="text-red-500">*</span></label>
                  <input type="text" value={field.title} onChange={(e) => handleTitleChange(index, e.target.value)}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#003D6B]/20"
                    placeholder="例: 日本語の定型文" />
                </div>
                <div>
                  <label className="text-sm font-semibold text-slate-600 block mb-1">差し込み文字列<span className="text-red-500">*</span></label>
                  <textarea value={field.message} onChange={(e) => handleMessageChange(index, e.target.value)}
                    rows={4} className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#003D6B]/20 resize-y"
                    placeholder="投稿に自動挿入される文字列を入力..." />
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <button onClick={handleAddField} className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition">+ 設定追加</button>
            <button onClick={handleSave} disabled={saving} className="px-6 py-2.5 rounded-lg text-sm font-semibold bg-[#003D6B] text-white hover:bg-[#002a4a] disabled:opacity-50 transition">
              {saving ? "保存中..." : "保存する"}
            </button>
            <button onClick={fetchData} disabled={loading} className="px-4 py-2.5 rounded-lg text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-50 transition">リセット</button>
          </div>
        </>
      )}
    </div>
  );
}
