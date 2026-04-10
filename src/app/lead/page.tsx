"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useShop } from "@/components/shop-provider";
import api from "@/lib/api";

interface ShopLead {
  id: string;
  name: string;
  state?: string;
  city?: string;
  address?: string;
  phone?: string;
  gbp_shop_name?: string | null;
  gbp_location_name?: string | null;
  website_click_rate?: number | null;
  call_click_rate?: number | null;
  direction_route_rate?: number | null;
  created_at: string;
  owner?: { name: string; phone?: string } | null;
}

function calcLeadScore(shop: ShopLead): { score: number; details: string[] } {
  let score = 0;
  const details: string[] = [];

  if (shop.gbp_location_name) { score += 30; details.push("GBP接続済み (+30)"); }
  else { details.push("GBP未接続 (0)"); }

  if (shop.state && shop.city && shop.address) { score += 15; details.push("住所完備 (+15)"); }
  else { details.push("住所不完全 (0)"); }

  if (shop.phone) { score += 10; details.push("電話番号あり (+10)"); }
  else { details.push("電話番号なし (0)"); }

  if (shop.owner?.name) { score += 15; details.push("オーナー登録済み (+15)"); }
  else { details.push("オーナー未登録 (0)"); }

  if (shop.website_click_rate && shop.website_click_rate > 0) { score += 10; details.push("Web CVR設定済み (+10)"); }
  else { details.push("Web CVR未設定 (0)"); }

  if (shop.call_click_rate && shop.call_click_rate > 0) { score += 10; details.push("電話CVR設定済み (+10)"); }
  else { details.push("電話CVR未設定 (0)"); }

  if (shop.direction_route_rate && shop.direction_route_rate > 0) { score += 10; details.push("経路CVR設定済み (+10)"); }
  else { details.push("経路CVR未設定 (0)"); }

  return { score, details };
}

export default function LeadPage() {
  const { apiConnected } = useShop();
  const [shops, setShops] = useState<ShopLead[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<"score" | "name" | "created_at">("score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchShops = useCallback(async () => {
    if (!apiConnected) return;
    setLoading(true);
    try {
      const res = await api.get("/api/shop");
      setShops(Array.isArray(res.data) ? res.data : (res.data?.shops || []));
    } catch {
      setShops([]);
    } finally {
      setLoading(false);
    }
  }, [apiConnected]);

  useEffect(() => { fetchShops(); }, [fetchShops]);

  const scoredShops = useMemo(() => {
    return shops.map((s) => ({ ...s, ...calcLeadScore(s) }));
  }, [shops]);

  const filtered = useMemo(() => {
    let result = scoredShops;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((s) =>
        s.name.toLowerCase().includes(q) ||
        (s.state || "").toLowerCase().includes(q) ||
        (s.city || "").toLowerCase().includes(q) ||
        (s.owner?.name || "").toLowerCase().includes(q)
      );
    }
    result = [...result].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "score") cmp = a.score - b.score;
      else if (sortKey === "name") cmp = a.name.localeCompare(b.name, "ja");
      else cmp = a.created_at.localeCompare(b.created_at);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return result;
  }, [scoredShops, search, sortKey, sortDir]);

  const handleExportCSV = () => {
    const headers = ["店舗名", "オーナー", "都道府県", "市区町村", "住所", "電話番号", "GBP接続", "スコア"];
    const rows = filtered.map((s) => [
      s.name, s.owner?.name || "", s.state || "", s.city || "",
      s.address || "", s.phone || "", s.gbp_location_name ? "接続済み" : "未接続", String(s.score),
    ]);
    const bom = "\uFEFF";
    const csv = bom + [headers, ...rows].map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `店舗リード_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const scoreColor = (score: number) => {
    if (score >= 80) return "text-emerald-600 bg-emerald-50";
    if (score >= 50) return "text-blue-600 bg-blue-50";
    if (score >= 30) return "text-amber-600 bg-amber-50";
    return "text-red-600 bg-red-50";
  };

  const scoreDist = useMemo(() => {
    const d = { "80+": 0, "50-79": 0, "30-49": 0, "<30": 0 };
    scoredShops.forEach((s) => {
      if (s.score >= 80) d["80+"]++;
      else if (s.score >= 50) d["50-79"]++;
      else if (s.score >= 30) d["30-49"]++;
      else d["<30"]++;
    });
    return d;
  }, [scoredShops]);

  const gbpConnected = scoredShops.filter((s) => s.gbp_location_name).length;
  const avgScore = scoredShops.length > 0 ? Math.round(scoredShops.reduce((s, sh) => s + sh.score, 0) / scoredShops.length) : 0;

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">リード管理</h1>
          <p className="text-sm text-slate-500 mt-1">店舗調査・リードスコアリング・CSVエクスポート</p>
        </div>
        {shops.length > 0 && (
          <button onClick={handleExportCSV}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-700"
            style={{ color: "#fff" }}>
            CSVエクスポート（{filtered.length}件）
          </button>
        )}
      </div>

      {!apiConnected ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">Go APIに接続し、店舗を登録すると利用できます</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
              <p className="text-[11px] font-medium text-slate-400 mb-1">総店舗数</p>
              <p className="text-2xl font-bold text-[#003D6B]">{shops.length}</p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
              <p className="text-[11px] font-medium text-slate-400 mb-1">GBP接続率</p>
              <p className="text-2xl font-bold text-emerald-600">
                {shops.length > 0 ? Math.round((gbpConnected / shops.length) * 100) : 0}%
                <span className="text-xs font-normal text-slate-400 ml-1">({gbpConnected}/{shops.length})</span>
              </p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
              <p className="text-[11px] font-medium text-slate-400 mb-1">平均スコア</p>
              <p className={`text-2xl font-bold ${scoreColor(avgScore).split(" ")[0]}`}>{avgScore}<span className="text-xs font-normal text-slate-400 ml-1">/ 100</span></p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
              <p className="text-[11px] font-medium text-slate-400 mb-1">スコア分布</p>
              <div className="flex items-end gap-1 h-6 mt-1">
                {Object.entries(scoreDist).map(([label, count]) => {
                  const max = Math.max(...Object.values(scoreDist), 1);
                  const colors: Record<string, string> = { "80+": "bg-emerald-400", "50-79": "bg-blue-400", "30-49": "bg-amber-400", "<30": "bg-red-400" };
                  return (
                    <div key={label} className="flex-1 flex flex-col items-center gap-0.5" title={`${label}: ${count}件`}>
                      <div className={`w-full rounded-sm ${colors[label]}`} style={{ height: `${Math.max((count / max) * 100, 8)}%` }} />
                      <span className="text-[7px] text-slate-400">{label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-3 mb-4">
            <div className="flex flex-wrap gap-2 items-center">
              <input type="text" placeholder="店舗名・地域・オーナーで検索..."
                value={search} onChange={(e) => setSearch(e.target.value)}
                className="flex-1 min-w-[200px] pl-3 pr-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#003D6B]/20" />
              <div className="flex gap-1">
                {(["score", "name", "created_at"] as const).map((key) => {
                  const labels = { score: "スコア", name: "名前", created_at: "登録日" };
                  return (
                    <button key={key}
                      onClick={() => { if (sortKey === key) setSortDir((d) => d === "asc" ? "desc" : "asc"); else { setSortKey(key); setSortDir(key === "name" ? "asc" : "desc"); } }}
                      className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold ${sortKey === key ? "bg-blue-50 text-[#003D6B] border border-blue-200" : "bg-slate-50 text-slate-500 hover:bg-slate-100"}`}>
                      {labels[key]}{sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                    </button>
                  );
                })}
              </div>
              <span className="text-xs text-slate-400 ml-auto">{filtered.length}件</span>
            </div>
          </div>

          {loading ? (
            <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
              <p className="text-slate-400 text-sm">読み込み中...</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    <th className="text-left p-3 text-slate-500 font-medium">店舗名</th>
                    <th className="text-left p-3 text-slate-500 font-medium hidden md:table-cell">オーナー</th>
                    <th className="text-left p-3 text-slate-500 font-medium hidden lg:table-cell">地域</th>
                    <th className="text-center p-3 text-slate-500 font-medium">GBP</th>
                    <th className="text-center p-3 text-slate-500 font-medium">スコア</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((shop) => (
                    <tr key={shop.id}
                      className="border-b border-slate-50 hover:bg-slate-50 cursor-pointer"
                      onClick={() => setExpandedId(expandedId === shop.id ? null : shop.id)}>
                      <td className="p-3">
                        <p className="font-medium text-slate-800">{shop.name}</p>
                        {shop.phone && <p className="text-[10px] text-slate-400 mt-0.5">{shop.phone}</p>}
                      </td>
                      <td className="p-3 text-slate-600 hidden md:table-cell">{shop.owner?.name || <span className="text-slate-300">未設定</span>}</td>
                      <td className="p-3 text-slate-500 hidden lg:table-cell">{shop.state}{shop.city}</td>
                      <td className="p-3 text-center">
                        {shop.gbp_location_name
                          ? <span className="text-emerald-500 font-bold text-[10px]">接続済み</span>
                          : <span className="text-slate-300 text-[10px]">未接続</span>}
                      </td>
                      <td className="p-3 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${scoreColor(shop.score)}`}>{shop.score}</span>
                      </td>
                      <td className="p-3 text-center text-slate-300">{expandedId === shop.id ? "▲" : "▼"}</td>
                    </tr>
                  ))}
                  {/* 展開行は別途レンダリング */}
                </tbody>
              </table>

              {/* 展開詳細 */}
              {expandedId && (() => {
                const shop = filtered.find((s) => s.id === expandedId);
                if (!shop) return null;
                return (
                  <div className="p-4 bg-slate-50 border-t border-slate-100">
                    <p className="text-xs font-semibold text-slate-500 mb-2">{shop.name} — スコア詳細</p>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                      {shop.details.map((d, i) => (
                        <div key={i} className={`px-3 py-2 rounded-lg text-xs ${d.includes("+") ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
                          {d}
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-slate-400 mt-2">
                      GBP: {shop.gbp_shop_name || "未設定"} | 登録日: {new Date(shop.created_at).toLocaleDateString("ja-JP")}
                    </p>
                  </div>
                );
              })()}
            </div>
          )}
        </>
      )}
    </div>
  );
}
