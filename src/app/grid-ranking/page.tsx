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
  const ranked = results.filter((r) => r.rank > 0);
  if (ranked.length === 0) return "-";
  return (ranked.reduce((a, b) => a + b.rank, 0) / ranked.length).toFixed(1);
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
      const dRow = row - half;
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

export default function GridRankingPage() {
  const { selectedShopId, selectedShop } = useShop();
  const [keyword, setKeyword] = useState("");
  const [gridSize, setGridSize] = useState<number>(7);
  const [interval, setInterval] = useState(1000);
  const [measuring, setMeasuring] = useState(false);
  const [progress, setProgress] = useState("");
  const [gridResults, setGridResults] = useState<GridPoint[]>([]);
  const [history, setHistory] = useState<GridLog[]>([]);
  const [selectedHistory, setSelectedHistory] = useState<GridLog | null>(null);
  const [error, setError] = useState("");
  const [aborted, setAborted] = useState(false);
  const abortRef = useRef(false);
  const mapRef = useRef<HTMLDivElement>(null);
  const googleMapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);

  const shopLat = (selectedShop as any)?.gbp_latitude || 0;
  const shopLng = (selectedShop as any)?.gbp_longitude || 0;

  // 履歴取得
  const fetchHistory = useCallback(async () => {
    if (!selectedShopId) return;
    try {
      const res = await api.get(`/api/report/grid-ranking?shopId=${selectedShopId}`);
      setHistory(res.data || []);
    } catch {}
  }, [selectedShopId]);

  useEffect(() => {
    fetchHistory();
    setGridResults([]);
    setSelectedHistory(null);
  }, [selectedShopId, fetchHistory]);

  // Google Maps初期化
  useEffect(() => {
    if (!mapRef.current) return;
    if (typeof window === "undefined") return;

    const initMap = () => {
      if (!window.google?.maps) return;
      const lat = shopLat || 35.6812;
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
      <h1 className="text-2xl font-bold text-[#003D6B]">多地点順位チェック</h1>
      <p className="text-sm text-gray-500">
        店舗を中心にグリッド状の地点を自動生成し、各地点でのキーワード順位を一括計測します。
        Google Maps上に順位を色付きピンで可視化できます。
      </p>

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
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="例: 美容室 渋谷"
              className="w-full border rounded-lg px-3 py-2 text-sm"
              disabled={measuring}
            />
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
          <p className="text-xs text-red-400">店舗にGBP座標が登録されていません</p>
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
