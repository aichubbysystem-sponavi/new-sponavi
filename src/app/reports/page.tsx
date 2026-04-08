"use client";

import { useState, useEffect, useCallback } from "react";
import { useShop } from "@/components/shop-provider";
import api from "@/lib/api";

interface PerfEntry {
  id: string;
  shop_id: string;
  from: string;
  to: string;
  spreadsheet_url: string | null;
  drive_folder_url: string | null;
  download_url: string | null;
}

export default function ReportsPage() {
  const { apiConnected, selectedShopId, selectedShop } = useShop();
  const [entries, setEntries] = useState<PerfEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchPerf = useCallback(async () => {
    if (!selectedShopId) return;
    setLoading(true);
    try {
      const res = await api.get(`/api/performance/${selectedShopId}`);
      setEntries(Array.isArray(res.data) ? res.data : []);
    } catch { setEntries([]); }
    finally { setLoading(false); }
  }, [selectedShopId]);

  useEffect(() => { fetchPerf(); }, [fetchPerf]);

  return (
    <div className="animate-fade-in">
      <h1 className="text-2xl font-bold text-slate-800 mb-2">店舗パフォーマンス</h1>
      <p className="text-sm text-slate-500 mb-6">{selectedShop?.name || "店舗を選択"} — 月次パフォーマンスレポート</p>

      {!apiConnected || !selectedShopId ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">{apiConnected ? "店舗を選択してください" : "Go APIに接続し、店舗を登録すると利用できます"}</p>
        </div>
      ) : loading ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">読み込み中...</p>
        </div>
      ) : entries.length === 0 ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm mb-2">パフォーマンスデータがありません</p>
          <p className="text-slate-300 text-xs">月次レポートを生成するとここに表示されます</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-3 px-4 text-slate-500 font-medium">期間</th>
                <th className="text-center py-3 px-4 text-slate-500 font-medium">スプレッドシート</th>
                <th className="text-center py-3 px-4 text-slate-500 font-medium">Driveフォルダ</th>
                <th className="text-center py-3 px-4 text-slate-500 font-medium">ダウンロード</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-3 px-4 text-slate-700 font-medium">{e.from} 〜 {e.to}</td>
                  <td className="py-3 px-4 text-center">
                    {e.spreadsheet_url ? (
                      <a href={e.spreadsheet_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-xs">開く</a>
                    ) : <span className="text-slate-300 text-xs">-</span>}
                  </td>
                  <td className="py-3 px-4 text-center">
                    {e.drive_folder_url ? (
                      <a href={e.drive_folder_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-xs">開く</a>
                    ) : <span className="text-slate-300 text-xs">-</span>}
                  </td>
                  <td className="py-3 px-4 text-center">
                    {e.download_url ? (
                      <a href={e.download_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-xs">DL</a>
                    ) : <span className="text-slate-300 text-xs">-</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
