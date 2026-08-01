"use client";

import { useEffect, useCallback, useState, useRef, useMemo } from "react";
import api from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { useShop } from "@/components/shop-provider";
import { useRole } from "@/components/role-provider";
import { can, PERMISSION_DENIED_HINT } from "@/lib/permissions";
import { usePasswordGate } from "@/components/password-gate";
import DateRangePicker, { useDateRange } from "@/components/date-range-picker";
import { jstToday } from "@/lib/jst-date";
import {
  generate5Points, GRID_ANGLES,
  summarizeGridRanks, formatAvgRank, formatCoverage,
} from "@/lib/grid-utils";
import { gridLayoutLabel } from "@/lib/report-utils";

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

// 計測は全店舗「中心＋外周4地点の5地点」に統一（2026-07-31 中心計測を復活）
// 3×3グリッドの中心+四隅スロットとして保存（奇数グリッド=centerCellが中心を返せる）
const GRID_SIZE_5POINT = 3;
const POINTS_PER_KW = 5;
const INTERVALS = [
  { label: "500m", value: 500 },
  { label: "1km", value: 1000 },
  { label: "2km", value: 2000 },
  { label: "3km", value: 3000 },
  { label: "4km", value: 4000 },
  { label: "5km", value: 5000 },
];
/** 計測地点の既定距離(m)。店舗ごとの設定(shops.grid_interval_m)が無い場合に使う */
const DEFAULT_INTERVAL = 500;
// 4点の回転角（grid-utils.GRID_ANGLES）。0度=斜め(NE/NW/SE/SW)、45度=十字(N/E/S/W)
const ANGLES = GRID_ANGLES;
const DEFAULT_ANGLE = 0;

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

// 平均順位の集計は src/lib/grid-utils.ts に集約（圏外を数値に混ぜない）。
// 以前はここで圏外を101として平均に足しており、全地点圏外で「101.0位」、
// 5地点中1地点だけ圏内でも「82.8位」と実在しない順位を表示していた。

/** 今月計測済みかどうか判定 */
function isMeasuredThisMonth(measuredAt: string | undefined | null): boolean {
  if (!measuredAt) return false;
  const d = new Date(measuredAt);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

// ===== Places API 費用目安 =====
// 単価: 店名照合(Pro) ¥4.8/リクエスト ／ ID照合(Essentials) ¥0.75/リクエスト
// 1地点 = 1〜4リクエスト（順位発見ページで打ち切り。圏外=4ページ全消費）
// 同月内の再計測・近隣店舗との共有キャッシュ命中分は ¥0
const YEN_PER_REQ_PRO = 4.8;
const YEN_PER_REQ_ESSENTIALS = 0.75;
function estimateCost(totalPoints: number): { max: number; afterId: number } {
  return {
    // 初回店舗（店名照合・圏外多め）の上限
    max: Math.round(totalPoints * 4 * YEN_PER_REQ_PRO),
    // ID移行後（Essentials・平均2ページ想定）の目安
    afterId: Math.round(totalPoints * 2 * YEN_PER_REQ_ESSENTIALS),
  };
}
// 1店舗の計測地点数: 全KW共通で中心＋外周4地点の5地点
function pointsPerShop(kwCount: number): number {
  return POINTS_PER_KW * Math.max(1, kwCount);
}

// generate5Points は src/lib/grid-utils.ts に分離（回転数式の単体テストのため）

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
    in_range?: number;
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
  const { role } = useRole();
  const isPresident = role === "president"; // API課金を伴う実行操作は社長のみ
  const { gate, PasswordGateModal } = usePasswordGate();
  const [keyword, setKeyword] = useState("");
  const [savedKeywords, setSavedKeywords] = useState<string[]>([]);
  // 競合比較などで使うメインKW。未指定なら savedKeywords[0] が使われる
  // （competitor-fetch.ts と同じ規則。画面とサーバーで判定を揃える）
  const [mainKeyword, setMainKeyword] = useState<string>("");
  const [savingMainKw, setSavingMainKw] = useState(false);
  // 全KW一括計測の進捗（空文字なら実行中でない）
  const [allKwProgress, setAllKwProgress] = useState("");
  // interval/angle = 選択中店舗の計測設定（shops.grid_interval_m / grid_angle_deg と同期。店舗ごとに永続化）
  const [interval, setInterval] = useState(DEFAULT_INTERVAL);
  const [angleDeg, setAngleDeg] = useState(DEFAULT_ANGLE);
  const [intervalSaving, setIntervalSaving] = useState(false);
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
  const [rankDisabledIds, setRankDisabledIds] = useState<Set<string>>(new Set());
  // 計測状況の一覧（どの店舗が計測済みか / 未計測なら何が足りないか）
  const [shopStatus, setShopStatus] = useState<{
    id: string; name: string; measured: boolean; lastMeasuredAt: string | null;
    keywordCount: number; hasCoord: boolean; reasons: string[];
  }[]>([]);
  const [statusTab, setStatusTab] = useState<"unmeasured" | "measured" | "all">("unmeasured");
  const [statusFilter, setStatusFilter] = useState("");
  const [allShopsBatchRunning, setAllShopsBatchRunning] = useState(false);
  const [allShopsBatchProgress, setAllShopsBatchProgress] = useState("");
  const [allShopsCoordSyncing, setAllShopsCoordSyncing] = useState(false);
  const [allShopsCoordResult, setAllShopsCoordResult] = useState("");
  const [allShopsKwSyncing, setAllShopsKwSyncing] = useState(false);
  const [allShopsKwResult, setAllShopsKwResult] = useState("");
  const [placeIdSyncing, setPlaceIdSyncing] = useState(false);
  const [placeIdResult, setPlaceIdResult] = useState("");

  // KW未取得一覧
  const [kwMissingShops, setKwMissingShops] = useState<{ shopId: string; shopName: string; checkedAt: string }[]>([]);
  const [kwMissingLoaded, setKwMissingLoaded] = useState(false);

  // ステータスサマリー
  const [gridStats, setGridStats] = useState<{
    totalShops: number; withCoord: number; withoutCoord: number;
    withKw: number; kwNotFound: number;
    measuredThisMonth: number; unmeasuredThisMonth: number;
    lastMeasuredAt: string | null;
    cost?: {
      billableShops: number; totalKeywords: number;
      withPlaceId: number; withoutPlaceId: number;
      max: number; typical: number;
    };
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

  // 順位計測の対象外店舗（エミナル等）。全店舗計測の対象から必ず除く。
  // 除かないと、対象外店舗ぶんの座標取得・KW取得・実測が走って課金が発生する
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/api/report/rank-tracking");
        setRankDisabledIds(new Set(((res.data?.shops || []) as { id: string }[]).map((s) => s.id)));
      } catch {}
    })();
  }, []);

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
  const refreshShopStatus = useCallback(async () => {
    try {
      const res = await api.get("/api/report/grid-shop-status");
      setShopStatus(res.data?.shops || []);
    } catch {}
  }, []);
  useEffect(() => { refreshKwMissing(); refreshGridStats(); refreshShopStatus(); }, [refreshKwMissing, refreshGridStats, refreshShopStatus]);

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
      await api.post("/api/report/grid-ranking-presets", { shops: [{ shopId, shopName, keyword: bestKw, gridSize: size || GRID_SIZE_5POINT }] });
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

  // 店舗ごとの計測設定を読込（shops.grid_interval_m / grid_angle_deg。店舗切替で同期）
  useEffect(() => {
    const shopName = (selectedShop as any)?.name;
    if (!shopName) return;
    let cancelled = false;
    setInterval(DEFAULT_INTERVAL);
    setAngleDeg(DEFAULT_ANGLE);
    api.get(`/api/report/grid-interval?shopName=${encodeURIComponent(shopName)}`)
      .then(res => {
        if (cancelled) return;
        if (res.data?.intervalM) setInterval(res.data.intervalM);
        if (typeof res.data?.angleDeg === "number") setAngleDeg(res.data.angleDeg);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedShopId, selectedShop]);

  // 距離ボタン変更: 即時反映＋店舗設定として永続化
  const changeInterval = async (value: number) => {
    setInterval(value);
    const shopName = (selectedShop as any)?.name;
    if (!shopName) return;
    setIntervalSaving(true);
    try {
      await api.put("/api/report/grid-interval", { shopName, intervalM: value });
    } catch {} finally {
      setIntervalSaving(false);
    }
  };

  // 向きボタン変更: 即時反映＋店舗設定として永続化
  const changeAngle = async (value: number) => {
    setAngleDeg(value);
    const shopName = (selectedShop as any)?.name;
    if (!shopName) return;
    setIntervalSaving(true);
    try {
      await api.put("/api/report/grid-interval", { shopName, angleDeg: value });
    } catch {} finally {
      setIntervalSaving(false);
    }
  };

  // 保存済みキーワードをDBから読み込み
  useEffect(() => {
    if (!selectedShopId) return;
    api.get(`/api/report/shop-keywords?shopId=${selectedShopId}`)
      .then((res) => {
        if (res.data?.keywords?.length > 0) {
          setSavedKeywords(res.data.keywords);
          setMainKeyword(res.data.main_keyword || "");
          if (!keyword) setKeyword(res.data.keywords[0]);
        } else {
          setSavedKeywords([]);
          setMainKeyword("");
        }
      })
      .catch(() => { setSavedKeywords([]); setMainKeyword(""); });
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
  /** 実際に競合比較で使われるメインKW。未指定なら先頭（competitor-fetch.ts と同じ規則） */
  const effectiveMainKeyword =
    mainKeyword && savedKeywords.includes(mainKeyword) ? mainKeyword : (savedKeywords[0] || "");

  const startMeasure = async () => {
    if (!isPresident) { alert("計測の実行は社長アカウントのみ可能です"); return; }
    if (!selectedShopId || !keyword.trim() || !shopLat) return;
    await runMeasureForKeyword(keyword.trim());
  };

  /** 1キーワードを5地点計測して保存する。単発・全KW一括の共通処理 */
  const runMeasureForKeyword = async (kw: string) => {
    if (!selectedShopId || !kw.trim() || !shopLat) return;
    const keywordArg = kw.trim();
    setMeasuring(true);
    setError("");
    setAborted(false);
    abortRef.current = false;
    setSelectedHistory(null);

    const points = generate5Points(shopLat, shopLng, interval, angleDeg);
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
          keyword: keywordArg,
          lat: pt.lat,
          lng: pt.lng,
          interval, // キャッシュ格子幅の調整に使用
          // 1点目=店舗中心（place_id失効チェックのトリガーを兼ねる）
          center: i === 0,
        });
        pt.rank = res.data.rank || 0; // 0 = 圏外（バッチ計測と同じセンチネルに統一）
      } catch {
        pt.rank = 0;
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
          keyword: keywordArg,
          gridResults: points.map((p) => ({
            lat: p.lat,
            lng: p.lng,
            rank: p.rank,
            row: p.row,
            col: p.col,
          })),
          gridSize: GRID_SIZE_5POINT,
          interval,
        });
        fetchHistory();
      } catch {}
    }

    setProgress(`完了: ${completed}/${total} 地点`);
    setMeasuring(false);
  };

  /**
   * 選択中の店舗の全キーワードを順に計測する。
   * 「計測開始」は選択中の1KWだけなので、3KWある店舗で1件しか記録されず
   * 「計測されていない」と誤解される。単発と一括を選べるようにする。
   */
  const startMeasureAllKeywords = async () => {
    if (!isPresident) { alert("計測の実行は社長アカウントのみ可能です"); return; }
    if (!selectedShopId || savedKeywords.length === 0 || !shopLat) return;

    const cost = estimateCost(pointsPerShop(savedKeywords.length));
    if (!confirm(
      `${savedKeywords.length}件のキーワードを順に計測します。\n${savedKeywords.map((k, i) => `${i + 1}. ${k}`).join("\n")}\n\n`
      + `1KWにつき${POINTS_PER_KW}地点 × ${savedKeywords.length}KW = 計${pointsPerShop(savedKeywords.length)}地点\n`
      + `💰 place_id取得済みなら 約¥${cost.afterId.toLocaleString()}／未取得なら 最大 ¥${cost.max.toLocaleString()}\n`
      + `同月の再計測・共有キャッシュ分は¥0\n\nよろしいですか？`
    )) return;

    // 単発と同じくパスワード再確認を通す（お金がかかる操作のため）
    if (!(await gate(`${savedKeywords.length}キーワードの一括計測（API費用が発生します）`))) return;

    setAllKwProgress(`0/${savedKeywords.length}`);
    for (let i = 0; i < savedKeywords.length; i++) {
      if (abortRef.current) break;
      const kw = savedKeywords[i];
      setAllKwProgress(`${i + 1}/${savedKeywords.length}「${kw}」`);
      setKeyword(kw);
      // startMeasure は state の keyword を見るため、明示的に渡せる形で実行する
      await runMeasureForKeyword(kw);
    }
    setAllKwProgress("");
    fetchHistory();
  };

  // 履歴選択時にマップに表示
  const showHistory = (log: GridLog) => {
    setSelectedHistory(log);
    setKeyword(log.keyword);
    setGridResults(log.results);
    renderMarkers(log.results);
  };

  // グリッドテーブルを生成
  // 5地点計測(3×3の中心+四隅)のような疎グリッドがあるため、
  // サイズはrow/colの最大値から求め、欠けているセルはnullで埋めて列位置を揃える
  const gridTable = () => {
    if (gridResults.length === 0) return null;
    const size = Math.max(...gridResults.map((p) => Math.max(p.row, p.col))) + 1;
    const rows: (GridPoint | null)[][] = [];
    for (let r = 0; r < size; r++) {
      const row: (GridPoint | null)[] = [];
      for (let c = 0; c < size; c++) {
        row.push(gridResults.find((p) => p.row === r && p.col === c) ?? null);
      }
      rows.push(row);
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
      {PasswordGateModal}
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
                      {/* 計測は全店舗5地点（中心＋外周4点）に統一済み。旧プリセットのgrid_size(7等)は計測に使われないため常に5地点表記 */}
                      <span className="text-xs text-slate-400 flex-shrink-0">5地点</span>
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
                            disabled={!can(role, "DATA_OP")}
                            title={!can(role, "DATA_OP") ? PERMISSION_DENIED_HINT.DATA_OP : undefined}
                            className="w-full text-xs border rounded px-1.5 py-1 text-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed"
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
                          {/* 全地点圏外(avg_rank=null)を「平均-位」ではなく「圏外」と出す */}
                          <span className={`text-xs font-bold ${lm.avg_rank == null ? "text-slate-400" : lm.avg_rank <= 10 ? "text-emerald-600" : lm.avg_rank <= 20 ? "text-blue-600" : "text-orange-600"}`}>
                            {lm.avg_rank == null ? "圏外" : `平均${lm.avg_rank}位`}
                            {lm.avg_rank != null && lm.in_range != null && lm.in_range < lm.total && (
                              <span className="ml-1 font-normal text-orange-500">({lm.in_range}/{lm.total})</span>
                            )}
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
                      disabled={!can(role, "DATA_OP")}
                      title={!can(role, "DATA_OP") ? PERMISSION_DENIED_HINT.DATA_OP : undefined}
                      className="w-8 text-center text-xs text-red-400 hover:text-red-600 disabled:opacity-40 disabled:cursor-not-allowed">✕</button>
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
                    if (!isPresident) { alert("座標一括取得は社長アカウントのみ可能です"); return; }
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
                  disabled={!can(role, "PAID_OP") || coordSyncing || batchRunning}
                  title={!can(role, "PAID_OP") ? PERMISSION_DENIED_HINT.PAID_OP : undefined}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${coordSyncing ? "bg-slate-100 text-slate-400" : "bg-slate-100 text-blue-600 hover:bg-blue-50 border border-blue-200"}`}
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
                  disabled={!can(role, "DATA_OP") || kwSyncing || batchRunning}
                  title={!can(role, "DATA_OP") ? PERMISSION_DENIED_HINT.DATA_OP : undefined}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${kwSyncing ? "bg-slate-100 text-slate-400" : "bg-slate-100 text-purple-600 hover:bg-purple-50 border border-purple-200"}`}
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
                  if (!isPresident) { alert("一括計測の実行は社長アカウントのみ可能です"); return; }
                  if (batchRunning) return;
                  const unmeasuredPresets = presets.filter(p => !isMeasuredThisMonth(p.last_measurement?.measured_at));
                  if (unmeasuredPresets.length === 0) { alert("全店舗 今月計測済みです"); return; }
                  const noCoord = presets.filter(p => !p.has_coordinates).length;
                  const noKw = presets.filter(p => !p.keyword && !(p.all_keywords && p.all_keywords.length > 0)).length;
                  const steps = [];
                  if (noCoord > 0) steps.push(`座標取得(${noCoord}件)`);
                  if (noKw > 0) steps.push(`KW取得(${noKw}件)`);
                  steps.push(`計測(${unmeasuredPresets.length}/${presets.length}店舗 — 今月計測済みはスキップ)`);
                  // API費用目安（KW数はプリセットから正確に集計）
                  const totalPoints = unmeasuredPresets.reduce((sum, p) => {
                    const kwCount = (p.all_keywords && p.all_keywords.length > 0) ? p.all_keywords.length : 1;
                    return sum + pointsPerShop(kwCount);
                  }, 0);
                  const cost = estimateCost(totalPoints);
                  // 単価は place_id の有無で¥4.8/¥0.75と4倍以上違う。
                  // どちらの前提の金額なのかを明示しないと桁を読み違える
                  if (!confirm(`${steps.join(" → ")} を実行します。\n約${Math.ceil(unmeasuredPresets.length * 60 / 60)}分かかります。\n\n💰 API費用目安（${totalPoints / POINTS_PER_KW}KW・${totalPoints}地点）:\n　　place_id未取得の店舗なら 最大 ¥${cost.max.toLocaleString()}（単価¥4.8・全地点圏外の上限）\n　　place_id取得済みなら 約¥${cost.afterId.toLocaleString()}（単価¥0.75）\n　　同月の再計測・共有キャッシュ分は¥0\n\nよろしいですか？`)) return;

                  // 追加ロック: お金がかかる操作のためログインパスワードを再確認
                  if (!(await gate("多地点順位計測の一括計測（API費用が発生します）"))) return;

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
                      let shopInterval = DEFAULT_INTERVAL;
                      let shopAngle = DEFAULT_ANGLE;
                      try {
                        const { data: coordRow } = await supabase.from("shops").select("gbp_latitude, gbp_longitude, grid_interval_m, grid_angle_deg").eq("name", p.shop_name).not("gbp_latitude", "is", null).gt("gbp_latitude", 0).limit(1).maybeSingle();
                        if (coordRow) {
                          lat = coordRow.gbp_latitude || 0;
                          lng = coordRow.gbp_longitude || 0;
                          shopInterval = coordRow.grid_interval_m || DEFAULT_INTERVAL;
                          shopAngle = coordRow.grid_angle_deg || DEFAULT_ANGLE;
                        }
                      } catch {}
                      if (!lat || !lng) { skipped++; continue; }

                      const keywords = p.all_keywords && p.all_keywords.length > 0
                        ? p.all_keywords
                        : (p.keyword ? [p.keyword] : []);
                      if (keywords.length === 0) { skipped++; continue; }

                      // 全KW共通: 店舗設定の距離・向きで5地点計測（中心＋外周4点。メイン/サブの区別なし）
                      for (let ki = 0; ki < keywords.length; ki++) {
                        const kw = keywords[ki];
                        const points = generate5Points(lat, lng, shopInterval, shopAngle);
                        for (let j = 0; j < points.length; j++) {
                          const pt = points[j];
                          setBatchProgress(`${i + 1}/${targetPresets.length} ${p.shop_name} [KW ${ki + 1}/${keywords.length} 5地点] (${j + 1}/${points.length})`);
                          window.dispatchEvent(new Event("batch-activity"));
                          let res: any = null;
                          try {
                            for (let retry = 0; retry < 3; retry++) {
                              try {
                                res = await api.post("/api/report/grid-ranking", {
                                  shopId: p.shop_id, keyword: kw, lat: pt.lat, lng: pt.lng,
                                  interval: shopInterval,
                                  // 1点目=店舗中心（place_id失効チェックのトリガーを兼ねる）
                                  center: j === 0,
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
                          // キャッシュ命中(¥0)時は待機を短縮（一括の再実行を高速化）
                          await new Promise(r => setTimeout(r, res?.data?.cached ? 50 : 1000));
                        }

                        await api.put("/api/report/grid-ranking", {
                          shopId: p.shop_id, keyword: kw, gridResults: points, gridSize: GRID_SIZE_5POINT, interval: shopInterval,
                        });
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
                disabled={!can(role, "PAID_OP") || batchRunning || presets.filter(p => !isMeasuredThisMonth(p.last_measurement?.measured_at)).length === 0}
                title={!can(role, "PAID_OP") ? PERMISSION_DENIED_HINT.PAID_OP : undefined}
                className={`w-full py-3.5 rounded-lg text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${batchRunning ? "bg-slate-200 text-slate-500" : presets.filter(p => !isMeasuredThisMonth(p.last_measurement?.measured_at)).length === 0 ? "bg-slate-200 text-slate-500 cursor-not-allowed" : "bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm"}`}
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
            const remaining = (shops || []).filter(s => !presetIds.has(s.id) && !rankDisabledIds.has(s.id));
            return <span className="text-xs text-slate-500">{remaining.length}店舗</span>;
          })()}
        </div>

        {showAllShopsPanel && (() => {
          const presetIds = new Set(presets.map(p => p.shop_id));
          // 順位計測の対象外（エミナル等）も必ず除く。ここを除かないと
          // 対象外店舗ぶんの座標取得・KW取得・実測が走って課金が発生する
          const allShopsFiltered = (shops || []).filter(s => !presetIds.has(s.id) && !rankDisabledIds.has(s.id));

          return (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">
                いつもの店舗（{presets.length}件）
                {rankDisabledIds.size > 0 && <>と計測対象外（{rankDisabledIds.size}件）</>}
                を除く全{allShopsFiltered.length}店舗に対して座標取得・KW取得・計測を実行します。
              </p>

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
                  disabled={!can(role, "PAID_OP") || allShopsCoordSyncing || allShopsBatchRunning}
                  title={!can(role, "PAID_OP") ? PERMISSION_DENIED_HINT.PAID_OP : undefined}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${allShopsCoordSyncing ? "bg-slate-100 text-slate-400" : "bg-slate-100 text-blue-600 hover:bg-blue-50 border border-blue-200"}`}
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
                  disabled={!can(role, "DATA_OP") || allShopsKwSyncing || allShopsBatchRunning}
                  title={!can(role, "DATA_OP") ? PERMISSION_DENIED_HINT.DATA_OP : undefined}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${allShopsKwSyncing ? "bg-slate-100 text-slate-400" : "bg-slate-100 text-purple-600 hover:bg-purple-50 border border-purple-200"}`}
                >
                  {allShopsKwSyncing ? "KW取得中..." : `KW一括取得（${allShopsFiltered.length}店舗）`}
                </button>

                {/* place_id一括取得（SKU竹→梅移行。単価¥4.8→¥0.75の前提整備） */}
                <button
                  onClick={async () => {
                    if (placeIdSyncing) return;
                    if (!isPresident) { alert("place_id一括取得は社長アカウントのみ可能です"); return; }
                    if (!confirm(
                      "未取得店舗のplace_id（Google店舗ID）を一括取得します。\n" +
                      "費用: 1店舗あたり約¥4.8（一度きり）。全店未取得なら合計約¥2,900。\n\n" +
                      "取得後は順位計測の単価が ¥4.8 → ¥0.75（▲84%）になります。\n" +
                      "店名・座標が曖昧な店舗は安全のためスキップして報告します。\n\nよろしいですか？"
                    )) return;
                    setPlaceIdSyncing(true);
                    let totalMatched = 0, totalSkipped = 0, cursor = "";
                    const skippedNames: string[] = [];
                    try {
                      for (let guard = 0; guard < 100; guard++) {
                        setPlaceIdResult(`place_id取得中... 取得${totalMatched}件 / スキップ${totalSkipped}件`);
                        window.dispatchEvent(new Event("batch-activity"));
                        const res = await api.post("/api/report/place-id-backfill", { limit: 15, afterName: cursor }, { timeout: 60000 });
                        const d = res.data || {};
                        totalMatched += d.matched || 0;
                        totalSkipped += d.skipped || 0;
                        for (const item of (d.details || [])) {
                          if (item.status === "skipped") skippedNames.push(`${item.name}（${item.reason}）`);
                        }
                        if (!d.processed || !d.lastName) break;
                        cursor = d.lastName;
                      }
                      setPlaceIdResult(`✓ ID取得${totalMatched}件 / スキップ${totalSkipped}件${skippedNames.length > 0 ? ` — スキップ: ${skippedNames.slice(0, 5).join("、")}${skippedNames.length > 5 ? ` 他${skippedNames.length - 5}件` : ""}` : ""}`);
                    } catch (e: any) {
                      setPlaceIdResult(`エラー: ${e?.message || "不明"}（取得済み${totalMatched}件は保存されています）`);
                    } finally { setPlaceIdSyncing(false); }
                  }}
                  disabled={!can(role, "PAID_OP") || placeIdSyncing || allShopsBatchRunning}
                  title={!can(role, "PAID_OP") ? PERMISSION_DENIED_HINT.PAID_OP : "順位計測の単価を¥4.8→¥0.75にするためのID一括取得（一度きり・約¥2,900）"}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${placeIdSyncing ? "bg-slate-100 text-slate-400" : "bg-slate-100 text-emerald-600 hover:bg-emerald-50 border border-emerald-200"}`}
                >
                  {placeIdSyncing ? "place_id取得中..." : "place_id一括取得（単価▲84%化）"}
                </button>
              </div>

              {/* ステータス表示 */}
              {(allShopsCoordResult || allShopsKwResult || placeIdResult) && (
                <div className="flex gap-3 text-xs flex-wrap">
                  {allShopsCoordResult && <span className={allShopsCoordResult.includes("エラー") ? "text-red-500" : "text-blue-500"}>{allShopsCoordResult}</span>}
                  {allShopsKwResult && <span className={allShopsKwResult.includes("見つからず") ? "text-orange-500" : "text-purple-500"}>{allShopsKwResult}</span>}
                  {placeIdResult && <span className={placeIdResult.includes("エラー") ? "text-red-500" : "text-emerald-600"}>{placeIdResult}</span>}
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
              {gridStats && (
                <div className="flex items-center justify-between">
                  {gridStats.lastMeasuredAt && (
                    <p className="text-xs text-slate-400">最終計測: {new Date(gridStats.lastMeasuredAt).toLocaleString("ja-JP")}</p>
                  )}
                  <div className="flex items-center gap-2">
                    <select
                      id="csv-month"
                      defaultValue={`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`}
                      className="text-xs border border-slate-200 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-[#003D6B]/30"
                    >
                      {Array.from({ length: 12 }, (_, i) => {
                        const d = new Date(new Date().getFullYear(), new Date().getMonth() - i, 1);
                        const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
                        return <option key={val} value={val}>{d.getFullYear()}年{d.getMonth() + 1}月</option>;
                      })}
                    </select>
                    <button
                      onClick={async () => {
                        try {
                          const sel = (document.getElementById("csv-month") as HTMLSelectElement).value;
                          const res = await api.get(`/api/report/grid-export?month=${sel}`, { responseType: "blob" });
                          const url = URL.createObjectURL(res.data);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `grid_ranking_${sel}.csv`;
                          a.click();
                          URL.revokeObjectURL(url);
                        } catch { alert("CSVダウンロードに失敗しました"); }
                      }}
                      className="text-xs text-[#003D6B] hover:text-[#002a4d] underline underline-offset-2 whitespace-nowrap"
                    >
                      CSVダウンロード
                    </button>
                  </div>
                </div>
              )}

              {/* 全店舗一括計測ボタン */}
              <button
                onClick={async () => {
                  if (!isPresident) { alert("全店舗計測の実行は社長アカウントのみ可能です"); return; }
                  if (allShopsBatchRunning) return;
                  // API費用目安。実データ（設定済みKW数・place_idの有無）から算出した
                  // gridStats.cost を優先する。以前は「1店舗6KW想定・全店Pro単価」の
                  // 固定計算で、place_id移行後の実態と大きくズレた金額が出ていた
                  const real = gridStats?.cost;
                  const costLines = real
                    ? `💰 API費用目安（実データから算出）:\n`
                      + `　　対象 ${real.billableShops}店舗 / ${real.totalKeywords}KW（座標・KWが揃っているもの）\n`
                      + `　　最大 ¥${real.max.toLocaleString()}（全地点が圏外の上限）\n`
                      + `　　通常 ¥${real.typical.toLocaleString()}程度／今月計測済み・共有キャッシュ分は¥0`
                      + (real.withoutPlaceId > 0 ? `\n　　※place_id未取得${real.withoutPlaceId}店舗は単価¥4.8（他は¥0.75）` : "")
                    : `💰 API費用目安: 算出できませんでした（統計の読み込み待ち）`;
                  if (!confirm(`全${allShopsFiltered.length}店舗（いつもの店舗を除く）を計測します。\n今月計測済みの店舗は自動スキップします。\n座標・KW未取得の店舗は自動取得します。\n約${Math.ceil(allShopsFiltered.length * 60 / 60)}分かかります。\n\n${costLines}\n\nよろしいですか？`)) return;

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
                      // 座標＋店舗別計測設定（距離・向き）を取得
                      const { data: coordRow } = await supabase.from("shops").select("gbp_latitude, gbp_longitude, grid_interval_m, grid_angle_deg").eq("name", s.name || s.id).not("gbp_latitude", "is", null).gt("gbp_latitude", 0).limit(1).maybeSingle();
                      if (!coordRow?.gbp_latitude) { skipped++; continue; }
                      const lat = coordRow.gbp_latitude;
                      const lng = coordRow.gbp_longitude;
                      const shopInterval = coordRow.grid_interval_m || DEFAULT_INTERVAL;
                      const shopAngle = coordRow.grid_angle_deg || DEFAULT_ANGLE;

                      // KW取得
                      const kwRes = await supabase.from("shop_keywords").select("keywords").eq("shop_id", s.id).maybeSingle();
                      const keywords: string[] = kwRes?.data?.keywords || [];
                      if (keywords.length === 0) { skipped++; continue; }

                      // 全KW共通: 店舗設定の距離・向きで5地点計測（中心＋外周4点。メイン/サブの区別なし）
                      for (let ki = 0; ki < keywords.length; ki++) {
                        const kw = keywords[ki];
                        const points = generate5Points(lat, lng, shopInterval, shopAngle);
                        for (let j = 0; j < points.length; j++) {
                          const pt = points[j];
                          setAllShopsBatchProgress(`${i + 1}/${allTargetShops.length} ${shopName} [KW ${ki + 1}/${keywords.length} 5地点] (${j + 1}/${points.length})`);
                          window.dispatchEvent(new Event("batch-activity"));
                          let res: any = null;
                          try {
                            for (let retry = 0; retry < 3; retry++) {
                              try {
                                res = await api.post("/api/report/grid-ranking", {
                                  shopId: s.id, keyword: kw, lat: pt.lat, lng: pt.lng,
                                  interval: shopInterval,
                                  // 1点目=店舗中心（place_id失効チェックのトリガーを兼ねる）
                                  center: j === 0,
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
                          // キャッシュ命中(¥0)時は待機を短縮（一括の再実行を高速化）
                          await new Promise(r => setTimeout(r, res?.data?.cached ? 50 : 1000));
                        }

                        await api.put("/api/report/grid-ranking", {
                          shopId: s.id, keyword: kw, gridResults: points, gridSize: GRID_SIZE_5POINT, interval: shopInterval,
                        });
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
                  refreshShopStatus();
                }}
                disabled={!can(role, "PAID_OP") || allShopsBatchRunning}
                title={!can(role, "PAID_OP") ? PERMISSION_DENIED_HINT.PAID_OP : undefined}
                className={`w-full py-3.5 rounded-lg text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${allShopsBatchRunning ? "bg-slate-200 text-slate-500" : "bg-orange-500 text-white hover:bg-orange-600 shadow-sm"}`}
              >
                {allShopsBatchRunning ? allShopsBatchProgress : `未計測のみ一括計測（${allShopsFiltered.length}店舗 — いつもの店舗を除く）`}
              </button>

              {/* 押す前に費用が分かるようにする（実データのKW数とplace_id有無から算出） */}
              {gridStats?.cost && gridStats.cost.billableShops > 0 && (
                <div className="border border-amber-200 bg-amber-50/60 rounded-lg px-3 py-2 text-[11px] text-slate-600">
                  <p className="font-semibold text-amber-800 mb-1">
                    想定費用: 最大 ¥{gridStats.cost.max.toLocaleString()}
                    <span className="font-normal text-slate-500">（通常 ¥{gridStats.cost.typical.toLocaleString()} 程度）</span>
                  </p>
                  <p>
                    計測が走るのは{gridStats.cost.billableShops}店舗・{gridStats.cost.totalKeywords}KW（座標とKWが揃っているもの）。
                    1KWにつき5地点、1地点1〜4リクエスト。
                    {gridStats.cost.withoutPlaceId > 0 && (
                      <>単価はplace_idありが¥0.75、なし{gridStats.cost.withoutPlaceId}店舗が¥4.8。</>
                    )}
                  </p>
                  <p className="text-slate-400 mt-0.5">
                    最大は全地点が圏外で4ページ使い切った場合。順位が見つかれば途中で打ち切られ、同月内の再計測と共有キャッシュ命中は¥0。
                  </p>
                </div>
              )}
              {allShopsBatchProgress && !allShopsBatchRunning && allShopsBatchProgress.startsWith("✓") && (
                <p className="text-sm text-emerald-600 font-medium text-center">{allShopsBatchProgress}</p>
              )}

              {/* KW未取得一覧 */}
              {/* 計測状況の一覧。数字だけでは「どの店舗が計測できていないか」が分からない */}
              {shopStatus.length > 0 && (
                <div className="mt-4 border border-slate-200 rounded-lg">
                  <div className="px-4 py-2.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      {([
                        ["unmeasured", `未計測 (${shopStatus.filter(s => !s.measured).length})`],
                        ["measured", `計測済み (${shopStatus.filter(s => s.measured).length})`],
                        ["all", `すべて (${shopStatus.length})`],
                      ] as ["unmeasured" | "measured" | "all", string][]).map(([val, label]) => (
                        <button key={val} onClick={() => setStatusTab(val)}
                          className={`px-2.5 py-1 rounded text-[11px] font-semibold ${statusTab === val ? "bg-[#003D6B] text-white" : "bg-slate-50 text-slate-500 hover:bg-slate-100"}`}>
                          {label}
                        </button>
                      ))}
                    </div>
                    <input value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
                      placeholder="店舗名で絞り込み"
                      className="px-2 py-1 border border-slate-200 rounded text-xs w-44" />
                  </div>
                  <div className="max-h-72 overflow-y-auto divide-y divide-slate-50">
                    {shopStatus
                      .filter(s => statusTab === "all" || (statusTab === "measured" ? s.measured : !s.measured))
                      .filter(s => !statusFilter || s.name.toLowerCase().includes(statusFilter.toLowerCase()))
                      .map(s => (
                        <div key={s.id} className="px-4 py-1.5 text-xs flex items-center justify-between gap-3">
                          <span className="text-slate-700 truncate">{s.name}</span>
                          <span className="flex items-center gap-2 flex-shrink-0 text-[10px]">
                            <span className="text-slate-400">{s.keywordCount}KW</span>
                            {s.measured ? (
                              <span className="text-emerald-600">
                                ✓ {s.lastMeasuredAt ? new Date(s.lastMeasuredAt).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" }) : ""}
                              </span>
                            ) : (
                              s.reasons.map(r => (
                                <span key={r} className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">{r}</span>
                              ))
                            )}
                          </span>
                        </div>
                      ))}
                    {shopStatus
                      .filter(s => statusTab === "all" || (statusTab === "measured" ? s.measured : !s.measured))
                      .filter(s => !statusFilter || s.name.toLowerCase().includes(statusFilter.toLowerCase()))
                      .length === 0 && (
                      <p className="px-4 py-6 text-xs text-slate-400 text-center">該当する店舗はありません</p>
                    )}
                  </div>
                </div>
              )}

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
                  <option key={kw} value={kw}>
                    {kw}{kw === effectiveMainKeyword ? "（メイン）" : ""}
                  </option>
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
            <div className="mt-2 flex flex-wrap gap-2 items-center">
              <button
                onClick={fetchFromSheet}
                disabled={!can(role, "DATA_OP") || sheetLoading || measuring}
                title={!can(role, "DATA_OP") ? PERMISSION_DENIED_HINT.DATA_OP : undefined}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {sheetLoading ? "取得中..." : "シートから反映"}
              </button>
              {/* メインKW: 競合比較（レポート）が使う1キーワード。
                  未指定だと並び順の先頭が黙って使われるため明示できるようにする */}
              {savedKeywords.length > 0 && keyword !== effectiveMainKeyword && (
                <button
                  onClick={async () => {
                    if (!selectedShopId) return;
                    setSavingMainKw(true);
                    try {
                      await api.put("/api/report/shop-keywords", { shopId: selectedShopId, mainKeyword: keyword });
                      setMainKeyword(keyword);
                    } catch (e: any) {
                      setError(e?.response?.data?.error || "メインKWの保存に失敗しました");
                    } finally { setSavingMainKw(false); }
                  }}
                  disabled={!can(role, "DATA_OP") || savingMainKw || measuring}
                  title="口コミの競合比較で使うキーワードに設定します"
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-50 transition"
                >
                  {savingMainKw ? "設定中..." : "★ このKWをメインにする"}
                </button>
              )}
            </div>
            {savedKeywords.length > 0 && (
              <p className="mt-1.5 text-[11px] text-slate-400">
                メインKW: <span className="text-slate-600 font-semibold">{effectiveMainKeyword || "未設定"}</span>
                {!mainKeyword && savedKeywords.length > 0 && <>（未指定のため先頭を使用中）</>}
                <br />口コミの競合比較はこのキーワードで検索します。
              </p>
            )}
          </div>

          {/* 距離（店舗中心から各計測地点まで。店舗ごとに保存） */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              距離（店舗中心から外周4地点まで）{intervalSaving && <span className="ml-2 text-xs text-gray-400">保存中...</span>}
            </label>
            <div className="flex gap-2 flex-wrap">
              {INTERVALS.map((iv) => (
                <button
                  key={iv.value}
                  onClick={() => changeInterval(iv.value)}
                  disabled={measuring || !can(role, "DATA_OP")}
                  title={!can(role, "DATA_OP") ? PERMISSION_DENIED_HINT.DATA_OP : undefined}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed ${
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

          {/* 向き（4点の回転角。店舗ごとに保存） */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              向き（外周4地点の回転）
            </label>
            <div className="flex gap-2 flex-wrap">
              {ANGLES.map((a) => (
                <button
                  key={a}
                  onClick={() => changeAngle(a)}
                  disabled={measuring || !can(role, "DATA_OP")}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed ${
                    angleDeg === a
                      ? "bg-[#003D6B] text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                  title={!can(role, "DATA_OP") ? PERMISSION_DENIED_HINT.DATA_OP : a === 0 ? "斜め（NE/NW/SE/SW）" : a === 45 ? "十字（N/E/S/W）" : `${a}度回転`}
                >
                  {a === 0 ? "斜め" : a === 45 ? "十字" : `${a}°`}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-gray-400">
              距離・向きは店舗ごとに保存され、一括計測でも使用されます。
              ※15度単位の差が計測に反映されるのは距離3km以上が目安です（2km以下では斜め⇔十字の45度単位が有効）
            </p>
          </div>
        </div>

        {/* 店舗座標表示 */}
        {shopLat ? (
          <p className="text-xs text-gray-400">
            店舗座標: {shopLat.toFixed(6)}, {shopLng.toFixed(6)} ／
            計測地点: 店舗中心＋{interval >= 1000 ? `${interval / 1000}km` : `${interval}m`}の外周4地点=計5地点（{angleDeg === 0 ? "斜め" : angleDeg === 45 ? "十字" : `${angleDeg}度回転`}）
          </p>
        ) : (
          <div className="flex items-center gap-2">
            <p className="text-xs text-red-400">店舗にGBP座標が登録されていません</p>
            {selectedShopId && (
              <button
                onClick={async () => {
                  if (!isPresident) { alert("座標取得は社長アカウントのみ可能です"); return; }
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
                disabled={!can(role, "PAID_OP")}
                title={!can(role, "PAID_OP") ? PERMISSION_DENIED_HINT.PAID_OP : undefined}
                className="text-xs bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                GBPから自動取得
              </button>
            )}
          </div>
        )}

        {/* API費用目安（1KWあたりの単位費用。place_idの有無で単価が4倍以上違う） */}
        <p className="text-xs text-gray-400">
          💰 1KWあたりの目安（{POINTS_PER_KW}地点）: place_id未取得 最大 ¥
          {estimateCost(POINTS_PER_KW).max.toLocaleString()}（単価¥4.8） ／ place_id取得済み 約¥
          {estimateCost(POINTS_PER_KW).afterId.toLocaleString()}（単価¥0.75） ／ 同月の再計測 ¥0
        </p>

        {!isPresident && (
          <p className="text-xs text-orange-500 font-semibold">
            ⚠️ 計測・座標取得などAPI課金を伴う操作は社長アカウントのみ実行できます（結果の閲覧は可能）
          </p>
        )}

        {/* 実行ボタン */}
        <div className="flex gap-3 items-center">
          <button
            onClick={startMeasure}
            disabled={!can(role, "PAID_OP") || measuring || !keyword.trim() || !shopLat}
            title={!can(role, "PAID_OP") ? PERMISSION_DENIED_HINT.PAID_OP : undefined}
            className="bg-[#003D6B] text-white px-6 py-2.5 rounded-lg text-sm font-semibold hover:bg-[#00507A] disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {measuring ? "計測中..." : "このKWだけ計測"}
          </button>
          {/* 全KW一括。3KWある店舗で1件しか記録されず「計測されていない」と
              誤解されるため、単発と一括を選べるようにする */}
          {savedKeywords.length > 1 && (
            <button
              onClick={startMeasureAllKeywords}
              disabled={!can(role, "PAID_OP") || measuring || !shopLat || !!allKwProgress}
              title={!can(role, "PAID_OP") ? PERMISSION_DENIED_HINT.PAID_OP : "この店舗の全キーワードを順に計測します"}
              className="bg-orange-500 text-white px-6 py-2.5 rounded-lg text-sm font-semibold hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {allKwProgress ? `一括計測中 ${allKwProgress}` : `全KW一括計測（${savedKeywords.length}件）`}
            </button>
          )}
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
              onClick={() => addToPreset(selectedShopId, (selectedShop as any).name || "", GRID_SIZE_5POINT)}
              disabled={!can(role, "DATA_OP") || addingPreset}
              title={!can(role, "DATA_OP") ? PERMISSION_DENIED_HINT.DATA_OP : undefined}
              className="bg-indigo-500 text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-indigo-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
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
                  圏内: {formatCoverage(summarizeGridRanks(displayResults))}地点 ／ 平均: {formatAvgRank(summarizeGridRanks(displayResults))}
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
                      {row.map((pt, ci) =>
                        pt === null ? (
                          // 5地点計測（3×3の中心+四隅）の未計測スロットは空セル
                          <td key={`empty-${ri}-${ci}`} className="w-12 h-12" />
                        ) : (
                        <td
                          key={`${pt.row}-${pt.col}`}
                          className={`w-12 h-12 text-center text-sm font-bold border ${rankBg(pt.rank)} ${
                            // 中心セル強調は奇数グリッド（5地点計測の中心=店舗位置・過去の7×7等）のみ
                            rows.length % 2 === 1 && pt.row === Math.floor(rows.length / 2) && pt.col === Math.floor(rows.length / 2)
                              ? "ring-2 ring-black ring-inset"
                              : ""
                          } ${pt.estimated ? "opacity-60" : ""}`}
                          title={`(${pt.lat.toFixed(4)}, ${pt.lng.toFixed(4)})${pt.estimated ? " [推定]" : ""}`}
                          style={pt.estimated ? { backgroundImage: "repeating-linear-gradient(135deg, transparent, transparent 3px, rgba(0,0,0,0.06) 3px, rgba(0,0,0,0.06) 4px)" } : undefined}
                        >
                          {pt.rank > 0 ? pt.rank : pt.rank === 0 ? "" : "-"}
                        </td>
                        )
                      )}
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
                <p className="text-xs text-gray-500">平均順位<span className="ml-1 text-[10px] text-gray-400">（圏内のみ）</span></p>
                <p className="text-xl font-bold text-[#003D6B]">{formatAvgRank(summarizeGridRanks(displayResults))}</p>
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
                  {/* 平均順位だけでは実態が分からないため圏内率を必ず併記する */}
                  <th className="text-left px-4 py-2">圏内</th>
                  <th className="text-left px-4 py-2">TOP3</th>
                  <th className="text-left px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((log) => {
                  const results = log.results || [];
                  const summary = summarizeGridRanks(results);
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
                      <td className="px-4 py-2.5">{gridLayoutLabel(log.grid_size, log.results?.length ?? 0)}</td>
                      <td className="px-4 py-2.5">
                        {log.interval_m >= 1000 ? `${log.interval_m / 1000}km` : `${log.interval_m}m`}
                      </td>
                      <td className={`px-4 py-2.5 font-semibold ${summary.avg == null ? "text-slate-400" : ""}`}>
                        {formatAvgRank(summary)}
                      </td>
                      <td className={`px-4 py-2.5 ${summary.inRange === 0 ? "text-slate-400" : summary.inRange < summary.total ? "text-orange-600" : "text-emerald-600"}`}>
                        {formatCoverage(summary)}
                      </td>
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
                          disabled={!can(role, "DATA_OP")}
                          title={!can(role, "DATA_OP") ? PERMISSION_DENIED_HINT.DATA_OP : undefined}
                          className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
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
