"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import FeatureCard from "@/components/feature-card";
import { fuzzyMatch } from "@/lib/normalize";
import api from "@/lib/api";
import type { Shop } from "@/lib/api-types";

interface ShopRow {
  id: string;
  name: string;
  owner: string;
  agent: string;
  area: string;
  phone: string;
  gbpConnected: boolean;
  gbpShopName: string;
  rating: number;
  status: "active" | "paused" | "churned";
}

export default function ShopManagementPage() {
  const [shops, setShops] = useState<ShopRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<keyof ShopRow>("name");
  const [sortAsc, setSortAsc] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await api.get("/api/shop");
      const data: Shop[] = Array.isArray(res.data) ? res.data : [];
      setShops(data.map((s) => ({
        id: s.id,
        name: s.name,
        owner: s.owner?.name || "",
        agent: s.owner?.agent?.name || "（直接契約）",
        area: (s.owner?.state || s.state || "") + (s.owner?.city || s.city || ""),
        phone: s.owner?.phone || s.phone || "",
        gbpConnected: !!s.gbp_location_name,
        gbpShopName: s.gbp_shop_name || "",
        rating: 0,
        status: "active" as const,
      })));
    } catch { setError("API接続エラー"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    let r = shops.filter((row) => !searchQuery || fuzzyMatch(searchQuery, row.id, row.name, row.owner, row.agent, row.area, row.phone, row.gbpShopName));
    r.sort((a, b) => sortAsc ? String(a[sortKey]).localeCompare(String(b[sortKey]), "ja") : String(b[sortKey]).localeCompare(String(a[sortKey]), "ja"));
    return r;
  }, [shops, searchQuery, sortKey, sortAsc]);

  const hs = (k: keyof ShopRow) => { if (sortKey === k) setSortAsc(!sortAsc); else { setSortKey(k); setSortAsc(true); } };
  const si = (k: keyof ShopRow) => sortKey !== k ? "↕" : sortAsc ? "↑" : "↓";

  const counts = { total: shops.length, active: shops.filter(s => s.status === "active").length, gbp: shops.filter(s => s.gbpConnected).length };

  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">店舗管理</h1>
        <p className="text-slate-500 text-sm mt-1">全店舗の登録・編集・GBP紐付け・グループ管理</p>
      </div>

      <div className="grid grid-cols-5 gap-4 mb-6">
        {[
          { label: "全店舗", value: counts.total, color: "#003D6B" },
          { label: "稼働中", value: counts.active, color: "#16a34a" },
          { label: "GBP接続済", value: counts.gbp, color: "#3b82f6" },
          { label: "検索結果", value: filtered.length, color: "#8b5cf6" },
          { label: "データソース", value: "API", color: "#16a34a", isText: true },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
            <p className="text-xs text-slate-500">{s.label}</p>
            {"isText" in s ? <p className="text-sm font-bold mt-2" style={{ color: s.color }}>● APIリアルタイム</p> : <p className="text-2xl font-bold mt-1" style={{ color: s.color }}>{s.value}</p>}
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm mb-4">
        <div className="flex items-center gap-3">
          <div className="flex-1 relative">
            <input className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#003D6B]/30" placeholder="店舗名・ID・オーナー・エリア・電話番号で検索（全角/半角OK）" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            {searchQuery && <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-lg">×</button>}
          </div>
        </div>
        {searchQuery && <p className="text-xs text-slate-500 mt-2">「{searchQuery}」— {filtered.length}件</p>}
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="bg-white rounded-xl p-12 border border-slate-200 text-center"><p className="text-slate-500">APIからデータを読み込み中...</p></div>
      ) : (
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-slate-200">
                <th className="text-left py-3 px-2 cursor-pointer" onClick={() => hs("id")}>ID {si("id")}</th>
                <th className="text-left py-3 px-2 cursor-pointer" onClick={() => hs("name")}>店舗名 {si("name")}</th>
                <th className="text-left py-3 px-2 cursor-pointer" onClick={() => hs("owner")}>オーナー {si("owner")}</th>
                <th className="text-center py-3 px-2 cursor-pointer" onClick={() => hs("area")}>エリア {si("area")}</th>
                <th className="text-left py-3 px-2">電話番号</th>
                <th className="text-center py-3 px-2">GBP</th>
                <th className="text-center py-3 px-2">ステータス</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center text-slate-400">
                  {shops.length === 0 ? "店舗が登録されていません" : "該当する店舗が見つかりません"}
                </td></tr>
              ) : filtered.map((shop) => (
                <tr key={shop.id} className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition">
                  <td className="py-3 px-2 text-[#003D6B] font-mono text-xs">{shop.id.substring(0, 12)}...</td>
                  <td className="py-3 px-2 font-medium text-[#003D6B]">{shop.name}</td>
                  <td className="py-3 px-2 text-slate-600 text-xs">
                    <div>{shop.owner}</div>
                    {shop.agent !== "（直接契約）" && <div className="text-[10px] text-slate-400">via {shop.agent}</div>}
                  </td>
                  <td className="py-3 px-2 text-center text-slate-600 text-xs">{shop.area}</td>
                  <td className="py-3 px-2 text-slate-500 text-xs">{shop.phone}</td>
                  <td className="py-3 px-2 text-center text-xs">
                    {shop.gbpConnected ? <span className="text-green-600">● 接続済</span> : <span className="text-slate-400">○ 未接続</span>}
                  </td>
                  <td className="py-3 px-2 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      shop.status === "active" ? "bg-green-50 text-green-700" :
                      shop.status === "paused" ? "bg-yellow-50 text-yellow-700" :
                      "bg-red-50 text-red-700"
                    }`}>
                      {shop.status === "active" ? "稼働中" : shop.status === "paused" ? "一時停止" : "解約済"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="text-lg font-bold mb-4">機能一覧</h2>
      <div className="grid grid-cols-2 gap-4">
        <FeatureCard title="店舗の登録・編集・削除" description="GBPロケーションとの紐付け、優先度設定も管理。" icon="🏠" />
        <FeatureCard title="店舗グループ管理" description="系列店・エリア別など任意のグループで分類。" icon="📂" />
        <FeatureCard title="GBPアカウント・ロケーション関連付け" description="GoogleアカウントとGBPロケーションを紐付け。" icon="🔗" />
        <FeatureCard title="店舗ダッシュボード" description="店舗ごとのKPI一覧画面。" icon="📊" />
        <FeatureCard title="全店舗一覧・検索・フィルタ" description="500+店舗を各条件で絞り込み検索。" icon="🔍" />
        <FeatureCard title="店舗切り替え" description="代理店→オーナー→店舗をドリルダウンで切り替え。" icon="🔄" />
      </div>
    </div>
  );
}
