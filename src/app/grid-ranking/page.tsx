"use client";

import { useEffect, useCallback, useState, useRef, useMemo } from "react";
import api from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { useShop } from "@/components/shop-provider";
import DateRangePicker, { useDateRange } from "@/components/date-range-picker";
import { jstToday } from "@/lib/jst-date";

interface GridPoint {
  row: number;
  col: number;
  lat: number;
  lng: number;
  rank: number; // 0 = 未計測, -1 = 圏外
  estimated?: boolean; // true = 3×3推定による補間値
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
  if (rank <= 3) return "#2563EB";  // 1-3位 = 青
  if (rank <= 10) return "#16A34A"; // 4-10位 = 緑
  if (rank <= 20) return "#F59E0B"; // 11-20位 = 黄
  return "#EF4444";                 // 21位以降 = 赤
}

function rankBg(rank: number): string {
  if (rank <= 0) return "bg-gray-100 text-gray-500";
  if (rank <= 3) return "bg-blue-100 text-blue-700";
  if (rank <= 10) return "bg-green-100 text-green-700";
  if (rank <= 20) return "bg-yellow-100 text-yellow-700";
  return "bg-red-100 text-red-700";
}

function avgRank(results: GridPoint[]): string {
  if (results.length === 0) return "-";
  const total = results.reduce((a, b) => a + (b.rank > 0 ? b.rank : 101), 0);
  return (total / results.length).toFixed(1);
}

/** 今月計測済みかどうか判定 */
function isMeasuredThisMonth(measuredAt: string | undefined | null): boolean {
  if (!measuredAt) return false;
  const d = new Date(measuredAt);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
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
  all_keywords?: string[];
  has_coordinates?: boolean;
  last_measurement?: {
    measured_at: string;
    keyword: string;
    avg_rank: number | null;
    top3: number;
    total: number;
  } | null;
}

interface CostEstimate {
  totalShops: number;
  totalRequests: number;
  monthlyCost: string;
  freeRequests: number;
  withinFree: boolean;
}

export default function GridRankingPage() {
  const { selectedShopId, selectedShop, shops, shopFilterMode } = useShop();
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

  // 全店舗パネル
  const [showAllShopsPanel, setShowAllShopsPanel] = useState(false);
  const [allShopsBatchRunning, setAllShopsBatchRunning] = useState(false);
  const [allShopsBatchProgress, setAllShopsBatchProgress] = useState("");
  const [allShopsCoordSyncing, setAllShopsCoordSyncing] = useState(false);
  const [allShopsCoordResult, setAllShopsCoordResult] = useState("");
  const [allShopsKwSyncing, setAllShopsKwSyncing] = useState(false);
  const [allShopsKwResult, setAllShopsKwResult] = useState("");

  // KW未取得一覧
  const [kwMissingShops, setKwMissingShops] = useState<{ shopId: string; shopName: string; checkedAt: string }[]>([]);
  const [kwMissingLoaded, setKwMissingLoaded] = useState(false);

  // ステータスサマリー
  const [gridStats, setGridStats] = useState<{
    totalShops: number; withCoord: number; withoutCoord: number;
    withKw: number; kwNotFound: number;
    measuredThisMonth: number; unmeasuredThisMonth: number;
    lastMeasuredAt: string | null;
  } | null>(null);

  // プリセット読み込み（空データで上書きしないよう保護）
  const refreshPresets = useCallback(async () => {
    try {
      const res = await api.get("/api/report/grid-ranking-presets");
      const data = res.data;
      if (data.presets && data.presets.length > 0) {
        setPresets(data.presets);
        setEstimate(data.estimate || null);
      } else if (data.presets && data.presets.length === 0) {
        // 本当に0件の場合のみクリア（エラーレスポンスではないことを確認）
        if (!data.error) {
          setPresets([]);
          setEstimate(data.estimate || null);
        }
      }
    } catch {}
  }, []);

  useEffect(() => { refreshPresets(); }, [refreshPresets]);

  // KW未取得一覧 + ステータスサマリーの読み込み
  const refreshKwMissing = useCallback(async () => {
    try {
      const res = await api.get("/api/report/kw-missing");
      setKwMissingShops(res.data.shops || []);
      setKwMissingLoaded(true);
    } catch {}
  }, []);
  const refreshGridStats = useCallback(async () => {
    try {
      const res = await api.get("/api/report/grid-stats");
      setGridStats(res.data);
    } catch {}
  }, []);
  useEffect(() => { refreshKwMissing(); refreshGridStats(); }, [refreshKwMissing, refreshGridStats]);

  // プリセットに追加（シートからKW自動取得）
  const [addingPreset, setAddingPreset] = useState(false);
  const addToPreset = async (shopId: string, shopName: string, size?: number) => {
    setAddingPreset(true);
    try {
      // シートからKW自動取得
      let bestKw: string | null = null;
      let allKws: string[] = [];
      try {
        const kwRes = await api.get(`/api/report/ranking-keywords?shopName=${encodeURIComponent(shopName)}`);
        if (kwRes.data?.found && kwRes.data.keywords?.length > 0) {
          allKws = kwRes.data.keywords;
          bestKw = kwRes.data.ranks?.length > 0
            ? [...kwRes.data.ranks].sort((a: any, b: any) => (a.rank || 999) - (b.rank || 999))[0]?.word || allKws[0]
            : allKws[0];
          // shop_keywordsにも保存
          await api.put("/api/report/shop-keywords", { shopId, keywords: allKws, source: "sheet" });
        }
      } catch {}
      // プリセット登録
      await api.post("/api/report/grid-ranking-presets", { shops: [{ shopId, shopName, keyword: bestKw, gridSize: size || 7 }] });
      await refreshPresets();
      setShowPresetPanel(true);
    } finally {
      setAddingPreset(false);
    }
  };

  // プリセットから削除
  const removeFromPreset = async (shopId: string) => {
    await api.delete("/api/report/grid-ranking-presets", { data: { shopIds: [shopId] } });
    await refreshPresets();
  };
  const [selectedHistory, setSelectedHistory] = useState<GridLog | null>(null);
  const { startMonth: grStart, endMonth: grEnd, setRange: grSetRange, isInRange: grIsInRange } = useDateRange(6);
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
    // Go APIに座標がない場合、Supabaseから店舗名で取得（Go API⇔SupabaseのID不一致対策）
    const shopName = (selectedShop as any)?.name;
    if (!shopName) return;
    import("@/lib/supabase").then(({ supabase }) => {
      supabase
        .from("shops")
        .select("gbp_latitude, gbp_longitude")
        .eq("name", shopName)
        .not("gbp_latitude", "is", null)
        .gt("gbp_latitude", 0)
        .limit(1)
        .maybeSingle()
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
    a.download = `${shopName}_グリッド順位_${keyword}_${jstToday()}.csv`;
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
      a.download = `${shopName}_グリッド順位マップ_${keyword}_${jstToday()}.png`;
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
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-[#003D6B]">多地点順位チェック</h1>
            <div className="relative group">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-slate-200 text-slate-500 text-xs font-bold cursor-help">?</span>
              <div className="absolute left-0 top-7 z-50 hidden group-hover:block w-80 bg-white text-slate-700 text-xs rounded-lg p-4 shadow-xl border border-slate-200 leading-relaxed">
                <p className="font-bold text-[#003D6B] text-sm mb-1.5">多地点順位チェックとは？</p>
                <p>店舗を中心にグリッド状（例: 7×7=49地点）の地点を生成し、各地点でのGoogle検索順位を計測します。エリアごとの順位分布を可視化できます。</p>
                <p className="mt-3 font-bold text-[#003D6B] text-sm mb-1.5">基本の使い方</p>
                <p>1. 店舗を選択してキーワードを入力</p>
                <p>2.「計測開始」で個別計測 or「いつもの店舗」に追加して一括計測</p>
                <p>3. 結果はマップ+グリッドで表示、CSV/PNGで保存可能</p>
              </div>
            </div>
          </div>
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
            <div className="flex items-center gap-1.5">
              <h2 className="text-base font-bold text-[#003D6B]">いつも計測する店舗</h2>
              <div className="relative group">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-slate-200 text-slate-500 text-[10px] font-bold cursor-help">?</span>
                <div className="absolute left-0 top-6 z-50 hidden group-hover:block w-72 bg-white text-slate-700 text-xs rounded-lg p-4 shadow-xl border border-slate-200 leading-relaxed">
                  <p className="font-bold text-[#003D6B] text-sm mb-1.5">使い方</p>
                  <p>1. 下の計測画面で店舗を選び「いつもの店舗に追加」</p>
                  <p>2.「一括計測」で全店舗をまとめて計測</p>
                  <p className="mt-3 font-bold text-[#003D6B] text-sm mb-1.5">ステータスの見方</p>
                  <p><span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 mr-1.5 align-middle"></span>準備OK（座標+KW設定済み）</p>
                  <p><span className="inline-block w-2.5 h-2.5 rounded-full bg-yellow-400 mr-1.5 align-middle"></span>KW未設定（一括計測時に自動取得）</p>
                  <p><span className="inline-block w-2.5 h-2.5 rounded-full bg-red-400 mr-1.5 align-middle"></span>座標なし（一括計測時に自動取得）</p>
                  <p className="mt-3 text-slate-500 border-t pt-2">座標・KWが不足していても「一括計測」を押せば自動で取得してから計測します。</p>
                </div>
              </div>
            </div>
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
            <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
              {/* ヘッダー */}
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-3 py-1 text-xs text-slate-400 font-medium border-b">
                <span>店舗名</span>
                <span className="w-[200px]">計測KW</span>
                <span className="w-[140px] text-center">前回結果</span>
                <span className="w-8"></span>
              </div>
              {presets.map(p => {
                const allKws = p.all_keywords && p.all_keywords.length > 0 ? p.all_keywords : (p.keyword ? [p.keyword] : []);
                const hasCoord = p.has_coordinates;
                const lm = p.last_measurement;
                const daysSince = lm ? Math.floor((Date.now() - new Date(lm.measured_at).getTime()) / 86400000) : null;
                const measuredThisMonth = isMeasuredThisMonth(lm?.measured_at);
                return (
                  <div key={p.id} className={`grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center py-2 px-3 rounded-lg ${measuredThisMonth ? "bg-slate-50" : "bg-orange-50 border border-orange-200"}`}>
                    {/* 店舗名 + ステータスドット */}
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${hasCoord && (p.keyword || allKws.length > 0) ? "bg-emerald-500" : hasCoord ? "bg-yellow-400" : "bg-red-400"}`}
                        title={!hasCoord ? "座標なし" : !(p.keyword || allKws.length > 0) ? "KW未設定" : "準備OK"} />
                      <span className="text-sm font-medium text-slate-800 truncate">{p.shop_name}</span>
                      <span className="text-xs text-slate-400 flex-shrink-0">{p.grid_size}x{p.grid_size}</span>
                      {measuredThisMonth
                        ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-600 font-semibold flex-shrink-0">{new Date().getMonth() + 1}月済</span>
                        : <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-600 font-semibold flex-shrink-0">未計測</span>
                      }
                    </div>
                    {/* KW選択 */}
                    <div className="w-[200px]">
                      {allKws.length > 1 ? (
                        <>
                          <select
                            value={p.keyword || ""}
                            onChange={async (e) => {
                              const newKw = e.target.value;
                              await api.post("/api/report/grid-ranking-presets", { shops: [{ shopId: p.shop_id, shopName: p.shop_name, keyword: newKw, gridSize: p.grid_size }] });
                              await refreshPresets();
                            }}
                            className="w-full text-xs border rounded px-1.5 py-1 text-indigo-600"
                          >
                            {allKws.map(kw => (
                              <option key={kw} value={kw}>{kw}</option>
                            ))}
                          </select>
                          <span className="text-[10px] text-slate-400 mt-0.5 block">他{allKws.length - 1}KWは3×3で計測</span>
                        </>
                      ) : p.keyword ? (
                        <span className="text-xs text-indigo-500 truncate block">{p.keyword}</span>
                      ) : (
                        <span className="text-xs text-red-400">KW未設定</span>
                      )}
                    </div>
                    {/* 前回結果 */}
                    <div className="w-[140px] text-center">
                      {lm ? (
                        <div className="flex items-center justify-center gap-1.5">
                          <span className={`text-xs font-bold ${lm.avg_rank && lm.avg_rank <= 10 ? "text-emerald-600" : lm.avg_rank && lm.avg_rank <= 20 ? "text-blue-600" : "text-orange-600"}`}>
                            平均{lm.avg_rank ?? "-"}位
                          </span>
                          <span className="text-xs text-slate-400">
                            {daysSince === 0 ? "今日" : daysSince === 1 ? "昨日" : `${daysSince}日前`}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">未計測</span>
                      )}
                    </div>
                    {/* 削除 */}
                    <button onClick={() => removeFromPreset(p.shop_id)}
                      className="w-8 text-center text-xs text-red-400 hover:text-red-600">✕</button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-slate-400">店舗が登録されていません。下の計測画面で店舗を選択し「いつもの店舗に追加」で登録できます。</p>
          )}

          {/* ステータスサマリー */}
          {presets.length > 0 && (() => {
            const noCoord = presets.filter(p => !p.has_coordinates).length;
            const noKw = presets.filter(p => !p.keyword && !(p.all_keywords && p.all_keywords.length > 0)).length;
            const unmeasured = presets.filter(p => !isMeasuredThisMonth(p.last_measurement?.measured_at)).length;
            const measured = presets.length - unmeasured;
            return (
              <div className="flex gap-3 text-xs flex-wrap">
                <span className={unmeasured > 0 ? "text-orange-600 font-bold" : "text-emerald-600 font-bold"}>
                  今月: {measured}/{presets.length}件 計測済み
                  {unmeasured > 0 && `（残り${unmeasured}件）`}
                </span>
                {noCoord > 0 && <span className="text-red-500">座標なし: {noCoord}件</span>}
                {noKw > 0 && <span className="text-orange-500">KW未設定: {noKw}件</span>}
              </div>
            );
          })()}

          {/* アクションボタン */}
          {presets.length > 0 && (
            <div className="space-y-3">
              {/* 補助ボタン（座標・KW個別取得） */}
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    if (coordSyncing) return;
                    setCoordSyncing(true);
                    setCoordSyncResult("座標取得中...");
                    try {
                      const res = await api.post("/api/report/sync-coordinates", {}, { timeout: 300000 });
                      const totalUpdated = res.data?.updated || 0;
                      const totalErrors = res.data?.errors || 0;
                      setCoordSyncResult(totalUpdated > 0
                        ? `${totalUpdated}店舗の座標を取得${totalErrors > 0 ? `（${totalErrors}件失敗）` : ""}`
                        : "全店舗設定済み");
                      await refreshPresets();
                    } catch (e: any) {
                      setCoordSyncResult("エラー: " + (e?.message || "不明"));
                    } finally { setCoordSyncing(false); }
                  }}
                  disabled={coordSyncing || batchRunning}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${coordSyncing ? "bg-slate-100 text-slate-400" : "bg-slate-100 text-blue-600 hover:bg-blue-50 border border-blue-200"}`}
                >
                  {coordSyncing ? "座標取得中..." : "座標一括取得"}
                </button>
                <button
                  onClick={async () => {
                    if (kwSyncing) return;
                    setKwSyncing(true);
                    setKwSyncResult("KW取得中...");
                    let updated = 0, failed = 0;
                    for (let i = 0; i < presets.length; i++) {
                      const p = presets[i];
                      setKwSyncResult(`KW取得中... ${i + 1}/${presets.length}`);
                      try {
                        const res = await api.get(`/api/report/ranking-keywords?shopName=${encodeURIComponent(p.shop_name)}`);
                        if (res.data?.found && res.data.keywords?.length > 0) {
                          const bestKw = res.data.ranks?.length > 0
                            ? [...res.data.ranks].sort((a: any, b: any) => (a.rank || 999) - (b.rank || 999))[0]?.word || res.data.keywords[0]
                            : res.data.keywords[0];
                          await api.post("/api/report/grid-ranking-presets", { shops: [{ shopId: p.shop_id, shopName: p.shop_name, keyword: bestKw, gridSize: p.grid_size }] });
                          await api.put("/api/report/shop-keywords", { shopId: p.shop_id, keywords: res.data.keywords, source: "sheet" });
                          updated++;
                        } else { failed++; }
                      } catch { failed++; }
                      await new Promise(r => setTimeout(r, 500));
                    }
                    await refreshPresets();
                    setKwSyncResult(`${updated}件更新${failed > 0 ? `（${failed}件見つからず）` : ""}`);
                    setKwSyncing(false);
                  }}
                  disabled={kwSyncing || batchRunning}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${kwSyncing ? "bg-slate-100 text-slate-400" : "bg-slate-100 text-purple-600 hover:bg-purple-50 border border-purple-200"}`}
                >
                  {kwSyncing ? "KW取得中..." : "KW一括取得"}
                </button>
              </div>
              {(coordSyncResult || kwSyncResult) && (
                <div className="flex gap-3 text-xs">
                  {coordSyncResult && <span className={coordSyncResult.includes("エラー") ? "text-red-500" : "text-blue-500"}>{coordSyncResult}</span>}
                  {kwSyncResult && <span className={kwSyncResult.includes("見つからず") ? "text-orange-500" : "text-purple-500"}>{kwSyncResult}</span>}
                </div>
              )}

              {/* メイン: スマート一括計測ボタン */}
              <button
                onClick={async () => {
                  if (batchRunning) return;
                  const unmeasuredPresets = presets.filter(p => !isMeasuredThisMonth(p.last_measurement?.measured_at));
                  if (unmeasuredPresets.length === 0) { alert("全店舗 今月計測済みです"); return; }
                  const noCoord = presets.filter(p => !p.has_coordinates).length;
                  const noKw = presets.filter(p => !p.keyword && !(p.all_keywords && p.all_keywords.length > 0)).length;
                  const steps = [];
                  if (noCoord > 0) steps.push(`座標取得(${noCoord}件)`);
                  if (noKw > 0) steps.push(`KW取得(${noKw}件)`);
                  steps.push(`計測(${unmeasuredPresets.length}/${presets.length}店舗 — 今月計測済みはスキップ)`);
                  if (!confirm(`${steps.join(" → ")} を実行します。\n約${Math.ceil(unmeasuredPresets.length * 50 / 60)}分かかります。よろしいですか？`)) return;

                  setBatchRunning(true);

                  // Phase 1: 座標なし店舗の座標を取得
                  if (noCoord > 0) {
                    setBatchProgress("Phase 1/3: 座標を取得中...");
                    try {
                      const coordRes = await api.post("/api/report/sync-coordinates", {}, { timeout: 300000 });
                      const coordUpdated = coordRes.data?.updated || 0;
                      const coordErrors = coordRes.data?.errors || 0;
                      setBatchProgress(`Phase 1/3: 座標${coordUpdated}件取得${coordErrors > 0 ? `（${coordErrors}件失敗）` : ""}`);
                    } catch (e: any) {
                      setBatchProgress("Phase 1/3: 座標取得に失敗しました。計測を続行します...");
                    }
                    await new Promise(r => setTimeout(r, 1000));
                  }

                  // Phase 2: KWなし店舗のKWを取得
                  if (noKw > 0) {
                    const presetsNoKw = presets.filter(p => !p.keyword && !(p.all_keywords && p.all_keywords.length > 0));
                    let kwUpdated = 0, kwFailed = 0;
                    for (let i = 0; i < presetsNoKw.length; i++) {
                      const p = presetsNoKw[i];
                      setBatchProgress(`Phase 2/3: KW取得 ${i + 1}/${presetsNoKw.length} ${p.shop_name}`);
                      try {
                        const res = await api.get(`/api/report/ranking-keywords?shopName=${encodeURIComponent(p.shop_name)}`);
                        if (res.data?.found && res.data.keywords?.length > 0) {
                          const bestKw = res.data.ranks?.length > 0
                            ? [...res.data.ranks].sort((a: any, b: any) => (a.rank || 999) - (b.rank || 999))[0]?.word || res.data.keywords[0]
                            : res.data.keywords[0];
                          await api.post("/api/report/grid-ranking-presets", { shops: [{ shopId: p.shop_id, shopName: p.shop_name, keyword: bestKw, gridSize: p.grid_size }] });
                          await api.put("/api/report/shop-keywords", { shopId: p.shop_id, keywords: res.data.keywords, source: "sheet" });
                          kwUpdated++;
                        } else { kwFailed++; }
                      } catch { kwFailed++; }
                    }
                    if (kwFailed > 0) {
                      setBatchProgress(`Phase 2/3: KW${kwUpdated}件取得（${kwFailed}件見つからず）。計測を続行します...`);
                      await new Promise(r => setTimeout(r, 1500));
                    }
                  }

                  // プリセット再取得（座標・KW更新反映）
                  let latestPresets = presets;
                  try {
                    const refreshRes = await api.get("/api/report/grid-ranking-presets");
                    const refreshData = refreshRes.data;
                    if (refreshData.presets && refreshData.presets.length > 0) {
                      latestPresets = refreshData.presets;
                      setPresets(latestPresets);
                      setEstimate(refreshData.estimate || null);
                    }
                  } catch {}

                  // Phase 3: メインKW=7×7フル計測、サブKW=3×3実測→7×7推定生成（今月計測済みスキップ）
                  // 最新のlast_measurementを再チェック（Phase 1,2で更新された可能性）
                  const measuredThisMonthIds = new Set<string>();
                  for (const p of latestPresets) {
                    const lm = (p as any).last_measurement;
                    if (lm && isMeasuredThisMonth(lm.measured_at)) {
                      measuredThisMonthIds.add(p.shop_id);
                    }
                  }
                  const targetPresets = latestPresets.filter((p: any) => !measuredThisMonthIds.has(p.shop_id));
                  let completed = 0, skipped = 0, totalKws = 0;
                  const skippedCount = latestPresets.length - targetPresets.length;
                  if (skippedCount > 0) {
                    setBatchProgress(`Phase 3/3: 今月計測済み${skippedCount}店舗をスキップ`);
                    await new Promise(r => setTimeout(r, 1000));
                  }
                  for (let i = 0; i < targetPresets.length; i++) {
                    const p = targetPresets[i];
                    try {
                      let lat = 0, lng = 0;
                      try {
                        const { data: coordRow } = await supabase.from("shops").select("gbp_latitude, gbp_longitude").eq("name", p.shop_name).not("gbp_latitude", "is", null).gt("gbp_latitude", 0).limit(1).maybeSingle();
                        if (coordRow) { lat = coordRow.gbp_latitude || 0; lng = coordRow.gbp_longitude || 0; }
                      } catch {}
                      if (!lat || !lng) { skipped++; continue; }

                      const keywords = p.all_keywords && p.all_keywords.length > 0
                        ? p.all_keywords
                        : (p.keyword ? [p.keyword] : []);
                      if (keywords.length === 0) { skipped++; continue; }

                      // メインKW = プリセットのkeyword or 最初のKW
                      const mainKw = p.keyword || keywords[0];

                      for (let ki = 0; ki < keywords.length; ki++) {
                        const kw = keywords[ki];
                        const isMain = kw === mainKw;
                        const measureSize = isMain ? (p.grid_size || 7) : 3;

                        // 実測グリッド生成
                        const points = generateGrid(lat, lng, measureSize, 1000);
                        for (let j = 0; j < points.length; j++) {
                          const pt = points[j];
                          const label = isMain ? "7x7" : "3x3";
                          setBatchProgress(`${i + 1}/${targetPresets.length} ${p.shop_name} [KW ${ki + 1}/${keywords.length} ${label}] (${j + 1}/${points.length})`);
                          window.dispatchEvent(new Event("batch-activity"));
                          try {
                            let res;
                            for (let retry = 0; retry < 3; retry++) {
                              try {
                                res = await api.post("/api/report/grid-ranking", {
                                  shopId: p.shop_id, keyword: kw, lat: pt.lat, lng: pt.lng,
                                }, { timeout: 15000 });
                                break;
                              } catch (e: any) {
                                if (e?.response?.status === 429 && retry < 2) {
                                  setBatchProgress(`${i + 1}/${targetPresets.length} ${p.shop_name} [KW ${ki + 1}/${keywords.length}] レート制限待機中...`);
                                  await new Promise(r => setTimeout(r, 10000 * (retry + 1)));
                                } else { throw e; }
                              }
                            }
                            points[j] = { ...pt, rank: res?.data?.rank || 0 };
                          } catch { points[j] = { ...pt, rank: 0 }; }
                          await new Promise(r => setTimeout(r, 1000));
                        }

                        if (isMain) {
                          // メインKW: 実測結果をそのまま保存
                          await api.put("/api/report/grid-ranking", {
                            shopId: p.shop_id, keyword: kw, gridResults: points, gridSize: measureSize, interval: 1000,
                          });
                        } else {
                          // サブKW: 3×3実測→7×7推定生成してから保存
                          // 3×3の実測結果を7×7の中央3×3（row:2-4, col:2-4）にマッピング
                          const centerPoints = points.map(pt => ({
                            row: pt.row + 2, // 3×3の(0,0)→7×7の(2,2)
                            col: pt.col + 2,
                            rank: pt.rank,
                          }));
                          // API経由で7×7推定グリッド生成
                          const measuredSet = new Set(centerPoints.map((cp: any) => `${cp.row},${cp.col}`));
                          try {
                            const genRes = await api.post("/api/report/grid-ranking-generate", {
                              shopId: p.shop_id,
                              shopName: p.shop_name,
                              keyword: kw,
                              month: `${new Date().getFullYear()}/${new Date().getMonth() + 1}`,
                              centerPoints,
                              useFrom3x3: true,
                            });
                            // grid_ranking_logsにも保存（7×7の座標付き+推定フラグ）
                            const fullGrid = generateGrid(lat, lng, 7, 1000);
                            const generated = genRes.data?.results || [];
                            for (const g of generated) {
                              const idx = fullGrid.findIndex((fp: GridPoint) => fp.row === g.row && fp.col === g.col);
                              if (idx >= 0) {
                                fullGrid[idx].rank = g.rank;
                                fullGrid[idx].estimated = !measuredSet.has(`${g.row},${g.col}`);
                              }
                            }
                            await api.put("/api/report/grid-ranking", {
                              shopId: p.shop_id, keyword: kw, gridResults: fullGrid, gridSize: 7, interval: 1000,
                            });
                          } catch {
                            // 推定生成に失敗したら3×3の実測結果だけ保存
                            await api.put("/api/report/grid-ranking", {
                              shopId: p.shop_id, keyword: kw, gridResults: points, gridSize: 3, interval: 1000,
                            });
                          }
                        }
                        totalKws++;
                      }
                      completed++;
                    } catch {}
                    await new Promise(r => setTimeout(r, 1000));
                  }

                  // 最終結果を反映
                  await refreshPresets();

                  setBatchRunning(false);
                  const skipMsg = [];
                  if (skippedCount > 0) skipMsg.push(`計測済み${skippedCount}件`);
                  if (skipped > 0) skipMsg.push(`座標/KWなし${skipped}件`);
                  setBatchProgress(`✓ ${completed}店舗 × ${totalKws}KWの計測完了${skipMsg.length > 0 ? `（${skipMsg.join("・")}スキップ）` : ""}`);
                }}
                disabled={batchRunning || presets.filter(p => !isMeasuredThisMonth(p.last_measurement?.measured_at)).length === 0}
                className={`w-full py-3.5 rounded-lg text-sm font-bold transition-all ${batchRunning ? "bg-slate-200 text-slate-500" : presets.filter(p => !isMeasuredThisMonth(p.last_measurement?.measured_at)).length === 0 ? "bg-slate-200 text-slate-500 cursor-not-allowed" : "bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm"}`}
              >
                {batchRunning ? batchProgress : (() => {
                  const noCoord = presets.filter(p => !p.has_coordinates).length;
                  const noKw = presets.filter(p => !p.keyword && !(p.all_keywords && p.all_keywords.length > 0)).length;
                  const unmeasured = presets.filter(p => !isMeasuredThisMonth(p.last_measurement?.measured_at)).length;
                  const extras = [];
                  if (noCoord > 0) extras.push(`座標${noCoord}件`);
                  if (noKw > 0) extras.push(`KW${noKw}件`);
                  if (unmeasured === 0) return `全店舗 今月計測済み ✓`;
                  return extras.length > 0
                    ? `未計測のみ一括計測（${unmeasured}/${presets.length}店舗）— ${extras.join("+")}を自動取得`
                    : `未計測のみ一括計測（${unmeasured}/${presets.length}店舗）`;
                })()}
              </button>
              {batchProgress && !batchRunning && batchProgress.startsWith("✓") && (
                <p className="text-sm text-emerald-600 font-medium text-center">{batchProgress}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* 全店舗パネル（いつもの店舗を除外） */}
      <div className="bg-white rounded-xl shadow-sm border p-5 space-y-4">
        <div className="flex items-center justify-between">
          <button onClick={() => setShowAllShopsPanel(!showAllShopsPanel)}
            className="flex items-center gap-2">
            <h2 className="text-base font-bold text-[#003D6B]">全店舗計測</h2>
            <span className="text-xs text-slate-400">（いつもの店舗を除く）</span>
            <span className="text-xs text-slate-400">{showAllShopsPanel ? "▲" : "▼"}</span>
          </button>
          {(() => {
            const presetIds = new Set(presets.map(p => p.shop_id));
            const remaining = (shops || []).filter(s => !presetIds.has(s.id));
            return <span className="text-xs text-slate-500">{remaining.length}店舗</span>;
          })()}
        </div>

        {showAllShopsPanel && (() => {
          const presetIds = new Set(presets.map(p => p.shop_id));
          const allShopsFiltered = (shops || []).filter(s => !presetIds.has(s.id));

          return (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">いつもの店舗（{presets.length}件）を除く全{allShopsFiltered.length}店舗に対して座標取得・KW取得・計測を実行します。</p>

              {/* ボタン群 */}
              <div className="flex gap-2 flex-wrap">
                {/* 座標一括取得 */}
                <button
                  onClick={async () => {
                    if (allShopsCoordSyncing) return;
                    setAllShopsCoordSyncing(true);
                    setAllShopsCoordResult("座標取得中...");
                    try {
                      const res = await api.post("/api/report/sync-coordinates", {}, { timeout: 300000 });
                      const totalUpdated = res.data?.updated || 0;
                      const totalErrors = res.data?.errors || 0;
                      setAllShopsCoordResult(totalUpdated > 0
                        ? `${totalUpdated}店舗の座標を取得${totalErrors > 0 ? `（${totalErrors}件失敗）` : ""}`
                        : "全店舗設定済み");
                    } catch (e: any) {
                      setAllShopsCoordResult("エラー: " + (e?.message || "不明"));
                    } finally { setAllShopsCoordSyncing(false); }
                  }}
                  disabled={allShopsCoordSyncing || allShopsBatchRunning}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${allShopsCoordSyncing ? "bg-slate-100 text-slate-400" : "bg-slate-100 text-blue-600 hover:bg-blue-50 border border-blue-200"}`}
                >
                  {allShopsCoordSyncing ? "座標取得中..." : `座標一括取得（${allShopsFiltered.length}店舗）`}
                </button>

                {/* KW一括取得 */}
                <button
                  onClick={async () => {
                    if (allShopsKwSyncing) return;
                    setAllShopsKwSyncing(true);
                    setAllShopsKwResult("KW取得中...");
                    let updated = 0, failed = 0;
                    for (let i = 0; i < allShopsFiltered.length; i++) {
                      const s = allShopsFiltered[i];
                      setAllShopsKwResult(`KW取得中... ${i + 1}/${allShopsFiltered.length} ${s.name || ""}`);
                      try {
                        const shopName = s.name || s.id;
                        const res = await api.get(`/api/report/ranking-keywords?shopName=${encodeURIComponent(shopName)}`);
                        if (res.data?.found && res.data.keywords?.length > 0) {
                          await api.put("/api/report/shop-keywords", { shopId: s.id, keywords: res.data.keywords, source: "sheet" });
                          updated++;
                        } else { failed++; }
                      } catch { failed++; }
                      await new Promise(r => setTimeout(r, 500));
                    }
                    setAllShopsKwResult(`${updated}件更新${failed > 0 ? `（${failed}件見つからず）` : ""}`);
                    setAllShopsKwSyncing(false);
                  }}
                  disabled={allShopsKwSyncing || allShopsBatchRunning}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${allShopsKwSyncing ? "bg-slate-100 text-slate-400" : "bg-slate-100 text-purple-600 hover:bg-purple-50 border border-purple-200"}`}
                >
                  {allShopsKwSyncing ? "KW取得中..." : `KW一括取得（${allShopsFiltered.length}店舗）`}
                </button>
              </div>

              {/* ステータス表示 */}
              {(allShopsCoordResult || allShopsKwResult) && (
                <div className="flex gap-3 text-xs flex-wrap">
                  {allShopsCoordResult && <span className={allShopsCoordResult.includes("エラー") ? "text-red-500" : "text-blue-500"}>{allShopsCoordResult}</span>}
                  {allShopsKwResult && <span className={allShopsKwResult.includes("見つからず") ? "text-orange-500" : "text-purple-500"}>{allShopsKwResult}</span>}
                </div>
              )}

              {/* ステータスサマリー */}
              {gridStats && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div className="bg-blue-50 rounded-lg px-3 py-2 text-center">
                    <p className="text-[10px] text-blue-400 font-medium">今月計測済み</p>
                    <p className="text-lg font-bold text-blue-700">{gridStats.measuredThisMonth}<span className="text-xs font-normal text-blue-400">/{gridStats.totalShops}</span></p>
                  </div>
                  <div className="bg-orange-50 rounded-lg px-3 py-2 text-center">
                    <p className="text-[10px] text-orange-400 font-medium">未計測</p>
                    <p className="text-lg font-bold text-orange-600">{gridStats.unmeasuredThisMonth}</p>
                  </div>
                  <div className="bg-emerald-50 rounded-lg px-3 py-2 text-center">
                    <p className="text-[10px] text-emerald-400 font-medium">座標あり</p>
                    <p className="text-lg font-bold text-emerald-700">{gridStats.withCoord}<span className="text-xs font-normal text-emerald-400">/{gridStats.totalShops}</span></p>
                  </div>
                  <div className="bg-purple-50 rounded-lg px-3 py-2 text-center">
                    <p className="text-[10px] text-purple-400 font-medium">KW設定済み</p>
                    <p className="text-lg font-bold text-purple-700">{gridStats.withKw}<span className="text-xs font-normal text-purple-400">/{gridStats.totalShops}</span></p>
                  </div>
                </div>
              )}
              {gridStats?.lastMeasuredAt && (
                <p className="text-xs text-slate-400 text-right">最終計測: {new Date(gridStats.lastMeasuredAt).toLocaleString("ja-JP")}</p>
              )}

              {/* 全店舗一括計測ボタン */}
              <button
                onClick={async () => {
                  if (allShopsBatchRunning) return;
                  if (!confirm(`全${allShopsFiltered.length}店舗（いつもの店舗を除く）を計測します。\n今月計測済みの店舗は自動スキップします。\n座標・KW未取得の店舗は自動取得します。\n約${Math.ceil(allShopsFiltered.length * 50 / 60)}分かかります。よろしいですか？`)) return;

                  setAllShopsBatchRunning(true);

                  // Phase 1: 座標取得（未取得の店舗がある場合のみ）
                  setAllShopsBatchProgress("Phase 1/3: 座標を確認中...");
                  const { data: coordRows } = await supabase
                    .from("shops")
                    .select("name")
                    .not("gbp_latitude", "is", null)
                    .gt("gbp_latitude", 0)
                    .limit(10000);
                  const coordShopNames = new Set((coordRows || []).map((r: { name: string }) => r.name));
                  const shopsWithoutCoord = allShopsFiltered.filter(s => !coordShopNames.has(s.name || s.id));
                  if (shopsWithoutCoord.length > 0) {
                    setAllShopsBatchProgress(`Phase 1/3: 座標未取得${shopsWithoutCoord.length}店舗の座標を取得中...`);
                    try {
                      await api.post("/api/report/sync-coordinates", {}, { timeout: 300000 });
                    } catch {}
                    await new Promise(r => setTimeout(r, 500));
                  } else {
                    setAllShopsBatchProgress("Phase 1/3: 座標取得済み — スキップ");
                    await new Promise(r => setTimeout(r, 300));
                  }

                  // Phase 2: KW取得（未取得の店舗のみ）
                  setAllShopsBatchProgress("Phase 2/3: KWを確認中...");
                  const { data: kwRows } = await supabase
                    .from("shop_keywords")
                    .select("shop_id")
                    .limit(10000);
                  const kwShopIds = new Set((kwRows || []).map((r: { shop_id: string }) => r.shop_id));
                  const shopsWithoutKw = allShopsFiltered.filter(s => !kwShopIds.has(s.id));

                  let kwUpdated = 0, kwFailed = 0;
                  if (shopsWithoutKw.length > 0) {
                    for (let i = 0; i < shopsWithoutKw.length; i++) {
                      const s = shopsWithoutKw[i];
                      const shopName = s.name || s.id;
                      setAllShopsBatchProgress(`Phase 2/3: KW取得 ${i + 1}/${shopsWithoutKw.length} ${shopName}`);
                      try {
                        const res = await api.get(`/api/report/ranking-keywords?shopName=${encodeURIComponent(shopName)}`);
                        if (res.data?.found && res.data.keywords?.length > 0) {
                          await api.put("/api/report/shop-keywords", { shopId: s.id, keywords: res.data.keywords, source: "sheet" });
                          kwUpdated++;
                        } else {
                          // KW見つからず → 空マーカーを保存して次回スキップ
                          await api.put("/api/report/shop-keywords", { shopId: s.id, keywords: [], source: "not_found" }).catch(() => {});
                          kwFailed++;
                        }
                      } catch { kwFailed++; }
                      await new Promise(r => setTimeout(r, 500));
                    }
                    if (kwFailed > 0) {
                      setAllShopsBatchProgress(`Phase 2/3: KW${kwUpdated}件取得（${kwFailed}件見つからず）`);
                      await new Promise(r => setTimeout(r, 1500));
                    }
                  } else {
                    setAllShopsBatchProgress(`Phase 2/3: KW取得済み（${kwShopIds.size}店舗） — スキップ`);
                    await new Promise(r => setTimeout(r, 300));
                  }

                  // Phase 3: 計測（座標+KWがある店舗のみ、今月計測済みスキップ）

                  // 今月計測済みshop_idを一括取得
                  const now = new Date();
                  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01T00:00:00`;
                  const { data: measuredRows } = await supabase
                    .from("grid_ranking_logs")
                    .select("shop_id")
                    .gte("measured_at", monthStart)
                    .limit(10000);
                  const allMeasuredIds = new Set((measuredRows || []).map((r: any) => r.shop_id));
                  const allTargetShops = allShopsFiltered.filter(s => !allMeasuredIds.has(s.id));
                  const allSkippedMeasured = allShopsFiltered.length - allTargetShops.length;
                  if (allSkippedMeasured > 0) {
                    setAllShopsBatchProgress(`Phase 3/3: 今月計測済み${allSkippedMeasured}店舗をスキップ`);
                    await new Promise(r => setTimeout(r, 1000));
                  }
                  let completed = 0, skipped = 0, totalKws = 0;

                  for (let i = 0; i < allTargetShops.length; i++) {
                    const s = allTargetShops[i];
                    const shopName = s.name || s.id;
                    try {
                      // 座標取得
                      const { data: coordRow } = await supabase.from("shops").select("gbp_latitude, gbp_longitude").eq("name", s.name || s.id).not("gbp_latitude", "is", null).gt("gbp_latitude", 0).limit(1).maybeSingle();
                      if (!coordRow?.gbp_latitude) { skipped++; continue; }
                      const lat = coordRow.gbp_latitude;
                      const lng = coordRow.gbp_longitude;

                      // KW取得
                      const kwRes = await supabase.from("shop_keywords").select("keywords").eq("shop_id", s.id).maybeSingle();
                      const keywords: string[] = kwRes?.data?.keywords || [];
                      if (keywords.length === 0) { skipped++; continue; }

                      const mainKw = keywords[0];
                      for (let ki = 0; ki < keywords.length; ki++) {
                        const kw = keywords[ki];
                        const isMain = kw === mainKw;
                        const measureSize = isMain ? 7 : 3;

                        const points = generateGrid(lat, lng, measureSize, 1000);
                        for (let j = 0; j < points.length; j++) {
                          const pt = points[j];
                          const label = isMain ? "7x7" : "3x3";
                          setAllShopsBatchProgress(`${i + 1}/${allTargetShops.length} ${shopName} [KW ${ki + 1}/${keywords.length} ${label}] (${j + 1}/${points.length})`);
                          window.dispatchEvent(new Event("batch-activity"));
                          try {
                            let res;
                            for (let retry = 0; retry < 3; retry++) {
                              try {
                                res = await api.post("/api/report/grid-ranking", {
                                  shopId: s.id, keyword: kw, lat: pt.lat, lng: pt.lng,
                                }, { timeout: 15000 });
                                break;
                              } catch (e: any) {
                                if (e?.response?.status === 429 && retry < 2) {
                                  setAllShopsBatchProgress(`${i + 1}/${allTargetShops.length} ${shopName} レート制限待機中...`);
                                  await new Promise(r => setTimeout(r, 10000 * (retry + 1)));
                                } else { throw e; }
                              }
                            }
                            points[j] = { ...pt, rank: res?.data?.rank || 0 };
                          } catch { points[j] = { ...pt, rank: 0 }; }
                          await new Promise(r => setTimeout(r, 1000));
                        }

                        if (isMain) {
                          await api.put("/api/report/grid-ranking", {
                            shopId: s.id, keyword: kw, gridResults: points, gridSize: measureSize, interval: 1000,
                          });
                        } else {
                          const centerPoints = points.map(pt => ({ row: pt.row + 2, col: pt.col + 2, rank: pt.rank }));
                          try {
                            const genRes = await api.post("/api/report/grid-ranking-generate", {
                              shopId: s.id, shopName, keyword: kw,
                              month: `${new Date().getFullYear()}/${new Date().getMonth() + 1}`,
                              centerPoints, useFrom3x3: true,
                            });
                            const fullGrid = generateGrid(lat, lng, 7, 1000);
                            const measuredSet = new Set(centerPoints.map(cp => `${cp.row},${cp.col}`));
                            const generated = genRes.data?.results || [];
                            for (const g of generated) {
                              const idx = fullGrid.findIndex(fp => fp.row === g.row && fp.col === g.col);
                              if (idx >= 0) { fullGrid[idx].rank = g.rank; fullGrid[idx].estimated = !measuredSet.has(`${g.row},${g.col}`); }
                            }
                            await api.put("/api/report/grid-ranking", {
                              shopId: s.id, keyword: kw, gridResults: fullGrid, gridSize: 7, interval: 1000,
                            });
                          } catch {
                            await api.put("/api/report/grid-ranking", {
                              shopId: s.id, keyword: kw, gridResults: points, gridSize: 3, interval: 1000,
                            });
                          }
                        }
                        totalKws++;
                      }
                      completed++;
                    } catch {}
                    await new Promise(r => setTimeout(r, 1000));
                  }

                  setAllShopsBatchRunning(false);
                  const allSkipMsg = [];
                  if (allSkippedMeasured > 0) allSkipMsg.push(`計測済み${allSkippedMeasured}件`);
                  if (skipped > 0) allSkipMsg.push(`座標/KWなし${skipped}件`);
                  setAllShopsBatchProgress(`✓ ${completed}店舗 × ${totalKws}KWの計測完了${allSkipMsg.length > 0 ? `（${allSkipMsg.join("・")}スキップ）` : ""}`);
                  refreshKwMissing();
                  refreshGridStats();
                }}
                disabled={allShopsBatchRunning}
                className={`w-full py-3.5 rounded-lg text-sm font-bold transition-all ${allShopsBatchRunning ? "bg-slate-200 text-slate-500" : "bg-orange-500 text-white hover:bg-orange-600 shadow-sm"}`}
              >
                {allShopsBatchRunning ? allShopsBatchProgress : `未計測のみ一括計測（${allShopsFiltered.length}店舗 — いつもの店舗を除く）`}
              </button>
              {allShopsBatchProgress && !allShopsBatchRunning && allShopsBatchProgress.startsWith("✓") && (
                <p className="text-sm text-emerald-600 font-medium text-center">{allShopsBatchProgress}</p>
              )}

              {/* KW未取得一覧 */}
              {kwMissingLoaded && kwMissingShops.length > 0 && (
                <div className="mt-4 border border-amber-200 rounded-lg bg-amber-50">
                  <div className="px-4 py-2.5 border-b border-amber-200 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-amber-600 font-bold text-sm">KW未取得店舗</span>
                      <span className="bg-amber-200 text-amber-800 text-xs font-bold px-2 py-0.5 rounded-full">{kwMissingShops.length}件</span>
                    </div>
                    <span className="text-xs text-amber-500">シートにKW設定 → 次回バッチで自動解消</span>
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    {kwMissingShops.map((s) => (
                      <div key={s.shopId} className="px-4 py-1.5 border-b border-amber-100 last:border-b-0 flex items-center justify-between text-sm">
                        <span className="text-slate-700 truncate">{s.shopName}</span>
                        <span className="text-xs text-amber-400 whitespace-nowrap ml-2">
                          {new Date(s.checkedAt).toLocaleDateString("ja-JP")}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">{error}</div>
      )}

      {/* 個別店舗選択時のみ表示: 計測設定・マップ・グリッド・履歴 */}
      {selectedShopId && shopFilterMode === "single" ? (
      <>
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
                    const res = await api.post("/api/report/sync-coordinates", { shopId: selectedShopId, shopName: (selectedShop as any)?.name || "" }, { timeout: 60000 });
                    if (res.data?.error) {
                      alert(`座標取得失敗: ${res.data.error}`);
                    } else if (res.data?.updated > 0 && res.data?.details?.[0]) {
                      const d = res.data.details[0];
                      setShopLat(d.lat);
                      setShopLng(d.lng);
                      alert(`座標を取得しました: ${d.lat.toFixed(6)}, ${d.lng.toFixed(6)}`);
                    } else {
                      const errMsg = res.data?.details?.[0]?.error || res.data?.message || "座標を取得できませんでした";
                      alert(errMsg);
                    }
                  } catch (e: any) {
                    const msg = e?.response?.data?.error || e?.userMessage || e?.message || "不明";
                    alert("座標取得エラー: " + msg);
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
              onClick={() => addToPreset(selectedShopId, (selectedShop as any).name || "", gridSize)}
              disabled={addingPreset}
              className="bg-indigo-500 text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-indigo-600 transition disabled:opacity-50"
            >
              {addingPreset ? "追加中（KW取得中）..." : "いつもの店舗に追加"}
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
              <span className="w-3 h-3 rounded-full inline-block" style={{ background: "#2563EB" }} /> 1-3位
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full inline-block" style={{ background: "#16A34A" }} /> 4-10位
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
            <span className="flex items-center gap-1 border-l pl-3 ml-1">
              <span className="w-3 h-3 inline-block border opacity-60" style={{ backgroundImage: "repeating-linear-gradient(135deg, transparent, transparent 2px, rgba(0,0,0,0.1) 2px, rgba(0,0,0,0.1) 3px)" }} /> 推定値
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
                          } ${pt.estimated ? "opacity-60" : ""}`}
                          title={`(${pt.lat.toFixed(4)}, ${pt.lng.toFixed(4)})${pt.estimated ? " [推定]" : ""}`}
                          style={pt.estimated ? { backgroundImage: "repeating-linear-gradient(135deg, transparent, transparent 3px, rgba(0,0,0,0.06) 3px, rgba(0,0,0,0.06) 4px)" } : undefined}
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
        <div className="p-4 border-b flex items-center justify-between">
          <h3 className="font-semibold text-[#003D6B]">計測履歴</h3>
          {history.length > 0 && (
            <DateRangePicker startMonth={grStart} endMonth={grEnd} onChange={grSetRange} compact />
          )}
        </div>
        {(() => {
          const filtered = history.filter(l => {
            return l.measured_at && grIsInRange(l.measured_at);
          });
          return filtered.length > 0 ? (
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
                {filtered.map((log) => {
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
                      <td className="px-4 py-2.5 font-medium">
                        {log.keyword}
                        {(() => {
                          const r = log.results || [];
                          const hasEstimated = r.some((p: any) => p.estimated);
                          return hasEstimated
                            ? <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-600 font-semibold">3×3推定</span>
                            : <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-600 font-semibold">実測</span>;
                        })()}
                      </td>
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
                      <td className="px-4 py-2.5 flex items-center gap-2">
                        {isSelected && (
                          <span className="text-xs text-blue-600 font-medium">表示中</span>
                        )}
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (!confirm(`この計測履歴を削除しますか？\nKW: ${log.keyword}`)) return;
                            try {
                              await api.delete("/api/report/grid-ranking", { data: { id: log.id } });
                              fetchHistory();
                            } catch {}
                          }}
                          className="text-xs text-red-400 hover:text-red-600"
                        >削除</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-400 text-sm text-center py-8">この期間の計測履歴はありません</p>
        );
        })()}
      </div>
      </>
      ) : (
        <div className="bg-white rounded-xl border p-8 text-center">
          <p className="text-slate-500 text-sm">店舗を選択すると、計測設定・順位マップ・グリッド・履歴が表示されます。</p>
        </div>
      )}
    </div>
  );
}

// Google Maps型定義
declare global {
  interface Window {
    google: any;
  }
}
