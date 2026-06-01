"use client";

import { useEffect, useCallback, useState, useRef } from "react";
import api from "@/lib/api";
import { useShop } from "@/components/shop-provider";

interface GridPoint {
  row: number;
  col: number;
  lat: number;
  lng: number;
  rank: number; // 0 = 未計測, -1 = 圏外
}

interface GridLog {
  id: string;
  keyword: string;
  grid_size: number;
  interval_m: number;
  results: GridPoint[];
  measured_at: string;
}

const GRID_SIZES = [3, 5, 7, 9] as const;
const INTERVALS = [
  { label: "500m", value: 500 },
  { label: "1km", value: 1000 },
  { label: "2km", value: 2000 },
  { label: "5km", value: 5000 },
];

function rankColor(rank: number): string {
  if (rank <= 0) return "#6B7280"; // 圏外 = グレー
  if (rank <= 3) return "#16A34A";  // 1-3位 = 緑
  if (rank <= 10) return "#2563EB"; // 4-10位 = 青
  if (rank <= 20) return "#F59E0B"; // 11-20位 = 黄
  return "#EF4444";                 // 21位以降 = 赤
}

function rankBg(rank: number): string {
  if (rank <= 0) return "bg-gray-100 text-gray-500";
  if (rank <= 3) return "bg-green-100 text-green-700";
  if (rank <= 10) return "bg-blue-100 text-blue-700";
  if (rank <= 20) return "bg-yellow-100 text-yellow-700";
  return "bg-red-100 text-red-700";
}

function avgRank(results: GridPoint[]): string {
  if (results.length === 0) return "-";
  const total = results.reduce((a, b) => a + (b.rank > 0 ? b.rank : 101), 0);
  return (total / results.length).toFixed(1);
}

/** 中心座標からグリッド地点を生成 */
function generateGrid(
  centerLat: number,
  centerLng: number,
  gridSize: number,
  intervalM: number
): GridPoint[] {
  const points: GridPoint[] = [];
  const half = Math.floor(gridSize / 2);
  // 緯度1度 ≈ 111,320m
  const latDeg = intervalM / 111320;
  // 経度1度 ≈ 111,320 * cos(lat) m
  const lngDeg = intervalM / (111320 * Math.cos((centerLat * Math.PI) / 180));

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const dRow = half - row; // row=0が北端（緯度が大きい）
      const dCol = col - half;
      points.push({
        row,
        col,
        lat: centerLat + dRow * latDeg,
        lng: centerLng + dCol * lngDeg,
        rank: 0,
      });
    }
  }
  return points;
}

interface Preset {
  id: string;
  shop_id: string;
  shop_name: string;
  keyword: string | null;
  grid_size: number;
}

interface CostEstimate {
  totalShops: number;
  totalRequests: number;
  monthlyCost: string;
  freeRequests: number;
  withinFree: boolean;
}

export default function GridRankingPage() {
  const { selectedShopId, selectedShop, shops } = useShop();
  const [keyword, setKeyword] = useState("");
  const [savedKeywords, setSavedKeywords] = useState<string[]>([]);
  const [gridSize, setGridSize] = useState<number>(7);
  const [interval, setInterval] = useState(1000);
  const [measuring, setMeasuring] = useState(false);
  const [progress, setProgress] = useState("");
  const [gridResults, setGridResults] = useState<GridPoint[]>([]);
  const [history, setHistory] = useState<GridLog[]>([]);

  // プリセット管理
  const [presets, setPresets] = useState<Preset[]>([]);
  const [estimate, setEstimate] = useState<CostEstimate | null>(null);
  const [showPresetPanel, setShowPresetPanel] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState("");
  const [coordSyncing, setCoordSyncing] = useState(false);
  const [coordSyncResult, setCoordSyncResult] = useState("");
  const [kwSyncing, setKwSyncing] = useState(false);
  const [kwSyncResult, setKwSyncResult] = useState("");

  // プリセット読み込み
  useEffect(() => {
    fetch("/api/report/grid-ranking-presets").then(r => r.json()).then(data => {
      setPresets(data.presets || []);
      setEstimate(data.estimate || null);
    }).catch(() => {});
  }, []);

  // プリセットに追加
  const addToPreset = async (shopId: string, shopName: string, kw?: string, size?: number) => {
    await fetch("/api/report/grid-ranking-presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shops: [{ shopId, shopName, keyword: kw, gridSize: size || 7 }] }),
    });
    const res = await fetch("/api/report/grid-ranking-presets");
    const data = await res.json();
    setPresets(data.presets || []);
    setEstimate(data.estimate || null);
  };

  // プリセットから削除
  const removeFromPreset = async (shopId: string) => {
    await fetch("/api/report/grid-ranking-presets", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shopIds: [shopId] }),
    });
    const res = await fetch("/api/report/grid-ranking-presets");
    const data = await res.json();
    setPresets(data.presets || []);
    setEstimate(data.estimate || null);
  };
  const [selectedHistory, setSelectedHistory] = useState<GridLog | null>(null);
  const [error, setError] = useState("");
  const [aborted, setAborted] = useState(false);
  const [sheetLoading, setSheetLoading] = useState(false);
  const abortRef = useRef(false);
  const mapRef = useRef<HTMLDivElement>(null);
  const googleMapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);

  const [shopLat, setShopLat] = useState(0);
  const [shopLng, setShopLng] = useState(0);

  // 店舗座標を取得（Go API → Supabase fallback）
  useEffect(() => {
    if (!selectedShopId) return;
    // 店舗切替時に座標をリセット
    setShopLat(0);
    setShopLng(0);

    const goLat = (selectedShop as any)?.gbp_latitude;
    const goLng = (selectedShop as any)?.gbp_longitude;
    if (goLat && goLat !== 0) {
      setShopLat(goLat);
      setShopLng(goLng);
      return;
    }
    // Go APIに座標がない場合、Supabaseから取得
    import("@/lib/supabase").then(({ supabase }) => {
      supabase
        .from("shops")
        .select("gbp_latitude, gbp_longitude")
        .eq("id", selectedShopId)
        .single()
        .then(({ data }) => {
          if (data?.gbp_latitude) {
            setShopLat(data.gbp_latitude);
            setShopLng(data.gbp_longitude);
          }
        }, () => {});
    }, () => {});
  }, [selectedShopId, selectedShop]);

  // 保存済みキーワードをDBから読み込み
  useEffect(() => {
    if (!selectedShopId) return;
    api.get(`/api/report/shop-keywords?shopId=${selectedShopId}`)
      .then((res) => {
        if (res.data?.keywords?.length > 0) {
          setSavedKeywords(res.data.keywords);
          if (!keyword) setKeyword(res.data.keywords[0]);
        } else {
          setSavedKeywords([]);
        }
      })
      .catch(() => setSavedKeywords([]));
  }, [selectedShopId]);

  // シートからキーワード取得してDBに保存
  const fetchFromSheet = async () => {
    if (!selectedShop) return;
    setSheetLoading(true);
    setError("");
    try {
      const res = await api.get(`/api/report/ranking-keywords?shopName=${encodeURIComponent((selectedShop as any).name)}`);
      if (res.data.found && res.data.keywords.length > 0) {
        setSavedKeywords(res.data.keywords);
        setKeyword(res.data.keywords[0]);
        // DBに保存
        await api.put("/api/report/shop-keywords", {
          shopId: selectedShopId,
          keywords: res.data.keywords,
          source: "sheet",
        });
      } else {
        setError("シートにキーワードが見つかりません");
      }
    } catch (e: any) {
      setError(e?.response?.data?.error || "シート取得に失敗しました");
    } finally {
      setSheetLoading(false);
    }
  };

  // 履歴取得（最新結果を自動表示）
  const fetchHistory = useCallback(async () => {
    if (!selectedShopId) return;
    try {
      const res = await api.get(`/api/report/grid-ranking?shopId=${selectedShopId}`);
      const logs: GridLog[] = res.data || [];
      setHistory(logs);
      // 最新の計測結果を自動表示
      if (logs.length > 0) {
        const latest = logs[0];
        setSelectedHistory(latest);
        setKeyword(latest.keyword);
        setGridResults(latest.results || []);
      } else {
        setGridResults([]);
        setSelectedHistory(null);
      }
    } catch {}
  }, [selectedShopId]);

  useEffect(() => {
    fetchHistory();
  }, [selectedShopId, fetchHistory]);

  // Google Maps初期化
  useEffect(() => {
    if (!mapRef.current) return;
    if (typeof window === "undefined") return;

    const initMap = () => {
      if (!window.google?.maps) return;
      const lat = shopLat || 35.6812; // マップ初期表示用（計測時は店舗座標必須）
      const lng = shopLng || 139.7671;
      googleMapRef.current = new window.google.maps.Map(mapRef.current!, {
        center: { lat, lng },
        zoom: 13,
        mapTypeControl: true,
        streetViewControl: false,
        styles: [
          { featureType: "poi", stylers: [{ visibility: "off" }] },
          { featureType: "transit", stylers: [{ visibility: "off" }] },
        ],
      });
    };

    if (window.google?.maps) {
      initMap();
      return;
    }

    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";
    if (!apiKey) {
      setError("NEXT_PUBLIC_GOOGLE_MAPS_API_KEYが設定されていません");
      return;
    }

    const existing = document.getElementById("google-maps-script");
    if (existing) {
      existing.addEventListener("load", initMap);
      return;
    }

    const script = document.createElement("script");
    script.id = "google-maps-script";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=marker`;
    script.async = true;
    script.defer = true;
    script.onload = initMap;
    document.head.appendChild(script);
  }, [shopLat, shopLng]);

  // マーカーを描画
  const renderMarkers = useCallback(
    (points: GridPoint[]) => {
      if (!googleMapRef.current || !window.google?.maps) return;

      // 既存マーカーを削除
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];

      if (points.length === 0) return;

      const bounds = new window.google.maps.LatLngBounds();

      points.forEach((pt) => {
        const color = rankColor(pt.rank);
        const label = pt.rank > 0 ? String(pt.rank) : "-";

        const marker = new window.google.maps.Marker({
          position: { lat: pt.lat, lng: pt.lng },
          map: googleMapRef.current,
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            fillColor: color,
            fillOpacity: 0.9,
            strokeColor: "#fff",
            strokeWeight: 2,
            scale: 18,
          },
          label: {
            text: label,
            color: "#fff",
            fontWeight: "bold",
            fontSize: "11px",
          },
          title: `${pt.row + 1},${pt.col + 1}: ${pt.rank > 0 ? pt.rank + "位" : "圏外"}`,
        });

        markersRef.current.push(marker);
        bounds.extend({ lat: pt.lat, lng: pt.lng });
      });

      // 店舗中心マーカー
      const centerMarker = new window.google.maps.Marker({
        position: { lat: shopLat, lng: shopLng },
        map: googleMapRef.current,
        icon: {
          path: window.google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
          fillColor: "#000",
          fillOpacity: 1,
          strokeColor: "#fff",
          strokeWeight: 2,
          scale: 6,
        },
        title: "店舗位置",
        zIndex: 999,
      });
      markersRef.current.push(centerMarker);

      googleMapRef.current.fitBounds(bounds, 40);
    },
    [shopLat, shopLng]
  );

  // 履歴読み込み後 or 計測完了後にマップにマーカーを描画
  useEffect(() => {
    if (gridResults.length > 0 && googleMapRef.current) {
      renderMarkers(gridResults);
    }
  }, [gridResults, renderMarkers]);

  // グリッド計測実行
  const startMeasure = async () => {
    if (!selectedShopId || !keyword.trim() || !shopLat) return;
    setMeasuring(true);
    setError("");
    setAborted(false);
    abortRef.current = false;
    setSelectedHistory(null);

    const points = generateGrid(shopLat, shopLng, gridSize, interval);
    setGridResults(points);
    renderMarkers(points);

    const total = points.length;
    let completed = 0;

    for (let i = 0; i < points.length; i++) {
      if (abortRef.current) {
        setAborted(true);
        break;
      }

      const pt = points[i];
      setProgress(`計測中: ${completed + 1}/${total} 地点`);

      try {
        const res = await api.post("/api/report/grid-ranking", {
          shopId: selectedShopId,
          keyword: keyword.trim(),
          lat: pt.lat,
          lng: pt.lng,
        });
        pt.rank = res.data.rank || -1; // 0 = 見つからない → -1 (圏外)
      } catch {
        pt.rank = -1;
      }

      completed++;
      const updated = [...points];
      setGridResults(updated);
      renderMarkers(updated);
    }

    // 結果をDB保存
    if (!abortRef.current) {
      try {
        await api.put("/api/report/grid-ranking", {
          shopId: selectedShopId,
          keyword: keyword.trim(),
          gridResults: points.map((p) => ({
            lat: p.lat,
            lng: p.lng,
            rank: p.rank,
            row: p.row,
            col: p.col,
          })),
          gridSize,
          interval,
        });
        fetchHistory();
      } catch {}
    }

    setProgress(`完了: ${completed}/${total} 地点`);
    setMeasuring(false);
  };

  // 履歴選択時にマップに表示
  const showHistory = (log: GridLog) => {
    setSelectedHistory(log);
    setKeyword(log.keyword);
    setGridResults(log.results);
    renderMarkers(log.results);
  };

  // グリッドテーブルを生成
  const gridTable = () => {
    if (gridResults.length === 0) return null;
    const size = Math.round(Math.sqrt(gridResults.length));
    const rows: GridPoint[][] = [];
    for (let r = 0; r < size; r++) {
      rows.push(gridResults.filter((p) => p.row === r).sort((a, b) => a.col - b.col));
    }
    return rows;
  };

  // データダウンロード（CSV）
  const downloadCSV = () => {
    if (gridResults.length === 0) return;
    const shopName = (selectedShop as any)?.name || "shop";
    const header = "行,列,緯度,経度,順位\n";
    const body = gridResults
      .map((p) => `${p.row + 1},${p.col + 1},${p.lat.toFixed(6)},${p.lng.toFixed(6)},${p.rank > 0 ? p.rank : "圏外"}`)
      .join("\n");
    const bom = "\uFEFF";
    const blob = new Blob([bom + header + body], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${shopName}_グリッド順位_${keyword}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // マップキャプチャ（PNG）
  const downloadPNG = async () => {
    if (!mapRef.current) return;
    try {
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(mapRef.current, { useCORS: true, scale: 2 });
      const url = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = url;
      const shopName = (selectedShop as any)?.name || "shop";
      a.download = `${shopName}_グリッド順位マップ_${keyword}_${new Date().toISOString().slice(0, 10)}.png`;
      a.click();
    } catch {
      setError("PNG生成に失敗しました");
    }
  };

  const displayResults = gridResults;
  const rankedCount = displayResults.filter((r) => r.rank > 0).length;
  const rows = gridTable();

  return (
    <div className="p-6 pt-20 max-w-[1400px] mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#003D6B]">多地点順位チェック</h1>
          <p className="text-sm text-gray-500">
            店舗を中心にグリッド状の地点を自動生成し、各地点でのキーワード順位を一括計測します。
          </p>
        </div>
        <button onClick={() => setShowPresetPanel(!showPresetPanel)}
          className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#003D6B] text-white hover:bg-[#002a4a]">
          いつもの店舗（{presets.length}件）
        </button>
      </div>

      {/* いつも計測する店舗パネル */}
      {showPresetPanel && (
        <div className="bg-white rounded-xl shadow-sm border p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-[#003D6B]">いつも計測する店舗</h2>
            {estimate && (
              <div className="text-xs text-slate-500">
                月間: {estimate.totalRequests.toLocaleString()}リクエスト /
                {estimate.withinFree
                  ? <span className="text-emerald-600 font-bold ml-1">無料枠内</span>
                  : <span className="text-red-600 font-bold ml-1">${estimate.monthlyCost}</span>
                }
              </div>
            )}
          </div>

          {presets.length > 0 ? (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {presets.map(p => (
                <div key={p.id} className="flex items-center justify-between py-2 px-3 bg-slate-50 rounded-lg">
                  <div>
                    <span className="text-sm font-medium text-slate-800">{p.shop_name}</span>
                    <span className="text-xs text-slate-400 ml-2">{p.grid_size}×{p.grid_size}</span>
                    {p.keyword && <span className="text-xs text-indigo-500 ml-2">KW: {p.keyword}</span>}
                  </div>
                  <button onClick={() => removeFromPreset(p.shop_id)}
                    className="text-xs text-red-400 hover:text-red-600">削除</button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">店舗が登録されていません。下の計測画面で店舗を選択し「いつもの店舗に追加」で登録できます。</p>
          )}

          {presets.length > 0 && (
            <div className="flex gap-3">
              <button
                onClick={async () => {
                  if (coordSyncing) return;
                  setCoordSyncing(true);
                  setCoordSyncResult("座標取得中...");
                  try {
                    const res = await api.post("/api/report/sync-coordinates", {}, { timeout: 300000 });
                    const totalUpdated = res.data?.updated || 0;
                    const totalErrors = res.data?.errors || 0;
                    if (totalUpdated > 0) {
                      setCoordSyncResult(`${totalUpdated}店舗の座標を取得しました${totalErrors > 0 ? `（${totalErrors}件失敗）` : ""}`);
                    } else {
                      setCoordSyncResult("座標未設定の店舗はありません（全店舗設定済み）");
                    }
                  } catch (e: any) {
                    setCoordSyncResult("座標取得エラー: " + (e?.message || "不明"));
                  } finally {
                    setCoordSyncing(false);
                  }
                }}
                disabled={coordSyncing || batchRunning}
                className={`px-4 py-3 rounded-lg text-sm font-bold transition-all ${coordSyncing ? "bg-slate-200 text-slate-400" : "bg-blue-600 text-white hover:bg-blue-700"}`}
              >
                {coordSyncing ? "座標取得中..." : "座標一括取得"}
              </button>
              <button
                onClick={async () => {
                  if (kwSyncing) return;
                  setKwSyncing(true);
                  setKwSyncResult("KW取得中...");
                  let updated = 0;
                  let failed = 0;
                  for (let i = 0; i < presets.length; i++) {
                    const p = presets[i];
                    setKwSyncResult(`KW取得中... ${i + 1}/${presets.length} ${p.shop_name}`);
                    try {
                      const res = await api.get(`/api/report/ranking-keywords?shopName=${encodeURIComponent(p.shop_name)}`);
                      if (res.data?.found && res.data.keywords?.length > 0) {
                        const bestKw = res.data.ranks?.length > 0
                          ? [...res.data.ranks].sort((a: any, b: any) => (a.rank || 999) - (b.rank || 999))[0]?.word || res.data.keywords[0]
                          : res.data.keywords[0];
                        // プリセットのキーワードを更新
                        await fetch("/api/report/grid-ranking-presets", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ shops: [{ shopId: p.shop_id, shopName: p.shop_name, keyword: bestKw, gridSize: p.grid_size }] }),
                        });
                        // shop_keywordsにも保存
                        await api.put("/api/report/shop-keywords", {
                          shopId: p.shop_id,
                          keywords: res.data.keywords,
                          source: "sheet",
                        });
                        updated++;
                      } else {
                        failed++;
                      }
                    } catch {
                      failed++;
                    }
                  }
                  // プリセット再取得
                  const refreshRes = await fetch("/api/report/grid-ranking-presets");
                  const refreshData = await refreshRes.json();
                  setPresets(refreshData.presets || []);
                  setEstimate(refreshData.estimate || null);
                  setKwSyncResult(`${updated}店舗のKWを更新しました${failed > 0 ? `（${failed}件見つからず）` : ""}`);
                  setKwSyncing(false);
                }}
                disabled={kwSyncing || batchRunning}
                className={`px-4 py-3 rounded-lg text-sm font-bold transition-all ${kwSyncing ? "bg-slate-200 text-slate-400" : "bg-purple-600 text-white hover:bg-purple-700"}`}
              >
                {kwSyncing ? "KW取得中..." : "KW一括取得"}
              </button>
            </div>
          )}
          {(coordSyncResult || kwSyncResult) && (
            <div className="space-y-1">
              {coordSyncResult && <p className={`text-sm font-medium ${coordSyncResult.includes("エラー") ? "text-red-600" : "text-blue-600"}`}>{coordSyncResult}</p>}
              {kwSyncResult && <p className={`text-sm font-medium ${kwSyncResult.includes("見つからず") ? "text-orange-600" : "text-purple-600"}`}>{kwSyncResult}</p>}
            </div>
          )}

          {presets.length > 0 && (
            <button
              onClick={async () => {
                if (batchRunning) return;
                if (!confirm(`${presets.length}店舗の計測を開始します。約${Math.ceil(presets.length * 50 / 60)}分かかります。よろしいですか？`)) return;
                setBatchRunning(true);
                setBatchProgress(`0/${presets.length} 準備中...`);
                for (let i = 0; i < presets.length; i++) {
                  const p = presets[i];
                  setBatchProgress(`${i + 1}/${presets.length} ${p.shop_name}`);
                  try {
                    // 店舗座標を取得
                    // Supabaseから座標取得（Go API経由だと失敗するケースがあるため）
                    let lat = 0, lng = 0;
                    try {
                      const { createClient } = await import("@supabase/supabase-js");
                      const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || "", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "");
                      const { data: coordRow } = await sb.from("shops").select("gbp_latitude, gbp_longitude").eq("name", p.shop_name).not("gbp_latitude", "is", null).gt("gbp_latitude", 0).limit(1).maybeSingle();
                      if (coordRow) { lat = coordRow.gbp_latitude || 0; lng = coordRow.gbp_longitude || 0; }
                    } catch {}
                    // Supabaseで見つからなければGo APIにフォールバック
                    if (!lat || !lng) {
                      try {
                        const coordRes = await api.get(`/api/shop/${p.shop_id}`);
                        lat = coordRes.data?.gbp_latitude || coordRes.data?.GbpLatitude || 0;
                        lng = coordRes.data?.gbp_longitude || coordRes.data?.GbpLongitude || 0;
                      } catch {}
                    }
                    if (!lat || !lng) { setBatchProgress(`${i + 1}/${presets.length} ${p.shop_name} - 座標なしスキップ`); continue; }

                    // キーワード取得（プリセット設定 or シートから自動選定）
                    let kw = p.keyword;
                    if (!kw) {
                      const kwRes = await api.get(`/api/report/ranking-keywords?shopName=${encodeURIComponent(p.shop_name)}`);
                      const ranks = kwRes.data?.ranks || [];
                      if (ranks.length > 0) {
                        ranks.sort((a: any, b: any) => (a.rank || 999) - (b.rank || 999));
                        kw = ranks[0].word;
                      }
                    }
                    if (!kw) continue;

                    // グリッド生成+計測
                    const size = p.grid_size || 7;
                    const points = generateGrid(lat, lng, size, 1000);
                    for (let j = 0; j < points.length; j++) {
                      const pt = points[j];
                      setBatchProgress(`${i + 1}/${presets.length} ${p.shop_name} (${j + 1}/${points.length})`);
                      try {
                        const res = await api.post("/api/report/grid-ranking", {
                          shopId: p.shop_id, keyword: kw, lat: pt.lat, lng: pt.lng,
                        }, { timeout: 15000 });
                        points[j] = { ...pt, rank: res.data?.rank || 0 };
                      } catch { points[j] = { ...pt, rank: 0 }; }
                      await new Promise(r => setTimeout(r, 300));
                    }

                    // 結果保存
                    await api.put("/api/report/grid-ranking", {
                      shopId: p.shop_id, keyword: kw, gridResults: points, gridSize: size, interval: 1000,
                    });
                  } catch {}
                  await new Promise(r => setTimeout(r, 1000));
                }
                setBatchRunning(false);
                setBatchProgress(`✓ ${presets.length}店舗の計測が完了しました`);
              }}
              disabled={batchRunning}
              className={`w-full py-3 rounded-lg text-sm font-bold transition-all ${batchRunning ? "bg-slate-200 text-slate-400" : "bg-emerald-600 text-white hover:bg-emerald-700"}`}
            >
              {batchRunning ? batchProgress : `一括計測（${presets.length}店舗）`}
            </button>
          )}
          {batchProgress && !batchRunning && batchProgress.startsWith("✓") && (
            <p className="text-sm text-emerald-600 font-medium">{batchProgress}</p>
          )}
        </div>
      )}

      {error && (
        <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">{error}</div>
      )}

      {/* 設定パネル */}
      <div className="bg-white rounded-xl border p-5 space-y-4">
        <h2 className="font-semibold text-[#003D6B]">計測設定</h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* キーワード */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">キーワード</label>
            {savedKeywords.length > 0 ? (
              <select
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                disabled={measuring}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              >
                {savedKeywords.map((kw) => (
                  <option key={kw} value={kw}>{kw}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="例: 美容室 渋谷"
                className="w-full border rounded-lg px-3 py-2 text-sm"
                disabled={measuring}
              />
            )}
            <button
              onClick={fetchFromSheet}
              disabled={sheetLoading || measuring}
              className="mt-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50 transition"
            >
              {sheetLoading ? "取得中..." : "シートから反映"}
            </button>
          </div>

          {/* グリッドサイズ */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              グリッドサイズ ({gridSize}x{gridSize} = {gridSize * gridSize}地点)
            </label>
            <div className="flex gap-2">
              {GRID_SIZES.map((s) => (
                <button
                  key={s}
                  onClick={() => setGridSize(s)}
                  disabled={measuring}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition ${
                    gridSize === s
                      ? "bg-[#003D6B] text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  {s}x{s}
                </button>
              ))}
            </div>
          </div>

          {/* 距離間隔 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">距離間隔</label>
            <div className="flex gap-2">
              {INTERVALS.map((iv) => (
                <button
                  key={iv.value}
                  onClick={() => setInterval(iv.value)}
                  disabled={measuring}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition ${
                    interval === iv.value
                      ? "bg-[#003D6B] text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  {iv.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 店舗座標表示 */}
        {shopLat ? (
          <p className="text-xs text-gray-400">
            店舗座標: {shopLat.toFixed(6)}, {shopLng.toFixed(6)} ／
            計測範囲: 約{((gridSize - 1) * interval) / 1000}km四方
          </p>
        ) : (
          <div className="flex items-center gap-2">
            <p className="text-xs text-red-400">店舗にGBP座標が登録されていません</p>
            {selectedShopId && (
              <button
                onClick={async () => {
                  try {
                    const res = await api.post("/api/report/sync-coordinates", { shopId: selectedShopId }, { timeout: 60000 });
                    if (res.data?.updated > 0 && res.data?.details?.[0]) {
                      const d = res.data.details[0];
                      setShopLat(d.lat);
                      setShopLng(d.lng);
                      alert(`座標を取得しました: ${d.lat.toFixed(6)}, ${d.lng.toFixed(6)}`);
                    } else {
                      alert(res.data?.details?.[0]?.error || "座標を取得できませんでした");
                    }
                  } catch (e: any) {
                    alert("座標取得エラー: " + (e?.message || "不明"));
                  }
                }}
                className="text-xs bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600 transition"
              >
                GBPから自動取得
              </button>
            )}
          </div>
        )}

        {/* 実行ボタン */}
        <div className="flex gap-3 items-center">
          <button
            onClick={startMeasure}
            disabled={measuring || !keyword.trim() || !shopLat}
            className="bg-[#003D6B] text-white px-6 py-2.5 rounded-lg text-sm font-semibold hover:bg-[#00507A] disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {measuring ? "計測中..." : "計測開始"}
          </button>
          {measuring && (
            <button
              onClick={() => { abortRef.current = true; }}
              className="bg-red-500 text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-red-600 transition"
            >
              中断
            </button>
          )}
          {progress && <span className="text-sm text-gray-500">{progress}</span>}
          {aborted && <span className="text-sm text-red-500">中断しました</span>}
          {selectedShopId && selectedShop && (
            <button
              onClick={() => addToPreset(selectedShopId, (selectedShop as any).name || "", keyword, gridSize)}
              className="bg-indigo-500 text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-indigo-600 transition"
            >
              いつもの店舗に追加
            </button>
          )}
        </div>
      </div>

      {/* メインコンテンツ: マップ + グリッドテーブル */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Google Maps */}
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="p-3 border-b flex items-center justify-between">
            <h3 className="font-semibold text-[#003D6B] text-sm">順位マップ</h3>
            <div className="flex gap-2">
              {displayResults.length > 0 && (
                <>
                  <button
                    onClick={downloadPNG}
                    className="text-xs bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg transition"
                  >
                    PNG保存
                  </button>
                  <button
                    onClick={downloadCSV}
                    className="text-xs bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg transition"
                  >
                    CSV保存
                  </button>
                </>
              )}
            </div>
          </div>
          <div ref={mapRef} className="w-full h-[500px] bg-gray-100" />
          {/* 凡例 */}
          <div className="p-3 border-t flex flex-wrap gap-3 text-xs">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full inline-block" style={{ background: "#16A34A" }} /> 1-3位
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full inline-block" style={{ background: "#2563EB" }} /> 4-10位
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full inline-block" style={{ background: "#F59E0B" }} /> 11-20位
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full inline-block" style={{ background: "#EF4444" }} /> 21位以降
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full inline-block" style={{ background: "#6B7280" }} /> 圏外
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 inline-block" style={{ color: "#000" }}>▼</span> 店舗
            </span>
          </div>
        </div>

        {/* グリッドテーブル */}
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="p-3 border-b">
            <h3 className="font-semibold text-[#003D6B] text-sm">
              順位グリッド
              {displayResults.length > 0 && (
                <span className="ml-2 text-gray-400 font-normal">
                  検出: {rankedCount}/{displayResults.length}地点 ／ 平均: {avgRank(displayResults)}位
                </span>
              )}
            </h3>
          </div>
          <div className="p-4 overflow-auto">
            {rows && rows.length > 0 ? (
              <table className="mx-auto border-collapse">
                <tbody>
                  {rows.map((row, ri) => (
                    <tr key={ri}>
                      {row.map((pt) => (
                        <td
                          key={`${pt.row}-${pt.col}`}
                          className={`w-12 h-12 text-center text-sm font-bold border ${rankBg(pt.rank)} ${
                            pt.row === Math.floor(gridSize / 2) && pt.col === Math.floor(gridSize / 2)
                              ? "ring-2 ring-black ring-inset"
                              : ""
                          }`}
                          title={`(${pt.lat.toFixed(4)}, ${pt.lng.toFixed(4)})`}
                        >
                          {pt.rank > 0 ? pt.rank : pt.rank === 0 ? "" : "-"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-gray-400 text-sm text-center py-10">
                キーワードを入力して計測を開始してください
              </p>
            )}
          </div>

          {/* KPIサマリー */}
          {displayResults.length > 0 && rankedCount > 0 && (
            <div className="p-4 border-t grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="text-center">
                <p className="text-xs text-gray-500">平均順位</p>
                <p className="text-xl font-bold text-[#003D6B]">{avgRank(displayResults)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500">TOP3地点</p>
                <p className="text-xl font-bold text-green-600">
                  {displayResults.filter((r) => r.rank > 0 && r.rank <= 3).length}
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500">TOP10地点</p>
                <p className="text-xl font-bold text-blue-600">
                  {displayResults.filter((r) => r.rank > 0 && r.rank <= 10).length}
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500">圏外</p>
                <p className="text-xl font-bold text-gray-500">
                  {displayResults.filter((r) => r.rank <= 0).length}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 計測履歴 */}
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="p-4 border-b">
          <h3 className="font-semibold text-[#003D6B]">計測履歴</h3>
        </div>
        {history.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-4 py-2">日時</th>
                  <th className="text-left px-4 py-2">キーワード</th>
                  <th className="text-left px-4 py-2">グリッド</th>
                  <th className="text-left px-4 py-2">間隔</th>
                  <th className="text-left px-4 py-2">平均順位</th>
                  <th className="text-left px-4 py-2">TOP3</th>
                  <th className="text-left px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {history.map((log) => {
                  const results = log.results || [];
                  const avg = avgRank(results);
                  const top3 = results.filter((r) => r.rank > 0 && r.rank <= 3).length;
                  const isSelected = selectedHistory?.id === log.id;
                  return (
                    <tr
                      key={log.id}
                      className={`border-t cursor-pointer hover:bg-blue-50 transition ${
                        isSelected ? "bg-blue-50" : ""
                      }`}
                      onClick={() => showHistory(log)}
                    >
                      <td className="px-4 py-2.5">
                        {new Date(log.measured_at).toLocaleString("ja-JP", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="px-4 py-2.5 font-medium">{log.keyword}</td>
                      <td className="px-4 py-2.5">{log.grid_size}x{log.grid_size}</td>
                      <td className="px-4 py-2.5">
                        {log.interval_m >= 1000 ? `${log.interval_m / 1000}km` : `${log.interval_m}m`}
                      </td>
                      <td className="px-4 py-2.5 font-semibold">{avg}位</td>
                      <td className="px-4 py-2.5">
                        <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full text-xs font-medium">
                          {top3}地点
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {isSelected && (
                          <span className="text-xs text-blue-600 font-medium">表示中</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-400 text-sm text-center py-8">計測履歴はありません</p>
        )}
      </div>
    </div>
  );
}

// Google Maps型定義
declare global {
  interface Window {
    google: any;
  }
}
