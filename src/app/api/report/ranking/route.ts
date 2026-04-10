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

/**
 * POST /api/report/ranking
 * 1ページ分（20件）を検索し、結果を返す
 * フロントエンドが最大5回ループして100位まで計測
 */
export async function POST(request: NextRequest) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = await request.json();
  const { shopId, keyword, pageToken, startPosition, lat: reqLat, lng: reqLng } = body as {
    shopId: string;
    keyword: string;
    pageToken?: string;
    startPosition?: number;
    lat?: number;
    lng?: number;
  };

  if (!shopId || !keyword) {
    return NextResponse.json({ error: "shopIdとkeywordが必要です" }, { status: 400 });
  }

  if (!GCP_API_KEY) {
    return NextResponse.json({ error: "GCP_API_KEYが設定されていません" }, { status: 500 });
  }

  const supabase = getSupabase();

  // 店舗情報取得
  const { data: shop } = await supabase
    .from("shops")
    .select("id, name, gbp_latitude, gbp_longitude, gbp_shop_name")
    .eq("id", shopId)
    .single();

  if (!shop) {
    return NextResponse.json({ error: "店舗が見つかりません" }, { status: 404 });
  }

  const lat = reqLat || shop.gbp_latitude || 35.6812;
  const lng = reqLng || shop.gbp_longitude || 139.7671;
  const targetName = shop.gbp_shop_name || shop.name;

  // Google Places API v1 検索
  try {
    const reqBody: any = {
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
    if (pageToken) reqBody.pageToken = pageToken;

    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GCP_API_KEY,
        "X-Goog-FieldMask": "places.displayName,places.formattedAddress,nextPageToken",
      },
      body: JSON.stringify(reqBody),
    });

    if (!res.ok) {
      return NextResponse.json({ error: `Places API error: ${res.status}` }, { status: 500 });
    }

    const data = await res.json();
    const places = data.places || [];
    const pos = startPosition || 0;
    let rank = 0;

    const matchNames: string[] = [];
    for (let i = 0; i < places.length; i++) {
      const placeName = places[i].displayName?.text || "";
      matchNames.push(placeName);
      // 完全一致 or 部分一致（店舗名を含む）
      if (placeName === targetName || placeName.includes(targetName) || targetName.includes(placeName)) {
        rank = pos + i + 1;
        break;
      }
    }

    return NextResponse.json({
      found: rank > 0,
      rank,
      nextPageToken: data.nextPageToken || null,
      nextPosition: pos + places.length,
      placesCount: places.length,
      shopName: targetName,
      topResults: matchNames.slice(0, 5),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "検索エラー" }, { status: 500 });
  }
}

/**
 * PUT /api/report/ranking
 * 計測結果をDBに保存（フロントエンドが全ページ検索完了後に呼ぶ）
 */
export async function PUT(request: NextRequest) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = await request.json();
  const { shopId, keyword, rank, lat, lng } = body;

  const supabase = getSupabase();
  const { error: insertErr } = await supabase.from("ranking_search_logs").insert({
    id: crypto.randomUUID(),
    shop_id: shopId,
    search_words: JSON.stringify([keyword]),
    searched_at: new Date().toISOString(),
    schedule_at: new Date().toISOString(),
    rank: rank || 0,
    gbp_latitude: lat || 0,
    gbp_longitude: lng || 0,
    radius: 2000,
    is_display: true,
  });
  if (insertErr) console.error("[ranking] Insert error:", insertErr.message);

  return NextResponse.json({ success: true });
}

/**
 * GET /api/report/ranking - 過去の計測結果を取得
 */
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
    .limit(500);

  return NextResponse.json(data || []);
}
