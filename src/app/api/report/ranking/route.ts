import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const GCP_API_KEY = process.env.GCP_API_KEY || "";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
}

interface PlaceResult {
  displayName?: { text?: string };
  formattedAddress?: string;
}

/**
 * Google Places API v1で検索し、店舗の順位を返す
 */
async function searchRank(
  keyword: string,
  shopName: string,
  lat: number,
  lng: number
): Promise<{ rank: number; totalResults: number }> {
  let rank = 0;
  let position = 0;
  let totalResults = 0;

  // 最大5ページ検索（約100件）
  for (let page = 0; page < 5; page++) {
    try {
      const body: any = {
        textQuery: keyword,
        languageCode: "ja",
        rankPreference: "RELEVANCE",
        locationBias: {
          circle: {
            center: { latitude: lat, longitude: lng },
            radius: 2000,
          },
        },
        pageSize: 20,
      };

      const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GCP_API_KEY,
          "X-Goog-FieldMask": "places.displayName,places.formattedAddress,nextPageToken",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        console.error("[ranking] Places API error:", res.status, res.statusText);
        break;
      }

      const data = await res.json();
      const places: PlaceResult[] = data.places || [];

      for (const place of places) {
        position++;
        totalResults++;
        if (place.displayName?.text === shopName) {
          rank = position;
          return { rank, totalResults };
        }
      }

      if (!data.nextPageToken) break;

      // 次ページ用にtokenを設定
      body.pageToken = data.nextPageToken;
    } catch (err) {
      console.error("[ranking] Search error:", err);
      break;
    }
  }

  return { rank, totalResults };
}

// POST /api/report/ranking
export async function POST(request: NextRequest) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = await request.json();
  const { shopId, keywords } = body as { shopId: string; keywords: string[] };

  if (!shopId || !keywords || keywords.length === 0) {
    return NextResponse.json({ error: "shopIdとkeywordsが必要です" }, { status: 400 });
  }

  if (!GCP_API_KEY) {
    return NextResponse.json({ error: "GCP_API_KEYが設定されていません" }, { status: 500 });
  }

  const supabase = getSupabase();

  // 店舗情報取得（座標）
  const { data: shop } = await supabase
    .from("shops")
    .select("id, name, gbp_latitude, gbp_longitude, gbp_shop_name")
    .eq("id", shopId)
    .single();

  if (!shop) {
    return NextResponse.json({ error: "店舗が見つかりません" }, { status: 404 });
  }

  // 座標がない場合はジオコーディングで代替
  const lat = shop.gbp_latitude || 35.6812;  // デフォルト: 東京
  const lng = shop.gbp_longitude || 139.7671;
  const targetName = shop.gbp_shop_name || shop.name;

  const results: { keyword: string; rank: number; totalResults: number }[] = [];

  for (const keyword of keywords) {
    const { rank, totalResults } = await searchRank(keyword, targetName, lat, lng);

    // DBに保存
    await supabase.from("ranking_search_logs").insert({
      shop_id: shopId,
      search_words: JSON.stringify([keyword]),
      searched_at: new Date().toISOString(),
      schedule_at: new Date().toISOString(),
      rank: rank || 0,
      gbp_latitude: lat,
      gbp_longitude: lng,
      radius: 2000,
      is_display: true,
    });

    results.push({ keyword, rank: rank || 0, totalResults });
  }

  return NextResponse.json({ success: true, shopName: targetName, results });
}

// GET /api/report/ranking - 過去の計測結果を取得
export async function GET(request: NextRequest) {
  const shopId = request.nextUrl.searchParams.get("shopId");
  if (!shopId) {
    return NextResponse.json({ error: "shopIdが必要です" }, { status: 400 });
  }

  const supabase = getSupabase();
  const { data } = await supabase
    .from("ranking_search_logs")
    .select("*")
    .eq("shop_id", shopId)
    .eq("is_display", true)
    .order("searched_at", { ascending: false })
    .limit(100);

  return NextResponse.json(data || []);
}
