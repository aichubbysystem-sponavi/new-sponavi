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

  // 都市名→座標マッピング
  const CITY_COORDS: Record<string, { lat: number; lng: number }> = {
    tokyo: { lat: 35.6812, lng: 139.7671 }, osaka: { lat: 34.7024, lng: 135.4959 },
    fukuoka: { lat: 33.5902, lng: 130.4017 }, sapporo: { lat: 43.0687, lng: 141.3508 },
    nagoya: { lat: 35.1709, lng: 136.8815 }, yokohama: { lat: 35.4437, lng: 139.6380 },
    kobe: { lat: 34.6901, lng: 135.1956 }, kyoto: { lat: 34.9858, lng: 135.7588 },
    sendai: { lat: 38.2602, lng: 140.8824 }, hiroshima: { lat: 34.3963, lng: 132.4594 },
    naha: { lat: 26.2124, lng: 127.6792 },
  };

  for (const shop of shops) {
    // 1. ranking_search_settingsからKW取得
    let { data: settings } = await supabase
      .from("ranking_search_settings")
      .select("search_words, gbp_latitude, gbp_longitude")
      .eq("shop_id", shop.id)
      .limit(10);

    // 2. DB設定なし → スプレッドシートからKW+地点を取得してDBに保存
    if (!settings || settings.length === 0) {
      try {
        const SHEET_ID = "1JpehMxL2I-fgef1sckNaY8RIUDIknvmT2OqhHj0my1k";
        const tabName = encodeURIComponent(shop.gbp_shop_name || shop.name);
        const gvizUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${tabName}&range=A1:AT1`;
        const sheetRes = await fetch(gvizUrl, {
          headers: { "User-Agent": "Mozilla/5.0" }, redirect: "follow",
          signal: AbortSignal.timeout(8000),
        });
        if (sheetRes.ok) {
          const csv = await sheetRes.text();
          if (!csv.includes("<!DOCTYPE") && !csv.includes("<html")) {
            const cells = csv.split(",").map(c => c.replace(/^"|"$/g, "").trim());
            // KW列: R=17, S=18, T=19, U=20, V=21, W=22, AA=26, AB=27, AC=28, AD=29
            const kwIndices = [17, 18, 19, 20, 21, 22, 26, 27, 28, 29];
            const kws = kwIndices.map(i => cells[i] || "").filter(k => k && !k.includes("前月比"));
            // AR=43 地点, AS=44 緯度, AT=45 経度
            const arCell = (cells[43] || "").toLowerCase().trim();
            let lat = 35.68, lng = 139.77; // デフォルト東京
            if (arCell === "local") {
              lat = parseFloat(cells[44] || "") || 35.68;
              lng = parseFloat(cells[45] || "") || 139.77;
            } else if (CITY_COORDS[arCell]) {
              lat = CITY_COORDS[arCell].lat;
              lng = CITY_COORDS[arCell].lng;
            } else {
              // カンマ区切りの場合、最初の都市を使用
              const firstCity = arCell.split(",")[0]?.trim();
              if (firstCity && CITY_COORDS[firstCity]) {
                lat = CITY_COORDS[firstCity].lat;
                lng = CITY_COORDS[firstCity].lng;
              }
            }

            if (kws.length > 0) {
              // DBに保存（次回以降はDB参照で高速化）
              const newSettings: any[] = [];
              for (const kw of kws) {
                const entry = { shop_id: shop.id, search_words: JSON.stringify([kw]), gbp_latitude: lat, gbp_longitude: lng, is_display: true };
                await supabase.from("ranking_search_settings").upsert(entry, { onConflict: "shop_id,search_words" }).then(() => {});
                newSettings.push({ search_words: JSON.stringify([kw]), gbp_latitude: lat, gbp_longitude: lng });
              }
              settings = newSettings;
            }
          }
        }
      } catch {}
    }

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
