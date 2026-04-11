"use client";

import { useState, useEffect, useCallback } from "react";
import { useShop } from "@/components/shop-provider";
import api from "@/lib/api";

interface NAPResult {
  shopName: string;
  url: string;
  status: string; // "店名不一致" / "住所不一致" / "電話番号不一致" / 複合
  account: string;
  detail: string;
}

const DEST_SPREADSHEET_ID = "1IFBF9ZKEXTo0N-VgrApiaFT5o0CaecIxaCTQCtJPwgE";

export default function CitationPage() {
  const { selectedShopId, selectedShop, apiConnected, shops, shopFilterMode } = useShop();
  const [results, setResults] = useState<NAPResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filterType, setFilterType] = useState<"all" | "name" | "address" | "phone">("all");
  const [searchText, setSearchText] = useState("");
  const [gbpData, setGbpData] = useState<any>(null);

  // NAP結果をスプレッドシートから取得
  const fetchResults = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const gvizUrl = `https://docs.google.com/spreadsheets/d/${DEST_SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent("system-9")}`;
      const res = await fetch(gvizUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        redirect: "follow",
      });

      if (!res.ok) {
        setError("スプレッドシートの読み込みに失敗しました");
        setResults([]);
        return;
      }

      const text = await res.text();
      const rows = parseCSV(text);

      // 行をパース（店舗名, URL, ステータス, アカウント, 詳細）
      const parsed: NAPResult[] = rows
        .filter((r) => r.length >= 3 && r[0] && r[0] !== "店舗名")
        .map((r) => ({
          shopName: r[0] || "",
          url: r[1] || "",
          status: r[2] || "",
          account: r[3] || "",
          detail: r[4] || "",
        }));

      setResults(parsed);
    } catch (e: any) {
      setError(e?.message || "取得に失敗しました");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchResults(); }, [fetchResults]);

  // GBP情報も取得（選択店舗がある場合）
  useEffect(() => {
    if (!selectedShopId) return;
    api.get(`/api/shop/${selectedShopId}/location`)
      .then((res) => setGbpData(res.data || null))
      .catch(() => setGbpData(null));
  }, [selectedShopId]);

  // フィルタリング
  const filtered = results.filter((r) => {
    if (filterType === "name" && !r.status.includes("店名")) return false;
    if (filterType === "address" && !r.status.includes("住所")) return false;
    if (filterType === "phone" && !r.status.includes("電話")) return false;
    if (searchText) {
      const q = searchText.toLowerCase();
      return r.shopName.toLowerCase().includes(q) || r.account.toLowerCase().includes(q);
    }
    return true;
  });

  // 統計
  const totalNG = results.length;
  const nameNG = results.filter((r) => r.status.includes("店名")).length;
  const addrNG = results.filter((r) => r.status.includes("住所")).length;
  const phoneNG = results.filter((r) => r.status.includes("電話")).length;

  // 選択店舗のNAP比較（DB vs GBP）
  const shop = selectedShop as any;
  const dbName = shop?.name || "";
  const dbAddress = [shop?.state, shop?.city, shop?.address, shop?.building].filter(Boolean).join("");
  const dbPhone = shop?.phone || "";
  const gbpName = gbpData?.title || "";
  const gbpAddr = gbpData?.storefrontAddress;
  const gbpAddress = gbpAddr ? [gbpAddr.administrativeArea, gbpAddr.locality, ...(gbpAddr.addressLines || [])].filter(Boolean).join("") : "";
  const gbpPhone = gbpData?.phoneNumbers?.primaryPhone || "";

  const normalize = (s: string) => s.replace(/[\s\-−ー　丁目番地号階F\(\)（）]/g, "").toLowerCase();
  const napCheck = (db: string, gbp: string) => {
    if (!db && !gbp) return "empty";
    if (!db || !gbp) return "missing";
    return normalize(db) === normalize(gbp) ? "match" : "mismatch";
  };

  const napItems = [
    { label: "店舗名", db: dbName, gbp: gbpName },
    { label: "住所", db: dbAddress, gbp: gbpAddress },
    { label: "電話番号", db: dbPhone, gbp: gbpPhone },
  ];

  const statusStyles: Record<string, { icon: string; color: string; bg: string; label: string }> = {
    match: { icon: "✓", color: "text-emerald-600", bg: "bg-emerald-50", label: "一致" },
    mismatch: { icon: "✕", color: "text-red-600", bg: "bg-red-50", label: "不一致" },
    missing: { icon: "△", color: "text-amber-600", bg: "bg-amber-50", label: "データ不足" },
    empty: { icon: "—", color: "text-slate-400", bg: "bg-slate-50", label: "未設定" },
  };

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">NAP整合性チェック</h1>
          <p className="text-sm text-slate-500 mt-1">店舗名・住所・電話番号の整合性（Google検索結果との照合）</p>
        </div>
        <button onClick={fetchResults} disabled={loading}
          className={`px-4 py-2 rounded-lg text-sm font-semibold ${loading ? "bg-slate-200 text-slate-400" : "bg-[#003D6B] hover:bg-[#002a4a]"}`}
          style={{ color: loading ? undefined : "#fff" }}>
          {loading ? "読み込み中..." : "最新結果を取得"}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-700">{error}</div>
      )}

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
          <p className="text-[11px] font-medium text-slate-400 mb-1">不一致店舗数</p>
          <p className="text-2xl font-bold text-red-600">{totalNG}<span className="text-xs font-normal text-slate-400 ml-1">件</span></p>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
          <p className="text-[11px] font-medium text-slate-400 mb-1">店名不一致</p>
          <p className="text-2xl font-bold text-orange-600">{nameNG}<span className="text-xs font-normal text-slate-400 ml-1">件</span></p>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
          <p className="text-[11px] font-medium text-slate-400 mb-1">住所不一致</p>
          <p className="text-2xl font-bold text-amber-600">{addrNG}<span className="text-xs font-normal text-slate-400 ml-1">件</span></p>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
          <p className="text-[11px] font-medium text-slate-400 mb-1">電話番号不一致</p>
          <p className="text-2xl font-bold text-purple-600">{phoneNG}<span className="text-xs font-normal text-slate-400 ml-1">件</span></p>
        </div>
      </div>

      {/* 選択店舗のDB vs GBP比較 */}
      {selectedShop && gbpData && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 mb-5">
          <div className="p-4 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-500">{selectedShop.name} — DB vs GBP 比較</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50">
                  <th className="text-left p-3 text-slate-500 font-medium w-28">項目</th>
                  <th className="text-left p-3 text-slate-500 font-medium">管理DB</th>
                  <th className="text-left p-3 text-slate-500 font-medium">GBP</th>
                  <th className="text-center p-3 text-slate-500 font-medium w-20">状態</th>
                </tr>
              </thead>
              <tbody>
                {napItems.map((item) => {
                  const status = napCheck(item.db, item.gbp);
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
      )}

      {/* フィルタバー */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-3 mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <input type="text" placeholder="店舗名・アカウントで検索..." value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="flex-1 min-w-[200px] pl-3 pr-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#003D6B]/20" />
          <div className="flex border border-slate-200 rounded-lg overflow-hidden">
            {([["all", "すべて"], ["name", "店名"], ["address", "住所"], ["phone", "電話"]] as [string, string][]).map(([key, label]) => (
              <button key={key} onClick={() => setFilterType(key as any)}
                className={`px-3 py-1.5 text-xs font-semibold transition ${filterType === key ? "bg-[#003D6B] text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}>
                {label}
              </button>
            ))}
          </div>
          <span className="text-xs text-slate-400">{filtered.length}件</span>
        </div>
      </div>

      {/* NG一覧テーブル */}
      {loading ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">読み込み中...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">{results.length === 0 ? "NAP チェック結果がありません。Pythonスクリプトで計測を実行してください。" : "条件に一致する結果はありません"}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="text-left p-3 text-slate-500 font-medium">店舗名</th>
                <th className="text-center p-3 text-slate-500 font-medium">ステータス</th>
                <th className="text-left p-3 text-slate-500 font-medium hidden lg:table-cell">アカウント</th>
                <th className="text-left p-3 text-slate-500 font-medium hidden md:table-cell">詳細</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="p-3">
                    <p className="font-medium text-slate-800">{r.shopName}</p>
                    {r.url && (
                      <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-500 hover:underline truncate block max-w-[200px]">
                        {r.url.includes("google.com/search") ? "Google検索結果" : "GBPリンク"}
                      </a>
                    )}
                  </td>
                  <td className="p-3 text-center">
                    <div className="flex flex-wrap gap-1 justify-center">
                      {r.status.split(" / ").map((s, j) => (
                        <span key={j} className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          s.includes("店名") ? "bg-orange-50 text-orange-600" :
                          s.includes("住所") ? "bg-amber-50 text-amber-600" :
                          s.includes("電話") ? "bg-purple-50 text-purple-600" :
                          "bg-red-50 text-red-600"
                        }`}>
                          {s}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="p-3 text-slate-500 hidden lg:table-cell">{r.account}</td>
                  <td className="p-3 text-slate-500 hidden md:table-cell">
                    <p className="text-[10px] leading-relaxed line-clamp-2">{r.detail}</p>
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

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let i = 0;
  const len = text.length;
  while (i < len) {
    const row: string[] = [];
    while (i < len) {
      if (text[i] === '"') {
        i++;
        let field = "";
        while (i < len) {
          if (text[i] === '"') {
            if (i + 1 < len && text[i + 1] === '"') { field += '"'; i += 2; }
            else { i++; break; }
          } else { field += text[i]; i++; }
        }
        row.push(field);
        if (i < len && text[i] === ",") i++;
      } else {
        let field = "";
        while (i < len && text[i] !== "," && text[i] !== "\n" && text[i] !== "\r") { field += text[i]; i++; }
        row.push(field);
        if (i < len && text[i] === ",") i++;
        else break;
      }
    }
    while (i < len && (text[i] === "\n" || text[i] === "\r")) i++;
    if (row.length > 0 && row.some((c) => c)) rows.push(row);
  }
  return rows;
}
