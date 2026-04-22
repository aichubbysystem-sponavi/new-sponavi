/**
 * 顧客管理スプレッドシートから契約情報を取得
 * シート: 18S205D1Sm0TL9NoEjrFRyDD6cHAqzQmBohx52F_MAo0
 * A列: MEO対策店舗, B列: P-MAX対策店舗, C列: 両方利用店舗
 */

const SHEET_ID = "18S205D1Sm0TL9NoEjrFRyDD6cHAqzQmBohx52F_MAo0";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

export type ServiceType = "meo" | "pmax" | "both" | "none";
export type ShopStatus = "active" | "setup" | "suspended";

export interface CustomerInfo {
  name: string;
  service: ServiceType;
  status: ShopStatus;
}

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

let cache: { data: Map<string, CustomerInfo>; ts: number } | null = null;

export async function fetchCustomerSheet(): Promise<Map<string, CustomerInfo>> {
  if (cache && Date.now() - cache.ts < 300000) return cache.data; // 5分キャッシュ

  const map = new Map<string, CustomerInfo>();

  try {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=0`;
    const res = await fetch(url, { cache: "no-store", headers: { "User-Agent": UA }, redirect: "follow" });
    if (!res.ok) return map;

    const text = await res.text();
    const lines = text.split(/\r?\n/);

    // ヘッダースキップ(1行目)
    // A列=MEO, B列=P-MAX, C列=両方
    const meoShops = new Set<string>();
    const pmaxShops = new Set<string>();
    const bothShops = new Set<string>();

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map(c => c.replace(/^"|"$/g, "").trim());
      if (cols[0] && !cols[0].includes("⇧") && !cols[0].includes("総店舗数") && !cols[0].includes("担当店舗")) {
        meoShops.add(cols[0]);
      }
      if (cols[1]) pmaxShops.add(cols[1]);
      if (cols[2]) bothShops.add(cols[2]);
    }

    // 「両方」の店舗を優先的に登録
    Array.from(bothShops).forEach(name => {
      if (name) map.set(normalize(name), { name, service: "both", status: "active" });
    });
    // MEOのみ
    Array.from(meoShops).forEach(name => {
      const key = normalize(name);
      if (!map.has(key) && name) map.set(key, { name, service: "meo", status: "active" });
    });
    // P-MAXのみ
    Array.from(pmaxShops).forEach(name => {
      const key = normalize(name);
      if (!map.has(key) && name) map.set(key, { name, service: "pmax", status: "active" });
    });

    cache = { data: map, ts: Date.now() };
  } catch {}

  return map;
}

/**
 * 店舗名から契約情報を検索（部分一致対応）
 */
export function findCustomerInfo(shopName: string, customerMap: Map<string, CustomerInfo>): CustomerInfo | null {
  const key = normalize(shopName);
  // 完全一致
  if (customerMap.has(key)) return customerMap.get(key)!;
  // 部分一致（店舗名がスプレッドシートの名前を含む or 逆）
  for (const [k, v] of Array.from(customerMap.entries())) {
    if (k.length >= 3 && key.length >= 3 && (key.includes(k) || k.includes(key))) return v;
  }
  return null;
}
