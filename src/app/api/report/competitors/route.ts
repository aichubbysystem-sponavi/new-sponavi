import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const GCP_API_KEY = process.env.GCP_API_KEY || "";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
}

/**
 * POST /api/report/competitors
 * 指定店舗の周辺競合店舗をGoogle Places API (New)で検索
 */
export async function POST(request: NextRequest) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = await request.json();
  const { shopId } = body as { shopId: string };

  if (!shopId) {
    return NextResponse.json({ error: "shopIdが必要です" }, { status: 400 });
  }
  if (!GCP_API_KEY) {
    return NextResponse.json({ error: "GCP_API_KEYが設定されていません" }, { status: 500 });
  }

  const supabase = getSupabase();
  const { data: shop } = await supabase
    .from("shops")
    .select("id, name, gbp_latitude, gbp_longitude, gbp_shop_name, gbp_location_name")
    .eq("id", shopId)
    .single();

  if (!shop) {
    return NextResponse.json({ error: "店舗が見つかりません" }, { status: 404 });
  }

  const lat = shop.gbp_latitude || 35.6812;
  const lng = shop.gbp_longitude || 139.7671;

  // GBP locationからカテゴリ情報を取得
  let category = "";
  try {
    const locRes = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/api/shop/${shopId}/location`,
      { headers: { "Content-Type": "application/json" } }
    );
    if (locRes.ok) {
      const locData = await locRes.json();
      category = locData?.categories?.primaryCategory?.displayName || "";
    }
  } catch {}

  // 店舗名のキーワード部分 or カテゴリで検索
  const searchQuery = category || shop.name.replace(/[\s　]+/g, " ").split(" ").slice(-1)[0] || "店舗";

  try {
    const placesRes = await fetch(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GCP_API_KEY,
          "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.googleMapsUri,places.location,places.primaryTypeDisplayName",
        },
        body: JSON.stringify({
          textQuery: searchQuery,
          locationBias: {
            circle: { center: { latitude: lat, longitude: lng }, radius: 2000 },
          },
          maxResultCount: 20,
          languageCode: "ja",
        }),
      }
    );

    if (!placesRes.ok) {
      const errText = await placesRes.text();
      return NextResponse.json({ error: `Places API error: ${errText}` }, { status: 500 });
    }

    const placesData = await placesRes.json();
    const places = (placesData.places || []).map((p: any) => ({
      name: p.displayName?.text || "",
      address: p.formattedAddress || "",
      rating: p.rating || 0,
      reviewCount: p.userRatingCount || 0,
      mapsUrl: p.googleMapsUri || "",
      lat: p.location?.latitude,
      lng: p.location?.longitude,
      type: p.primaryTypeDisplayName?.text || "",
    }));

    // 自店を除外（名前の部分一致で判定）
    const shopNameNorm = (shop.gbp_shop_name || shop.name || "").replace(/\s+/g, "");
    const competitors = places.filter((p: any) => {
      const pNorm = p.name.replace(/\s+/g, "");
      return !pNorm.includes(shopNameNorm) && !shopNameNorm.includes(pNorm);
    });

    // 自店の情報を先頭に追加
    const myShop = places.find((p: any) => {
      const pNorm = p.name.replace(/\s+/g, "");
      return pNorm.includes(shopNameNorm) || shopNameNorm.includes(pNorm);
    });

    return NextResponse.json({
      myShop: myShop || { name: shop.name, rating: 0, reviewCount: 0 },
      competitors: competitors.slice(0, 10),
      searchQuery,
      searchArea: `半径2km`,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
