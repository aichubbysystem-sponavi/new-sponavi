import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getOAuthToken } from "@/lib/gbp-token";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const GO_API_URL = process.env.NEXT_PUBLIC_API_URL || "";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_KEY);
}

/**
 * POST /api/report/sync-coordinates
 * GBP座標が未登録の全店舗に座標を自動設定
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

  // 座標未設定の店舗を取得
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
    return NextResponse.json({ message: "座標未設定の店舗なし", updated: 0 });
  }

  // Go APIからアカウント一覧を取得（ロケーション→アカウントのマッピング用）
  let locationToAccount: Map<string, string> = new Map();
  try {
    const accRes = await fetch(`${GO_API_URL}/api/gbp/account`, {
      signal: AbortSignal.timeout(20000),
    });
    if (accRes.ok) {
      const accounts = await accRes.json();
      for (const acc of accounts || []) {
        const accName = acc.name || "";
        for (const loc of acc.locations || []) {
          locationToAccount.set(loc.name, accName);
        }
      }
    }
  } catch {}

  let updated = 0;
  let errors = 0;
  const details: any[] = [];

  for (const shop of shops) {
    const locName = shop.gbp_location_name;
    if (!locName) continue;

    // フルパスを構築（accounts/xxx/locations/yyy）
    let fullPath = locName;
    if (locName.startsWith("locations/")) {
      const accName = locationToAccount.get(locName);
      if (accName) {
        fullPath = `${accName}/${locName}`;
      } else {
        details.push({ shop: shop.name, error: "アカウント不明" });
        errors++;
        continue;
      }
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
    } catch (e: any) {
      details.push({ shop: shop.name, error: e?.message });
      errors++;
    }
  }

  return NextResponse.json({
    success: true,
    updated,
    errors,
    total: shops.length,
    details: details.slice(0, 20),
  });
}
