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

  // ── Step 2: 座標未設定の店舗を取得（紐付け後に再取得） ──
  let query = supabase
    .from("shops")
    .select("id, name, gbp_location_name, gbp_latitude, gbp_longitude")
    .not("gbp_location_name", "is", null);

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

  // ── Step 3: Business Information APIで座標取得 ──
  let updated = 0;
  let errors = 0;
  const details: { shop: string; lat?: number; lng?: number; error?: string }[] = [];

  for (const shop of shops) {
    const locName = shop.gbp_location_name;
    if (!locName) continue;

    // resolveLocationName でフルパスに解決
    const fullPath = await resolveLocationName(locName);
    if (!fullPath) {
      details.push({ shop: shop.name, error: "ロケーションパス解決失敗" });
      errors++;
      continue;
    }

    // Business Information APIで座標取得
    try {
      const url = `https://mybusinessbusinessinformation.googleapis.com/v1/${fullPath}?readMask=latlng`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        details.push({ shop: shop.name, error: `HTTP ${res.status}` });
        errors++;
        continue;
      }

      const data = await res.json();
      const lat = data?.latlng?.latitude;
      const lng = data?.latlng?.longitude;

      if (lat && lng) {
        await supabase.from("shops").update({
          gbp_latitude: lat,
          gbp_longitude: lng,
        }).eq("id", shop.id);
        updated++;
        details.push({ shop: shop.name, lat, lng });
      } else {
        details.push({ shop: shop.name, error: "latlngなし" });
        errors++;
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      details.push({ shop: shop.name, error: msg });
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
