import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const GCP_API_KEY = process.env.GCP_API_KEY || "";

/**
 * POST /api/report/ranking-bulk
 * 指定店舗のKW設定を読み、順位計測を実行
 * body: { shopIds: string[] }（最大10店舗/リクエスト）
 */
export async function POST(request: NextRequest) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  if (!GCP_API_KEY) return NextResponse.json({ error: "GCP_API_KEY未設定" }, { status: 500 });

  const body = await request.json();
  const shopIds: string[] = (body.shopIds || []).slice(0, 10);
  if (shopIds.length === 0) return NextResponse.json({ error: "shopIdsが必要です" }, { status: 400 });

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // 店舗情報取得
  const { data: shops } = await supabase
    .from("shops").select("id, name, gbp_shop_name, gbp_location_name")
    .in("id", shopIds);

  if (!shops || shops.length === 0) {
    return NextResponse.json({ error: "店舗が見つかりません" }, { status: 404 });
  }

  // KW設定取得（スプレッドシートのKW or ranking_search_settings）
  const results: { shopName: string; measured: number; keywords: string[] }[] = [];

  for (const shop of shops) {
    // ranking_search_settingsからKW取得
    const { data: settings } = await supabase
      .from("ranking_search_settings")
      .select("search_words, gbp_latitude, gbp_longitude")
      .eq("shop_id", shop.id)
      .limit(10);

    if (!settings || settings.length === 0) {
      results.push({ shopName: shop.name, measured: 0, keywords: [] });
      continue;
    }

    let measured = 0;
    const keywords: string[] = [];

    for (const setting of settings) {
      let kw: string;
      try {
        const parsed = JSON.parse(setting.search_words);
        kw = Array.isArray(parsed) ? parsed.join(", ") : String(setting.search_words);
      } catch { kw = String(setting.search_words); }

      keywords.push(kw);

      // Google Places API Text Search
      try {
        const searchRes = await fetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": GCP_API_KEY,
            "X-Goog-FieldMask": "places.displayName,places.formattedAddress",
          },
          body: JSON.stringify({
            textQuery: kw,
            locationBias: {
              circle: {
                center: { latitude: setting.gbp_latitude || 35.68, longitude: setting.gbp_longitude || 139.76 },
                radius: 5000,
              },
            },
            maxResultCount: 20,
            languageCode: "ja",
          }),
          signal: AbortSignal.timeout(10000),
        });

        if (searchRes.ok) {
          const data = await searchRes.json();
          const places = data.places || [];
          const shopName = shop.gbp_shop_name || shop.name;
          const rank = places.findIndex((p: any) =>
            p.displayName?.text === shopName || p.displayName?.text?.includes(shopName) || shopName.includes(p.displayName?.text || "___")
          ) + 1;

          // DBに保存
          await supabase.from("ranking_search_logs").insert({
            id: crypto.randomUUID(),
            shop_id: shop.id,
            search_words: setting.search_words,
            rank: rank || 0,
            is_display: true,
            gbp_latitude: setting.gbp_latitude,
            gbp_longitude: setting.gbp_longitude,
            point_label: "一括計測",
            searched_at: new Date().toISOString(),
          });
          measured++;
        }
      } catch { /* continue */ }
    }

    results.push({ shopName: shop.name, measured, keywords });
  }

  const totalMeasured = results.reduce((s, r) => s + r.measured, 0);
  return NextResponse.json({ results, totalMeasured, totalShops: shops.length });
}
