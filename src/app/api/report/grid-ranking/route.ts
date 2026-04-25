import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const GCP_API_KEY = process.env.GCP_API_KEY || "";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
}

/**
 * POST /api/report/grid-ranking
 * 1地点×1キーワードの順位計測（最大100位まで5ページ検索）
 */
export async function POST(request: NextRequest) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

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

  try {
    let rank = 0;
    let pageToken: string | undefined;
    let position = 0;

    // 最大5ページ（100位）まで検索
    for (let page = 0; page < 5; page++) {
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
          "X-Goog-FieldMask": "places.displayName,nextPageToken",
        },
        body: JSON.stringify(reqBody),
      });

      if (!res.ok) break;

      const data = await res.json();
      const places = data.places || [];

      for (let i = 0; i < places.length; i++) {
        const placeName = places[i].displayName?.text || "";
        if (
          placeName === targetName ||
          placeName.includes(targetName) ||
          targetName.includes(placeName)
        ) {
          rank = position + i + 1;
          break;
        }
      }

      if (rank > 0) break;

      position += places.length;
      pageToken = data.nextPageToken;
      if (!pageToken || places.length === 0) break;
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
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = await request.json();
  const { shopId, keyword, gridResults, gridSize, interval } = body as {
    shopId: string;
    keyword: string;
    gridResults: { lat: number; lng: number; rank: number; row: number; col: number }[];
    gridSize: number;
    interval: number;
  };

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
 */
export async function GET(request: NextRequest) {
  const shopId = request.nextUrl.searchParams.get("shopId");
  if (!shopId) {
    return NextResponse.json({ error: "shopIdが必要です" }, { status: 400 });
  }

  const supabase = getSupabase();
  const { data } = await supabase
    .from("grid_ranking_logs")
    .select("*")
    .eq("shop_id", shopId)
    .order("measured_at", { ascending: false })
    .limit(50);

  return NextResponse.json(data || []);
}
