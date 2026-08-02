import { NextRequest, NextResponse } from "next/server";
import { getSupabase, verifyAuth, requireShopAccessById } from "@/lib/supabase";
import { withAudit, requireCtxShopAccessById } from "@/lib/audit";

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

// プレイスIDの失効確認と自動更新（Place Details IDのみ=無料SKU、追加費用ゼロ）
// 戻り値: 最新の有効ID（変化なし含む）／ null = 失効(404)につき shops をクリア済み
async function refreshPlaceId(supabase: any, shopId: string, currentId: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(currentId)}`,
      { headers: { "X-Goog-Api-Key": GCP_API_KEY, "X-Goog-FieldMask": "id" } }
    );
    if (res.ok) {
      const freshId = (await res.json())?.id || "";
      if (freshId && freshId !== currentId) {
        // IDが更新されていた → 保存して新IDを返す
        await supabase.from("shops").update({ gbp_place_id: freshId }).eq("id", shopId);
        return freshId;
      }
      return currentId; // 有効・変化なし
    }
    if (res.status === 404) {
      // 失効: クリアして次回計測時に店名モードで再取得させる
      await supabase.from("shops").update({ gbp_place_id: null }).eq("id", shopId);
      return null;
    }
  } catch (e) {
    console.error("[grid-ranking] place_id refresh error:", e instanceof Error ? e.message : e);
  }
  return currentId; // 一時エラー時は現状維持
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
 * 1地点×1キーワードの順位計測（最大80位まで4ページ検索）
 * 検索結果は grid_search_cache に月次保存し、同月の再計測はAPIを呼ばない
 */
export const POST = withAudit("多地点順位実測", "PAID_OP", async (request, ctx) => {
  const body = await request.json();
  const { shopId, keyword, lat, lng, interval, center } = body as {
    shopId: string;
    keyword: string;
    lat: number;
    lng: number;
    interval?: number; // 計測の距離間隔(m)。格子幅をこれに合わせる（未指定=1000m）
    center?: boolean;  // グリッド中心地点フラグ（ID失効チェック用）
  };

  if (!shopId || !keyword || !lat || !lng) {
    return NextResponse.json({ error: "shopId, keyword, lat, lngが必要です" }, { status: 400 });
  }

  const shopRes = await requireCtxShopAccessById(ctx, shopId);
  if (shopRes.error) return shopRes.error;

  ctx.detail = `${shopRes.shopName}: KW「${keyword}」${center ? "（中心地点）" : ""}`;

  if (!GCP_API_KEY) {
    return NextResponse.json({ error: "GCP_API_KEYが設定されていません" }, { status: 500 });
  }

  const supabase = getSupabase();
  const { data: shop } = await supabase
    .from("shops")
    .select("id, name, gbp_shop_name, rank_tracking_disabled")
    .eq("id", shopId)
    .single();

  if (!shop) {
    return NextResponse.json({ error: "店舗が見つかりません" }, { status: 404 });
  }

  // 課金が発生する直前の最後の砦。プリセット側で弾いていても、
  // 個別計測や古いプリセットから到達しうるためここでも止める
  if ((shop as any).rank_tracking_disabled) {
    return NextResponse.json(
      { error: `${shop.name} は順位計測の対象外に設定されています` },
      { status: 400 },
    );
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
  let useIdMode = !!shopPlaceId; // ID失効検知時に店名モードへ切替えるためlet

  // 計測地点を格子にスナップ（キャッシュキー＝実際の検索中心。一貫性を保つ）
  // 格子幅は距離間隔に比例させる: 500m間隔の計測で隣接地点が同一格子に潰れるのを防ぐ
  // （リクエスト数は間隔スケール前の従来仕様と同じ＝コスト増なし）
  //
  // 上限を1.0→0.5に変更（2026-08-02 距離500m刻み対応）:
  // 格子1kmのままだと、斜め配置の外周点は距離1km/1.5km/2kmで同一格子に丸まり、
  // 新設した500m刻みの選択肢が計測に反映されない（斜めの軸方向オフセット差=約354m/500m刻み）。
  // 格子500mなら隣接する刻みはほぼ区別される（例外: 斜めの2.5km⇔3kmは同一になる場合あり。UI注記済み）。
  // 変更時点で1km以上を設定した店舗はゼロのため、既存キャッシュキーへの影響なし
  const intervalM = Number(interval) || 1000;
  const gridFactor = Math.min(0.5, Math.max(0.25, intervalM / 1000));
  const latKey = snapCoord(lat, LAT_STEP * gridFactor);
  const lngKey = snapCoord(lng, LNG_STEP * gridFactor);
  const month = jstMonth();

  // ① キャッシュ照会: 同月×同KW×同格子点が計測済みならAPIを呼ばない
  let existingCache: any = null; // upsert時のcomplete行保護にも使う
  try {
    const { data: cached } = await supabase
      .from("grid_search_cache")
      .select("*")
      .eq("keyword", keyword)
      .eq("lat_key", latKey)
      .eq("lng_key", lngKey)
      .eq("month", month)
      .maybeSingle();
    existingCache = cached;

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
        // 【自己修復】IDモードで中心地点が圏外の場合、キャッシュ経路でもID失効を確認する
        // （近隣店舗の共有キャッシュが効いていると実測パスに到達せず、失効が放置されるため）
        if (useIdMode && cachedRank === 0 && center === true) {
          const freshId = await refreshPlaceId(supabase, shopId, shopPlaceId);
          if (freshId === null) {
            // 失効ID: 店名モードに切替えて下の実測へフォールバック（returnしない）
            shopPlaceId = "";
            useIdMode = false;
          } else if (freshId !== shopPlaceId) {
            // IDが更新されていた → キャッシュ済みリストと新IDで再照合
            shopPlaceId = freshId;
            return NextResponse.json({
              rank: cachedIds.indexOf(freshId) + 1,
              shopName: targetName,
              cached: true,
            });
          } else {
            return NextResponse.json({ rank: 0, shopName: targetName, cached: true }); // 本当に圏外
          }
        } else {
          return NextResponse.json({ rank: cachedRank, shopName: targetName, cached: true });
        }
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
    let apiError = false; // Places APIがエラーを返したページがあるか

    // FieldMaskがSKU（単価）を決める:
    //  - places.id のみ → Text Search Essentials (IDs Only) ¥0.75/回
    //  - places.displayName を含む → Text Search Pro ¥4.8/回
    const fieldMask = useIdMode
      ? "places.id,nextPageToken"
      : "places.id,places.displayName,nextPageToken"; // Pro（従来と同額）。idを同時取得して次回からEssentialsに移行

    // 最大4ページ（80位）まで検索（2026-07-31 コスト削減: 5ページ→4ページ）
    for (let page = 0; page < 4; page++) {
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

      if (!res.ok) {
        // 【失敗と圏外の区別】以前はここで break → rank=0 を正常応答として返していた。
        // APIエラー（キー制限・クォータ超過・障害）が「圏外」としてログに残り、
        // レポートに「49地点すべて圏外」という誤データが載る事故につながる。
        // エラーは必ずエラーとして返し、判定はしない。
        apiError = true;
        console.error("[grid-ranking] Places API error:", res.status, await res.text().catch(() => ""));
        break;
      }

      const data = await res.json();
      const places = data.places || [];
      for (const p of places) {
        allIds.push(p.id || "");
        if (!useIdMode) allNames.push(p.displayName?.text || "");
      }

      // このページが最終か（次ページなし or 4ページ=80位到達）
      const isLastPage = !data.nextPageToken || places.length === 0 || page === 3;
      if (isLastPage) complete = true; // 最後まで見た＝リスト完全

      rank = useIdMode ? allIds.indexOf(shopPlaceId) + 1 : findRank(allNames, targetName);
      if (rank > 0) break; // 発見したら打ち切り（未到達ページがあれば complete=false のまま）
      if (isLastPage) break;

      pageToken = data.nextPageToken;
    }

    // 【失敗と圏外の区別】発見できず、かつ最後まで検索しきれていない場合は
    // 「圏外」と断定できない。0を返すとログ・レポートに圏外として残るため、
    // 必ずエラーで返して呼び出し側に失敗と伝える（地点は再計測すればよい）
    if (rank === 0 && (apiError || !complete)) {
      return NextResponse.json(
        { error: "Places APIの検索に失敗しました。この地点は圏外ではなく計測失敗です。再計測してください", measurementFailed: true },
        { status: 502 },
      );
    }

    // 【IDの鮮度チェック】IDモードで中心地点すら圏外の場合、IDの失効を疑って確認する
    // （失効を放置すると「全地点圏外の誤レポート + 毎回4ページ全消費」が続く。無料SKUで自動回復）
    if (useIdMode && rank === 0 && center === true) {
      const freshId = await refreshPlaceId(supabase, shopId, shopPlaceId);
      if (freshId && freshId !== shopPlaceId) {
        // IDが更新されていた → 今回の検索結果と新IDで照合し直し
        rank = allIds.indexOf(freshId) + 1;
        shopPlaceId = freshId;
      }
      // freshId === 現ID なら本当に圏外（正常）／ null なら失効クリア済み（次回計測で店名モード再取得）
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
    // ただし「完全リスト」を「不完全リスト」で上書きしない
    // （早期打ち切りの短いリストが、別店舗が使う100件のcomplete行を潰すのを防ぐ）
    if (allIds.length > 0 && !(existingCache?.complete && !complete)) {
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
});

/**
 * PUT /api/report/grid-ranking
 * グリッド計測結果を一括保存
 */
export const PUT = withAudit("順位実測値保存", "DATA_OP", async (request, ctx) => {
  const body = await request.json();
  const { shopId, keyword, gridResults, gridSize, interval } = body as {
    shopId: string;
    keyword: string;
    gridResults: { lat: number; lng: number; rank: number; row: number; col: number }[];
    gridSize: number;
    interval: number;
  };

  if (!shopId) return NextResponse.json({ error: "shopIdが必要です" }, { status: 400 });
  const shopResPut = await requireCtxShopAccessById(ctx, shopId);
  if (shopResPut.error) return shopResPut.error;

  // 【入力の門番】このログはレポートにそのまま載る。検証なしで保存すると、
  // 不正な形のJSONや異常な順位（-5位・9999位・NaN座標）がクライアント向け
  // レポートを直接汚染する。形式が正しくないものは全部拒否する
  if (typeof keyword !== "string" || !keyword.trim() || keyword.length > 100) {
    return NextResponse.json({ error: "keywordが不正です" }, { status: 400 });
  }
  if (!Number.isInteger(gridSize) || gridSize < 1 || gridSize > 13) {
    return NextResponse.json({ error: "gridSizeが不正です（1〜13）" }, { status: 400 });
  }
  if (interval !== undefined && (!Number.isFinite(interval) || interval < 50 || interval > 10000)) {
    return NextResponse.json({ error: "intervalが不正です（50〜10000m）" }, { status: 400 });
  }
  if (!Array.isArray(gridResults) || gridResults.length === 0 || gridResults.length > 169) {
    return NextResponse.json({ error: "gridResultsが不正です（1〜169地点）" }, { status: 400 });
  }
  for (const p of gridResults) {
    const okPoint =
      p && typeof p === "object" &&
      Number.isFinite(p.lat) && p.lat >= -90 && p.lat <= 90 &&
      Number.isFinite(p.lng) && p.lng >= -180 && p.lng <= 180 &&
      Number.isInteger(p.rank) && p.rank >= 0 && p.rank <= 200 &&
      Number.isInteger(p.row) && p.row >= 0 && p.row < 13 &&
      Number.isInteger(p.col) && p.col >= 0 && p.col < 13;
    if (!okPoint) {
      return NextResponse.json({ error: "gridResultsに不正な地点があります（lat/lng/rank/row/colの型・範囲）" }, { status: 400 });
    }
  }
  // 余計なフィールドを持ち込ませない（保存する形をここで確定させる）
  const cleanResults = gridResults.map((p) => ({ lat: p.lat, lng: p.lng, rank: p.rank, row: p.row, col: p.col }));

  ctx.detail = `${shopResPut.shopName}: 「${keyword}」${gridSize}×${gridSize}グリッド ${cleanResults.length}地点を保存`;

  const supabase = getSupabase();
  const { error: insertErr } = await supabase.from("grid_ranking_logs").insert({
    id: crypto.randomUUID(),
    shop_id: shopId,
    keyword,
    grid_size: gridSize,
    interval_m: interval,
    results: cleanResults,
    measured_at: new Date().toISOString(),
  });

  if (insertErr) {
    return NextResponse.json({ success: false, error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
});

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
export const DELETE = withAudit("順位計測履歴削除", "DATA_OP", async (request, ctx) => {
  const body = await request.json();
  const { id, shopId, keyword } = body as { id?: string; shopId?: string; keyword?: string };

  const supabase = getSupabase();

  if (id) {
    // idで削除する場合、ログからshop_idを取得して認可チェック
    const { data: log } = await supabase.from("grid_ranking_logs").select("shop_id").eq("id", id).maybeSingle();
    if (log?.shop_id) {
      const shopResDel = await requireCtxShopAccessById(ctx, log.shop_id);
      if (shopResDel.error) return shopResDel.error;
      ctx.detail = `${shopResDel.shopName}: 計測履歴1件を削除（ID: ${id}）`;
    } else {
      ctx.detail = `計測履歴1件を削除（ID: ${id}）`;
    }
    const { error } = await supabase.from("grid_ranking_logs").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  if (shopId && keyword) {
    const shopResDel2 = await requireCtxShopAccessById(ctx, shopId);
    if (shopResDel2.error) return shopResDel2.error;
    const { error, count } = await supabase.from("grid_ranking_logs").delete().eq("shop_id", shopId).eq("keyword", keyword);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    ctx.detail = `${shopResDel2.shopName}: 「${keyword}」の計測履歴を削除（${count ?? 0}件）`;
    return NextResponse.json({ success: true, deleted: count });
  }

  return NextResponse.json({ error: "idまたはshopId+keywordが必要です" }, { status: 400 });
});
