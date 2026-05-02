/**
 * GBP Location Name Resolution
 * locations/xxx → accounts/yyy/locations/xxx に変換
 * 1. Go APIのロケーションマップで解決を試みる
 * 2. 失敗時はGBP APIで全アカウントを検索してフルパスを見つける
 */

import { getOAuthToken } from "@/lib/gbp-token";

const GO_API_URL = process.env.NEXT_PUBLIC_API_URL || "";

interface LocMapping {
  fullPath: string;
  title: string;
}

let cachedLocMap: Map<string, LocMapping> | null = null;
let cachedAt = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5分

/**
 * Go API /api/gbp/account からロケーションマップを取得（キャッシュ付き）
 * Go API失敗時はGBP APIから直接取得（フォールバック）
 */
export async function getLocationMap(): Promise<Map<string, LocMapping>> {
  if (cachedLocMap && Date.now() - cachedAt < CACHE_TTL) {
    return cachedLocMap;
  }

  const map = new Map<string, LocMapping>();

  // 1. Go APIから取得を試みる
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
          if (loc.title) map.set(loc.title, m);
        }
      }
    }
  } catch (e: any) {
    console.error("[gbp-location] Go API failed, will fallback to GBP API:", e?.message);
  }

  // 2. Go APIから取得できなかった場合、GBP APIから直接取得
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
          const accounts = accData.accounts || [];
          for (const acc of accounts) {
            try {
              const locRes = await fetch(
                `https://mybusinessbusinessinformation.googleapis.com/v1/${acc.name}/locations?readMask=name,title&pageSize=100`,
                { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) }
              );
              if (!locRes.ok) continue;
              const locData = await locRes.json();
              for (const loc of locData.locations || []) {
                const locName = loc.name || "";
                const fullPath = `${acc.name}/${locName}`;
                const title = loc.title || "";
                const m: LocMapping = { fullPath, title };
                map.set(locName, m);
                map.set(fullPath, m);
                if (title) map.set(title, m);
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
    // 全アカウント一覧を取得
    const accRes = await fetch(
      "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) }
    );
    if (!accRes.ok) return null;
    const accData = await accRes.json();
    const accounts = accData.accounts || [];

    // 各アカウントのロケーションを検索
    for (const acc of accounts) {
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
            // キャッシュに追加
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
    // 1. Go APIのマップで解決を試みる
    const locMap = await getLocationMap();
    const mapping = locMap.get(gbpLocationName);
    if (mapping) return mapping.fullPath;

    // 2. マップになければGBP APIで全アカウントを検索
    console.log(`[gbp-location] "${gbpLocationName}" not in Go API map, searching via GBP API...`);
    const resolved = await resolveViaGbpApi(gbpLocationName);
    if (resolved) return resolved;

    console.warn(`[gbp-location] Could not resolve "${gbpLocationName}"`);
    return null;
  }

  console.warn(`[gbp-location] Unrecognized location format: "${gbpLocationName}"`);
  return null;
}
