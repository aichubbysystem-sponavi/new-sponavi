import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getOAuthToken } from "@/lib/gbp-token";
import { getLocationMap, resolveLocationName } from "@/lib/gbp-location";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_KEY);
}

/**
 * 店舗名でGBPロケーションを名前マッチング
 * - 完全一致 → 即返却
 * - 部分一致（店舗名がtitleに含まれる or titleが店舗名に含まれる）→ 最長一致を返却
 */
function matchShopToLocation(
  shopName: string,
  locationMap: Map<string, { fullPath: string; title: string }>
): { locName: string; fullPath: string; title: string } | null {
  if (!shopName) return null;

  const normalizedShopName = shopName.trim();

  // locationMap の全エントリからtitle付きのものを抽出
  // (mapにはlocName, fullPath, titleキーで重複登録されているので、fullPath形式のみ使う)
  const candidates: { locName: string; fullPath: string; title: string }[] = [];
  locationMap.forEach((val, key) => {
    // fullPath形式（accounts/xxx/locations/yyy）のエントリだけ使う（重複回避）
    if (key.startsWith("accounts/") && val.title) {
      // locName = locations/yyy 部分を抽出
      const locPart = key.replace(/^accounts\/[^/]+\//, "");
      candidates.push({ locName: locPart, fullPath: val.fullPath, title: val.title });
    }
  });

  // 1. 完全一致
  for (const c of candidates) {
    if (c.title === normalizedShopName) {
      return c;
    }
  }

  // 2. 部分一致（最長一致を優先）
  let bestMatch: typeof candidates[number] | null = null;
  let bestLen = 0;
  for (const c of candidates) {
    const t = c.title;
    if (normalizedShopName.includes(t) || t.includes(normalizedShopName)) {
      const matchLen = Math.min(normalizedShopName.length, t.length);
      if (matchLen > bestLen) {
        bestLen = matchLen;
        bestMatch = c;
      }
    }
  }

  return bestMatch;
}

/**
 * POST /api/report/sync-coordinates
 * GBP座標が未登録の全店舗に座標を自動設定
 * - gbp_location_name が NULL の店舗は店舗名で自動マッチングして紐付け
 * - Go APIのBusiness Information経由でlatlng取得
 * - shopId指定時はその店舗のみ
 */
export async function POST(request: NextRequest) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const targetShopId = body?.shopId;

  const supabase = getSupabase();

  // Go APIからトークン取得
  const accessToken = await getOAuthToken();
  if (!accessToken) {
    return NextResponse.json({ error: "OAuthトークンなし" }, { status: 500 });
  }

  // Go APIからロケーションマップを取得（名前マッチング + パス解決に使用）
  const locationMap = await getLocationMap();

  // ── Step 1: gbp_location_name が NULL の店舗を名前マッチングで紐付け ──
  let autoLinked = 0;
  const autoLinkDetails: { shop: string; matched: string; locName: string }[] = [];

  {
    let unmappedQuery = supabase
      .from("shops")
      .select("id, name, gbp_location_name")
      .is("gbp_location_name", null);

    if (targetShopId) {
      unmappedQuery = unmappedQuery.eq("id", targetShopId);
    }

    const { data: unmappedShops } = await unmappedQuery.limit(500);

    if (unmappedShops && unmappedShops.length > 0 && locationMap.size > 0) {
      for (const shop of unmappedShops) {
        const match = matchShopToLocation(shop.name, locationMap);
        if (match) {
          const { error } = await supabase
            .from("shops")
            .update({ gbp_location_name: match.locName })
            .eq("id", shop.id);
          if (!error) {
            autoLinked++;
            autoLinkDetails.push({
              shop: shop.name,
              matched: match.title,
              locName: match.locName,
            });
          }
        }
      }
    }
  }

  // ── Step 2: 座標取得対象の店舗を取得 ──
  // Places APIフォールバックがあるのでgbp_location_nameの有無を問わない
  let query = supabase
    .from("shops")
    .select("id, name, gbp_location_name, gbp_latitude, gbp_longitude, gbp_shop_name");

  if (targetShopId) {
    query = query.eq("id", targetShopId);
  } else {
    // gbp_latitude が null または 0 の店舗のみ
    query = query.or("gbp_latitude.is.null,gbp_latitude.eq.0");
  }

  const { data: shops } = await query.limit(100);
  if (!shops || shops.length === 0) {
    return NextResponse.json({
      message: "座標未設定の店舗なし",
      updated: 0,
      autoLinked,
      autoLinkDetails: autoLinkDetails.slice(0, 20),
    });
  }

  // ── Step 3: 座標取得（Business Information API → Places APIフォールバック） ──
  const GCP_API_KEY = process.env.GCP_API_KEY || "";
  let updated = 0;
  let errors = 0;
  const details: { shop: string; lat?: number; lng?: number; error?: string; method?: string }[] = [];

  for (const shop of shops) {
    let lat: number | null = null;
    let lng: number | null = null;
    let method = "";

    // 方法0: ロケーションマップに座標がキャッシュされている場合（GBP APIフォールバック時に取得済み）
    const shopTitle = (shop as any).gbp_shop_name || shop.name;
    const cachedByTitle = locationMap.get(shopTitle);
    const cachedByLoc = shop.gbp_location_name ? locationMap.get(shop.gbp_location_name) : null;
    const cached = cachedByLoc || cachedByTitle;
    if (cached?.lat && cached?.lng) {
      lat = cached.lat;
      lng = cached.lng;
      method = "GBP Map Cache";
    }

    // 方法1: Business Information APIで座標取得（gbp_location_nameがある場合）
    if (!lat) {
      const locName = shop.gbp_location_name;
      if (locName) {
        const fullPath = await resolveLocationName(locName);
        if (fullPath) {
          try {
            const url = `https://mybusinessbusinessinformation.googleapis.com/v1/${fullPath}?readMask=latlng`;
            const res = await fetch(url, {
              headers: { Authorization: `Bearer ${accessToken}` },
              signal: AbortSignal.timeout(10000),
            });
            if (res.ok) {
              const data = await res.json();
              lat = data?.latlng?.latitude || null;
              lng = data?.latlng?.longitude || null;
              if (lat && lng) method = "GBP API";
            }
          } catch {}
        }
      }
    }

    // 方法2: Google Places APIで店舗名+住所から座標取得（最終手段）
    // ※ 店舗名だけでは同名の別店舗にマッチする恐れがあるため、住所情報も含めて検索
    if (!lat && GCP_API_KEY) {
      try {
        // locationMapから住所のヒントを探す（マッチしたロケーションの近辺情報）
        const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": GCP_API_KEY,
            "X-Goog-FieldMask": "places.displayName,places.location,places.formattedAddress",
          },
          body: JSON.stringify({
            textQuery: shopTitle,
            languageCode: "ja",
            pageSize: 5,
          }),
          signal: AbortSignal.timeout(10000),
        });
        if (res.ok) {
          const data = await res.json();
          const places = data.places || [];
          // 完全一致のみ使用（同名別店舗の誤マッチ防止）
          const exactMatch = places.find((p: any) => {
            const name = p.displayName?.text || "";
            return name === shopTitle;
          });
          if (exactMatch?.location && places.length === 1) {
            // 検索結果が1件のみの場合は信頼できる
            lat = exactMatch.location.latitude;
            lng = exactMatch.location.longitude;
            method = "Places API (唯一)";
          } else if (exactMatch?.location && places.length > 1) {
            // 複数件ある場合はスキップ（間違った店舗の可能性）
            details.push({ shop: shop.name, error: `Places API: 同名${places.length}件ヒット（特定不可）` });
            errors++;
            continue;
          } else if (places.length === 1 && places[0]?.location) {
            lat = places[0].location.latitude;
            lng = places[0].location.longitude;
            method = "Places API (唯一)";
          } else {
            details.push({ shop: shop.name, error: places.length > 0 ? `Places API: ${places.length}件ヒット（特定不可）` : "Places API: 0件" });
            errors++;
            continue;
          }
        }
      } catch {}
    }

    if (lat && lng) {
      await supabase.from("shops").update({
        gbp_latitude: lat,
        gbp_longitude: lng,
      }).eq("id", shop.id);
      updated++;
      details.push({ shop: shop.name, lat, lng, method });
    } else {
      details.push({ shop: shop.name, error: "座標取得失敗" });
      errors++;
    }
  }

  return NextResponse.json({
    success: true,
    updated,
    errors,
    total: shops.length,
    autoLinked,
    autoLinkDetails: autoLinkDetails.slice(0, 20),
    details: details.slice(0, 20),
  });
}
