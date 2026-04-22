/**
 * GBP Location Name Resolution
 * Go APIのロケーションマップを使って locations/xxx → accounts/yyy/locations/xxx に変換
 */

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
 */
export async function getLocationMap(): Promise<Map<string, LocMapping>> {
  if (cachedLocMap && Date.now() - cachedAt < CACHE_TTL) {
    return cachedLocMap;
  }

  const map = new Map<string, LocMapping>();
  try {
    const res = await fetch(`${GO_API_URL}/api/gbp/account`, {
      signal: AbortSignal.timeout(20000),
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
    console.error("[gbp-location] Failed to fetch location map:", e?.message);
  }

  if (map.size > 0) {
    cachedLocMap = map;
    cachedAt = Date.now();
  }

  return map;
}

/**
 * gbp_location_name を accounts/xxx/locations/yyy 形式のフルパスに解決
 * - "accounts/..." で始まる場合はそのまま返す
 * - "locations/..." で始まる場合は Go API のロケーションマップで解決
 * - 解決できない場合は null を返す
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
    console.warn(
      `[gbp-location] Could not resolve "${gbpLocationName}" via Go API location map`
    );
    return null;
  }

  // Neither accounts/ nor locations/ prefix
  console.warn(
    `[gbp-location] Unrecognized location format: "${gbpLocationName}"`
  );
  return null;
}
