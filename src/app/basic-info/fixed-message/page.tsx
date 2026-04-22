"use client";

import { useState, useEffect, useCallback } from "react";
import { useShop } from "@/components/shop-provider";
import api from "@/lib/api";

interface FieldEntry {
  key: string;
  value: string;
}

export default function FixedMessagePage() {
  const { apiConnected, selectedShopId, selectedShop } = useShop();
  const [fields, setFields] = useState<FieldEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  const fetchData = useCallback(async () => {
    if (!selectedShopId) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const res = await api.get(`/api/shop/${selectedShopId}/fixed_message`);
      const data = res.data;
      // Convert object to key-value array
      if (data && typeof data === "object") {
        // If data is an array, use it directly; otherwise convert from object
        if (Array.isArray(data)) {
          setFields(data.map((item: any) => ({
            key: String(item.key || item.name || ""),
            value: String(item.value || item.content || ""),
          })));
        } else {
          // Filter out metadata-like fields (id, shop_id, created_at, updated_at)
          const metaKeys = new Set(["id", "shop_id", "created_at", "updated_at", "deleted_at"]);
          const entries = Object.entries(data)
            .filter(([k]) => !metaKeys.has(k))
            .map(([key, value]) => ({
              key,
              value: typeof value === "string" ? value : JSON.stringify(value ?? ""),
            }));
          setFields(entries.length > 0 ? entries : []);
        }
      } else {
        setFields([]);
      }
    } catch (e: any) {
      if (e?.response?.status === 404) {
        // No data yet - start with empty
        setFields([]);
      } else {
        setError(e?.userMessage || "差し込み文字列の取得に失敗しました");
      }
    } finally {
      setLoading(false);
    }
  }, [selectedShopId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleFieldChange = (index: number, value: string) => {
    setFields((prev) =>
      prev.map((f, i) => (i === index ? { ...f, value } : f))
    );
  };

  const handleKeyChange = (index: number, key: string) => {
    setFields((prev) =>
      prev.map((f, i) => (i === index ? { ...f, key } : f))
    );
  };

  const handleRemoveField = (index: number) => {
    setFields((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAddField = () => {
    const trimmedKey = newKey.trim();
    if (!trimmedKey) return;
    if (fields.some((f) => f.key === trimmedKey)) {
      setMessage("同じキー名が既に存在します");
      return;
    }
    setFields((prev) => [...prev, { key: trimmedKey, value: newValue }]);
    setNewKey("");
    setNewValue("");
    setMessage("");
  };

  const handleSave = async () => {
    if (!selectedShopId) return;
    setSaving(true);
    setMessage("");
    try {
      // Convert fields array back to object
      const data: Record<string, string> = {};
      for (const field of fields) {
        if (field.key.trim()) {
          data[field.key.trim()] = field.value;
        }
      }
      await api.put(`/api/shop/${selectedShopId}/fixed_message`, data);
      setMessage("保存しました");
    } catch (e: any) {
      setMessage(`保存失敗: ${e?.response?.data?.message || e?.userMessage || e?.message || "不明なエラー"}`);
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
          {/* Message */}
          {message && (
            <div
              className={`p-3 rounded-lg mb-4 text-sm ${
                message.includes("失敗") ? "bg-red-50 text-red-600 border border-red-200" : "bg-emerald-50 text-emerald-600 border border-emerald-200"
              }`}
            >
              {message}
            </div>
          )}

          {/* Existing fields */}
          <div className="space-y-4 mb-6">
            {fields.length === 0 && (
              <div className="bg-white rounded-xl p-8 shadow-sm border border-slate-100 text-center">
                <p className="text-slate-400 text-sm">
                  まだ差し込み文字列が登録されていません。下の「フィールド追加」から追加してください。
                </p>
              </div>
            )}
            {fields.map((field, index) => (
              <div
                key={index}
                className="bg-white rounded-xl p-5 shadow-sm border border-slate-100"
              >
                <div className="flex items-center justify-between mb-3">
                  <input
                    type="text"
                    value={field.key}
                    onChange={(e) => handleKeyChange(index, e.target.value)}
                    className="text-sm font-semibold text-[#003D6B] bg-transparent border-b border-dashed border-slate-300 focus:border-[#003D6B] focus:outline-none px-1 py-0.5"
                    placeholder="キー名"
                  />
                  <button
                    onClick={() => handleRemoveField(index)}
                    className="text-xs text-red-400 hover:text-red-600 transition px-2 py-1 rounded hover:bg-red-50"
                  >
                    削除
                  </button>
                </div>
                <textarea
                  value={field.value}
                  onChange={(e) => handleFieldChange(index, e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#003D6B]/20 resize-y"
                  placeholder="値を入力..."
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  投稿テンプレート内で <code className="bg-slate-100 px-1 rounded">{`{${field.key}}`}</code> として使用できます
                </p>
              </div>
            ))}
          </div>

          {/* Add new field */}
          <div className="bg-slate-50 rounded-xl p-5 border border-slate-200 mb-6">
            <h3 className="text-sm font-semibold text-slate-600 mb-3">フィールド追加</h3>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="sm:w-1/3">
                <label className="text-[10px] text-slate-500 block mb-1">キー名</label>
                <input
                  type="text"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  placeholder="例: store_name, greeting, hashtags"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#003D6B]/20"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddField();
                  }}
                />
              </div>
              <div className="flex-1">
                <label className="text-[10px] text-slate-500 block mb-1">値</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                    placeholder="例: サンプル店舗, #MEO #Googleマップ"
                    className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#003D6B]/20"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddField();
                    }}
                  />
                  <button
                    onClick={handleAddField}
                    disabled={!newKey.trim()}
                    className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-600 text-white hover:bg-slate-700 disabled:opacity-50 transition whitespace-nowrap"
                  >
                    追加
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Save button */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-2.5 rounded-lg text-sm font-semibold bg-[#003D6B] text-white hover:bg-[#002a4a] disabled:opacity-50 transition"
            >
              {saving ? "保存中..." : "保存する"}
            </button>
            <button
              onClick={fetchData}
              disabled={loading}
              className="px-4 py-2.5 rounded-lg text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-50 transition"
            >
              リセット
            </button>
          </div>
        </>
      )}
    </div>
  );
}
