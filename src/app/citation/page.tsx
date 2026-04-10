"use client";

import { useState, useEffect, useCallback } from "react";
import { useShop } from "@/components/shop-provider";
import api from "@/lib/api";

interface GBPLocation {
  title?: string;
  phoneNumbers?: { primaryPhone?: string };
  storefrontAddress?: {
    addressLines?: string[];
    locality?: string;
    administrativeArea?: string;
    postalCode?: string;
  };
  websiteUri?: string;
  regularHours?: { periods?: { openDay: string; openTime: string; closeDay: string; closeTime: string }[] };
  categories?: { primaryCategory?: { displayName?: string }; additionalCategories?: { displayName?: string }[] };
}

const DAY_MAP: Record<string, string> = {
  MONDAY: "月", TUESDAY: "火", WEDNESDAY: "水", THURSDAY: "木",
  FRIDAY: "金", SATURDAY: "土", SUNDAY: "日",
};

export default function CitationPage() {
  const { selectedShopId, selectedShop, apiConnected } = useShop();
  const [gbpData, setGbpData] = useState<GBPLocation | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    if (!selectedShopId) return;
    setLoading(true);
    try {
      const res = await api.get(`/api/shop/${selectedShopId}/location`);
      setGbpData(res.data || null);
    } catch {
      setGbpData(null);
    } finally {
      setLoading(false);
    }
  }, [selectedShopId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // NAP比較
  const napItems: { label: string; db: string; gbp: string }[] = [];
  if (selectedShop) {
    const shop = selectedShop as any;
    const addr = gbpData?.storefrontAddress;
    napItems.push(
      { label: "店舗名", db: shop.name || "", gbp: gbpData?.title || "" },
      { label: "住所", db: `${shop.state || ""}${shop.city || ""}${shop.address || ""}${shop.building || ""}`, gbp: addr ? `${addr.administrativeArea || ""}${addr.locality || ""}${(addr.addressLines || []).join("")}` : "" },
      { label: "電話番号", db: shop.phone || "", gbp: gbpData?.phoneNumbers?.primaryPhone || "" },
    );
  }

  const checkMatch = (db: string, gbp: string) => {
    if (!db && !gbp) return "empty";
    if (!db || !gbp) return "missing";
    return db.replace(/[\s\-−ー]/g, "") === gbp.replace(/[\s\-−ー]/g, "") ? "match" : "mismatch";
  };

  const statusStyles: Record<string, { icon: string; color: string; bg: string; label: string }> = {
    match: { icon: "✓", color: "text-emerald-600", bg: "bg-emerald-50", label: "一致" },
    mismatch: { icon: "✕", color: "text-red-600", bg: "bg-red-50", label: "不一致" },
    missing: { icon: "△", color: "text-amber-600", bg: "bg-amber-50", label: "データ不足" },
    empty: { icon: "—", color: "text-slate-400", bg: "bg-slate-50", label: "未設定" },
  };

  const matchCount = napItems.filter((n) => checkMatch(n.db, n.gbp) === "match").length;

  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">NAP整合性管理</h1>
        <p className="text-sm text-slate-500 mt-1">店舗名・住所・電話番号の整合性チェック</p>
      </div>

      {!apiConnected || !selectedShopId ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">{apiConnected ? "店舗を選択してください" : "Go APIに接続し、店舗を登録すると利用できます"}</p>
        </div>
      ) : loading ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">読み込み中...</p>
        </div>
      ) : (
        <>
          {/* スコアカード */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6">
            <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
              <p className="text-[11px] font-medium text-slate-400 mb-2">NAP整合性スコア</p>
              <div className="flex items-end gap-2">
                <span className={`text-4xl font-bold ${matchCount === 3 ? "text-emerald-600" : matchCount >= 2 ? "text-amber-600" : "text-red-600"}`}>
                  {matchCount}
                </span>
                <span className="text-lg text-slate-400 mb-1">/ 3</span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                {matchCount === 3 ? "すべて一致しています" : "不一致の項目があります"}
              </p>
            </div>

            {napItems.map((item) => {
              const status = checkMatch(item.db, item.gbp);
              const s = statusStyles[status];
              return (
                <div key={item.label} className={`${s.bg} rounded-xl p-5 shadow-sm border border-slate-100`}>
                  <p className="text-[11px] font-medium text-slate-400 mb-2">{item.label}</p>
                  <div className="flex items-center gap-2">
                    <span className={`text-2xl font-bold ${s.color}`}>{s.icon}</span>
                    <span className={`text-sm font-semibold ${s.color}`}>{s.label}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* NAP比較テーブル */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 mb-6">
            <div className="p-4 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-500">NAP情報 比較</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="text-left p-3 text-slate-500 font-medium w-28">項目</th>
                    <th className="text-left p-3 text-slate-500 font-medium">管理DB（Go API）</th>
                    <th className="text-left p-3 text-slate-500 font-medium">Google Business Profile</th>
                    <th className="text-center p-3 text-slate-500 font-medium w-24">状態</th>
                  </tr>
                </thead>
                <tbody>
                  {napItems.map((item) => {
                    const status = checkMatch(item.db, item.gbp);
                    const s = statusStyles[status];
                    return (
                      <tr key={item.label} className="border-t border-slate-50">
                        <td className="p-3 font-medium text-slate-600">{item.label}</td>
                        <td className="p-3 text-slate-700">{item.db || <span className="text-slate-300">未設定</span>}</td>
                        <td className="p-3 text-slate-700">{item.gbp || <span className="text-slate-300">未設定</span>}</td>
                        <td className="p-3 text-center">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${s.bg} ${s.color}`}>
                            {s.icon} {s.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* GBP詳細情報 */}
          {gbpData && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-100">
              <div className="p-4 border-b border-slate-100">
                <h3 className="text-sm font-semibold text-slate-500">GBP詳細情報</h3>
              </div>
              <div className="p-4 space-y-3">
                {gbpData.websiteUri && (
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-400 w-24 flex-shrink-0">ウェブサイト</span>
                    <a href={gbpData.websiteUri} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline truncate">{gbpData.websiteUri}</a>
                  </div>
                )}
                {gbpData.categories?.primaryCategory && (
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-400 w-24 flex-shrink-0">メインカテゴリ</span>
                    <span className="text-sm text-slate-700">{gbpData.categories.primaryCategory.displayName}</span>
                  </div>
                )}
                {gbpData.categories?.additionalCategories && gbpData.categories.additionalCategories.length > 0 && (
                  <div className="flex items-start gap-3">
                    <span className="text-xs text-slate-400 w-24 flex-shrink-0">追加カテゴリ</span>
                    <div className="flex flex-wrap gap-1">
                      {gbpData.categories.additionalCategories.map((c, i) => (
                        <span key={i} className="px-2 py-0.5 rounded-full text-xs bg-slate-50 text-slate-600">{c.displayName}</span>
                      ))}
                    </div>
                  </div>
                )}
                {gbpData.regularHours?.periods && gbpData.regularHours.periods.length > 0 && (
                  <div className="flex items-start gap-3">
                    <span className="text-xs text-slate-400 w-24 flex-shrink-0">営業時間</span>
                    <div className="text-sm text-slate-700 space-y-0.5">
                      {gbpData.regularHours.periods.map((p, i) => (
                        <div key={i}>
                          <span className="font-medium">{DAY_MAP[p.openDay] || p.openDay}</span>
                          <span className="text-slate-500 ml-2">
                            {p.openTime?.substring(0, 5) || "00:00"} - {p.closeTime?.substring(0, 5) || "24:00"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
