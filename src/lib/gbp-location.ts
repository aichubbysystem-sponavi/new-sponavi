/**
 * GBP Location Name Resolution（一元管理）
 * locations/xxx → accounts/yyy/locations/xxx に変換
 * 1. Go APIのロケーションマップで解決
 * 2. Supabaseの既知データで補完（OAuthが切れても使える永続データ）
 * 3. 失敗時はGBP APIで全アカウントを検索してフルパスを見つける
 */

import { getOAuthToken } from "@/lib/gbp-token";

const GO_API_URL = process.env.NEXT_PUBLIC_API_URL || "";

export interface LocMapping {
  fullPath: string;
  title: string;
  lat?: number;
  lng?: number;
}

/** 正規化関数（全角半角・スペースの揺れを吸収） */
export function normName(s: string): string {
  return s.normalize("NFKC").replace(/[\s\u3000]+/g, "").toLowerCase();
}

let cachedLocMap: Map<string, LocMapping> | null = null;
let cachedAt = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5分

/**
 * ロケーションマップを取得（キャッシュ付き）
 * Go API → Supabase補完 → GBP APIフォールバック の3段階
 */
export async function getLocationMap(): Promise<Map<string, LocMapping>> {
  if (cachedLocMap && Date.now() - cachedAt < CACHE_TTL) {
    return cachedLocMap;
  }

  const map = new Map<string, LocMapping>();

  // 1. Go APIから取得
  try {
    const res = await fetch(`${GO_API_URL}/api/gbp/account`, {
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const accounts = await res.json();
      for (const acc of Array.isArray(accounts) ? accounts : []) {
        const accName = acc.name || "";
        for (const loc of acc.locations || []) {
          const locName = loc.name || "";
          const fullPath = `${accName}/${locName}`;
          const m: LocMapping = { fullPath, title: loc.title || "" };
          map.set(locName, m);       // "locations/xxx"
          map.set(fullPath, m);      // "accounts/yyy/locations/xxx"
          if (loc.title) {
            map.set(loc.title, m);
            map.set(normName(loc.title), m);
          }
        }
      }
    }
  } catch (e: any) {
    console.error("[gbp-location] Go API failed:", e?.message);
  }

  // 2. Supabaseから既知のgbp_location_name/gbp_full_pathを補完
  try {
    const { getSupabase } = await import("@/lib/supabase");
    const supabase = getSupabase();
    const { data: sbShops } = await supabase
      .from("shops")
      .select("name, gbp_location_name, gbp_full_path")
      .not("gbp_location_name", "is", null);
    for (const s of sbShops || []) {
      const locName = s.gbp_location_name;
      const fullPath = s.gbp_full_path || "";
      if (fullPath && !map.has(locName)) {
        // Go APIにないがSupabaseにある → 補完
        const m: LocMapping = { fullPath, title: s.name };
        map.set(locName, m);
        map.set(fullPath, m);
        map.set(s.name, m);
        map.set(normName(s.name), m);
      }
      // 店舗名→既存マッピングの紐付け（Go APIで取れた場合も名前で引けるように）
      if (locName && map.has(locName) && !map.has(s.name)) {
        const existing = map.get(locName)!;
        map.set(s.name, existing);
        map.set(normName(s.name), existing);
      }
    }
  } catch (e: any) {
    console.error("[gbp-location] Supabase supplement failed:", e?.message);
  }

  // 3. Go API+Supabase両方から取得できなかった場合、GBP APIフォールバック
  if (map.size === 0) {
    console.log("[gbp-location] Falling back to GBP API direct...");
    try {
      const token = await getOAuthToken();
      if (token) {
        const accRes = await fetch(
          "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
          { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) }
        );
        if (accRes.ok) {
          const accData = await accRes.json();
          for (const acc of accData.accounts || []) {
            try {
              const locRes = await fetch(
                `https://mybusinessbusinessinformation.googleapis.com/v1/${acc.name}/locations?readMask=name,title,latlng&pageSize=100`,
                { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) }
              );
              if (!locRes.ok) continue;
              const locData = await locRes.json();
              for (const loc of locData.locations || []) {
                const locName = loc.name || "";
                const fullPath = `${acc.name}/${locName}`;
                const title = loc.title || "";
                const lat = loc.latlng?.latitude || undefined;
                const lng = loc.latlng?.longitude || undefined;
                const m: LocMapping = { fullPath, title, lat, lng };
                map.set(locName, m);
                map.set(fullPath, m);
                if (title) {
                  map.set(title, m);
                  map.set(normName(title), m);
                }
              }
            } catch {}
          }
          console.log(`[gbp-location] GBP API fallback: ${map.size} entries loaded`);
        }
      }
    } catch (e: any) {
      console.error("[gbp-location] GBP API fallback failed:", e?.message);
    }
  }

  if (map.size > 0) {
    cachedLocMap = map;
    cachedAt = Date.now();
  }

  return map;
}

/**
 * GBP APIで全アカウントを検索してlocation IDからフルパスを見つける
 * Go APIのマップにPERSONALアカウントが含まれない問題を回避
 */
async function resolveViaGbpApi(locationId: string): Promise<string | null> {
  const token = await getOAuthToken();
  if (!token) return null;

  try {
    const accRes = await fetch(
      "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) }
    );
    if (!accRes.ok) return null;
    const accData = await accRes.json();

    for (const acc of accData.accounts || []) {
      try {
        const locRes = await fetch(
          `https://mybusinessbusinessinformation.googleapis.com/v1/${acc.name}/locations?readMask=name&pageSize=100`,
          { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) }
        );
        if (!locRes.ok) continue;
        const locData = await locRes.json();
        for (const loc of locData.locations || []) {
          if (loc.name === locationId) {
            const fullPath = `${acc.name}/${loc.name}`;
            if (cachedLocMap) {
              cachedLocMap.set(locationId, { fullPath, title: "" });
            }
            console.log(`[gbp-location] Resolved "${locationId}" → "${fullPath}" via GBP API`);
            return fullPath;
          }
        }
      } catch {}
    }
  } catch (e: any) {
    console.error("[gbp-location] GBP API search failed:", e?.message);
  }
  return null;
}

/**
 * gbp_location_name を accounts/xxx/locations/yyy 形式のフルパスに解決
 */
export async function resolveLocationName(
  gbpLocationName: string
): Promise<string | null> {
  if (!gbpLocationName) return null;

  if (gbpLocationName.startsWith("accounts/")) {
    return gbpLocationName;
  }

  if (gbpLocationName.startsWith("locations/")) {
    const locMap = await getLocationMap();
    const mapping = locMap.get(gbpLocationName);
    if (mapping) return mapping.fullPath;

    console.log(`[gbp-location] "${gbpLocationName}" not in map, searching via GBP API...`);
    const resolved = await resolveViaGbpApi(gbpLocationName);
    if (resolved) return resolved;

    console.warn(`[gbp-location] Could not resolve "${gbpLocationName}"`);
    return null;
  }

  console.warn(`[gbp-location] Unrecognized location format: "${gbpLocationName}"`);
  return null;
}
