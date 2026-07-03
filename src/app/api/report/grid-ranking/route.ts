import { NextRequest, NextResponse } from "next/server";
import { getSupabase, verifyAuth, requireShopAccessById, verifyShopAccess } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const GCP_API_KEY = process.env.GCP_API_KEY || "";

// ===== 検索結果キャッシュ（コスト削減） =====
// 計測地点を全国共通の格子にスナップすることで、
// ①同月内の同一検索（同KW×同地点）はAPIを呼ばずキャッシュから返す
// ②近隣店舗同士が同じ格子点を共有し、1回の検索で複数店舗の順位を確定できる
// 格子幅 ≈ 1km（グリッド間隔と同等）。locationBias半径2000mに対しズレの影響は軽微
const LAT_STEP = 0.009; // ≈ 1000m
const LNG_STEP = 0.011; // ≈ 1000m（日本の緯度帯）

function snapCoord(v: number, step: number): string {
  return (Math.round(v / step) * step).toFixed(6);
}

// JSTの 'YYYY-MM'
function jstMonth(): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
}

// 順位順の店名リストから対象店舗の順位を返す（0 = 見つからない）
function findRank(places: string[], targetName: string): number {
  if (!targetName) return 0;
  for (let i = 0; i < places.length; i++) {
    const placeName = places[i] || "";
    if (!placeName) continue; // 空文字は .includes("") が常にtrueになるためスキップ
    if (
      placeName === targetName ||
      placeName.includes(targetName) ||
      targetName.includes(placeName)
    ) {
      return i + 1;
    }
  }
  return 0;
}

/**
 * POST /api/report/grid-ranking
 * 1地点×1キーワードの順位計測（最大100位まで5ページ検索）
 * 検索結果は grid_search_cache に月次保存し、同月の再計測はAPIを呼ばない
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { shopId, keyword, lat, lng } = body as {
    shopId: string;
    keyword: string;
    lat: number;
    lng: number;
  };

  if (!shopId || !keyword || !lat || !lng) {
    return NextResponse.json({ error: "shopId, keyword, lat, lngが必要です" }, { status: 400 });
  }

  const access = await requireShopAccessById(request, shopId);
  if (access.error) return access.error;

  if (!GCP_API_KEY) {
    return NextResponse.json({ error: "GCP_API_KEYが設定されていません" }, { status: 500 });
  }

  const supabase = getSupabase();
  const { data: shop } = await supabase
    .from("shops")
    .select("id, name, gbp_shop_name")
    .eq("id", shopId)
    .single();

  if (!shop) {
    return NextResponse.json({ error: "店舗が見つかりません" }, { status: 404 });
  }

  const targetName = shop.gbp_shop_name || shop.name;

  // プレイスID取得（列未作成でも壊れないよう別クエリで取得）
  // IDがある店舗はSKU Essentials(¥0.75/回)でID照合、無い店舗は従来のPro(¥4.8/回)で店名照合
  let shopPlaceId = "";
  {
    const { data: pidRow } = await supabase
      .from("shops")
      .select("gbp_place_id")
      .eq("id", shopId)
      .maybeSingle();
    shopPlaceId = (pidRow as any)?.gbp_place_id || "";
  }
  const useIdMode = !!shopPlaceId;

  // 計測地点を格子にスナップ（キャッシュキー＝実際の検索中心。一貫性を保つ）
  const latKey = snapCoord(lat, LAT_STEP);
  const lngKey = snapCoord(lng, LNG_STEP);
  const month = jstMonth();

  // ① キャッシュ照会: 同月×同KW×同格子点が計測済みならAPIを呼ばない
  try {
    const { data: cached } = await supabase
      .from("grid_search_cache")
      .select("*")
      .eq("keyword", keyword)
      .eq("lat_key", latKey)
      .eq("lng_key", lngKey)
      .eq("month", month)
      .maybeSingle();

    if (cached) {
      const cachedIds: string[] = Array.isArray((cached as any).place_ids) ? (cached as any).place_ids : [];
      const cachedNames: string[] = Array.isArray(cached.places) ? (cached.places as string[]) : [];

      // 照合できる材料がある場合のみキャッシュで判定する
      // （ID配列しか無い行を店名しか持たない店舗が引いた場合などは実測へ）
      let cachedRank = 0;
      let decidable = false;
      if (useIdMode && cachedIds.length > 0) {
        cachedRank = cachedIds.indexOf(shopPlaceId) + 1;
        decidable = true;
      } else if (cachedNames.length > 0) {
        cachedRank = findRank(cachedNames, targetName);
        decidable = true;
      }

      // 発見できた、または全ページ取得済みリスト（＝本当に圏外）ならキャッシュで確定
      if (decidable && (cachedRank > 0 || cached.complete)) {
        return NextResponse.json({ rank: cachedRank, shopName: targetName, cached: true });
      }
      // 不完全リストで未発見 → 下の実測にフォールバック（リストを完全版に更新）
    }
  } catch (e) {
    // キャッシュ障害時は実測にフォールバック（テーブル未作成等）
    console.error("[grid-ranking] cache read error:", e instanceof Error ? e.message : e);
  }

  try {
    let rank = 0;
    let pageToken: string | undefined;
    const allIds: string[] = [];   // 順位順のプレイスID（キャッシュ保存用）
    const allNames: string[] = []; // 順位順の店名（店名モード時のみ取得）
    let complete = false;

    // FieldMaskがSKU（単価）を決める:
    //  - places.id のみ → Text Search Essentials (IDs Only) ¥0.75/回
    //  - places.displayName を含む → Text Search Pro ¥4.8/回
    const fieldMask = useIdMode
      ? "places.id,nextPageToken"
      : "places.id,places.displayName,nextPageToken"; // Pro（従来と同額）。idを同時取得して次回からEssentialsに移行

    // 最大5ページ（100位）まで検索
    for (let page = 0; page < 5; page++) {
      const reqBody: any = {
        textQuery: keyword,
        languageCode: "ja",
        rankPreference: "RELEVANCE",
        locationBias: {
          circle: {
            center: { latitude: parseFloat(latKey), longitude: parseFloat(lngKey) },
            radius: 2000,
          },
        },
        pageSize: 20,
      };
      if (pageToken) reqBody.pageToken = pageToken;

      const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GCP_API_KEY,
          "X-Goog-FieldMask": fieldMask,
        },
        body: JSON.stringify(reqBody),
      });

      if (!res.ok) break;

      const data = await res.json();
      const places = data.places || [];
      for (const p of places) {
        allIds.push(p.id || "");
        if (!useIdMode) allNames.push(p.displayName?.text || "");
      }

      // このページが最終か（次ページなし or 5ページ=100位到達）
      const isLastPage = !data.nextPageToken || places.length === 0 || page === 4;
      if (isLastPage) complete = true; // 最後まで見た＝リスト完全

      rank = useIdMode ? allIds.indexOf(shopPlaceId) + 1 : findRank(allNames, targetName);
      if (rank > 0) break; // 発見したら打ち切り（未到達ページがあれば complete=false のまま）
      if (isLastPage) break;

      pageToken = data.nextPageToken;
    }

    // 店名モードで発見時: 完全一致ならプレイスIDを保存 → 次回からEssentials(¥0.75)に自動切替
    // （部分一致は別店舗の可能性があるため保存しない）
    if (!useIdMode && rank > 0) {
      const matchedId = allIds[rank - 1] || "";
      const matchedName = (allNames[rank - 1] || "").trim();
      if (matchedId && matchedName === targetName.trim()) {
        const { error: pidErr } = await supabase
          .from("shops")
          .update({ gbp_place_id: matchedId })
          .eq("id", shopId);
        if (pidErr) console.error("[grid-ranking] place_id save error:", pidErr.message);
      }
    }

    // ② 結果リスト全体を保存（次回以降・他店舗の照会をAPIゼロにする）
    if (allIds.length > 0) {
      const cacheRow: any = {
        keyword,
        lat_key: latKey,
        lng_key: lngKey,
        month,
        places: allNames, // IDモード時は空配列（古い店名と新しい順位の混在を防ぐ）
        place_ids: allIds,
        complete,
        updated_at: new Date().toISOString(),
      };
      const { error: upErr } = await supabase
        .from("grid_search_cache")
        .upsert(cacheRow, { onConflict: "keyword,lat_key,lng_key,month" });
      if (upErr) {
        // place_ids列が未作成の環境では列なしで再試行（旧スキーマ互換）
        delete cacheRow.place_ids;
        const { error: upErr2 } = await supabase
          .from("grid_search_cache")
          .upsert(cacheRow, { onConflict: "keyword,lat_key,lng_key,month" });
        if (upErr2) console.error("[grid-ranking] cache write error:", upErr2.message);
      }
    }

    return NextResponse.json({ rank, shopName: targetName });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "検索エラー" }, { status: 500 });
  }
}

/**
 * PUT /api/report/grid-ranking
 * グリッド計測結果を一括保存
 */
export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { shopId, keyword, gridResults, gridSize, interval } = body as {
    shopId: string;
    keyword: string;
    gridResults: { lat: number; lng: number; rank: number; row: number; col: number }[];
    gridSize: number;
    interval: number;
  };

  if (!shopId) return NextResponse.json({ error: "shopIdが必要です" }, { status: 400 });
  const accessPut = await requireShopAccessById(request, shopId);
  if (accessPut.error) return accessPut.error;

  const supabase = getSupabase();
  const { error: insertErr } = await supabase.from("grid_ranking_logs").insert({
    id: crypto.randomUUID(),
    shop_id: shopId,
    keyword,
    grid_size: gridSize,
    interval_m: interval,
    results: gridResults,
    measured_at: new Date().toISOString(),
  });

  if (insertErr) {
    return NextResponse.json({ success: false, error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

/**
 * GET /api/report/grid-ranking - 過去のグリッド計測結果を取得
 * ?shopId=xxx or ?shopName=xxx（デバッグ用: 店舗名からID逆引き）
 * ?debug=1 で全grid_ranking_logsのshop_id一覧を返す
 */
export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid || !auth.sub) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const supabase = getSupabase();

  let shopId = request.nextUrl.searchParams.get("shopId");
  const shopName = request.nextUrl.searchParams.get("shopName");

  if (!shopId && shopName) {
    const { data: shop } = await supabase.from("shops").select("id").eq("name", shopName).limit(1).maybeSingle();
    if (shop) shopId = shop.id;
    else return NextResponse.json({ error: "店舗が見つかりません", searchedName: shopName }, { status: 404 });
  }

  if (!shopId) {
    return NextResponse.json({ error: "shopIdまたはshopNameが必要です" }, { status: 400 });
  }

  // 認可チェック
  const accessGet = await requireShopAccessById(request, shopId);
  if (accessGet.error) return accessGet.error;

  const { data } = await supabase
    .from("grid_ranking_logs")
    .select("*")
    .eq("shop_id", shopId)
    .order("measured_at", { ascending: false })
    .limit(50);

  return NextResponse.json(data || []);
}

/**
 * DELETE /api/report/grid-ranking
 * 計測履歴を削除
 */
export async function DELETE(request: NextRequest) {
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid || !auth.sub) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = await request.json();
  const { id, shopId, keyword } = body as { id?: string; shopId?: string; keyword?: string };

  const supabase = getSupabase();

  if (id) {
    // idで削除する場合、ログからshop_idを取得して認可チェック
    const { data: log } = await supabase.from("grid_ranking_logs").select("shop_id").eq("id", id).maybeSingle();
    if (log?.shop_id) {
      const accessDel = await requireShopAccessById(request, log.shop_id);
      if (accessDel.error) return accessDel.error;
    }
    const { error } = await supabase.from("grid_ranking_logs").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  if (shopId && keyword) {
    const accessDel2 = await requireShopAccessById(request, shopId);
    if (accessDel2.error) return accessDel2.error;
    const { error, count } = await supabase.from("grid_ranking_logs").delete().eq("shop_id", shopId).eq("keyword", keyword);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, deleted: count });
  }

  return NextResponse.json({ error: "idまたはshopId+keywordが必要です" }, { status: 400 });
}
