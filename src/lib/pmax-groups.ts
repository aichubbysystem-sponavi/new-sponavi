/**
 * P-MAX広告レポート グループ定義シート取得
 * シート: 1nTpdDIATNJhsKkx6hZwwquMhFvvfnstVKs4nsA6CWg4 (gid=0)
 *
 * レイアウト（列ごとにグループ）:
 *   1行目 = グループ名（企業/クライアント名）
 *   2行目以降 = その列に属する店舗名（縦に並ぶ）
 *
 * 例:
 *   A1: 株式会社アソボラボ   B1: 株式会社京屋総本舗 ...
 *   A2: GRASS DOG&CAT 北浜   B2: 立ちヤキニク 七七四 ...
 *   A3: GRASS DOG & CAT 箕面 ...
 */

const SHEET_ID = "1nTpdDIATNJhsKkx6hZwwquMhFvvfnstVKs4nsA6CWg4";
const GID = "0";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

export interface PmaxGroup {
  name: string;        // グループ名（1行目）
  stores: string[];    // このグループに属する店舗名（原文のまま）
}

let cache: { groups: PmaxGroup[]; ts: number } | null = null;
const CACHE_TTL = 10 * 60 * 1000; // 10分

/**
 * 店舗名の正規化（マッチ用）
 * NFKC（全角/半角統一）+ 空白除去 + 小文字化
 * supabase.ts の verifyShopAccess と同じ規則に合わせる
 */
export function normalizeShopName(s: string): string {
  return (s || "").normalize("NFKC").replace(/[\s　]+/g, "").toLowerCase();
}

/**
 * CSV全体をパース（ダブルクォート内のカンマ・改行に対応）
 * 戻り値: 行 × セル の2次元配列
 */
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(cur);
        cur = "";
      } else if (ch === "\n") {
        row.push(cur);
        rows.push(row);
        row = [];
        cur = "";
      } else if (ch === "\r") {
        // 無視（\r\n の \r）
      } else {
        cur += ch;
      }
    }
  }
  // 末尾セル/行
  if (cur.length > 0 || row.length > 0) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

async function fetchGroupsFromSheet(): Promise<PmaxGroup[]> {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: { "User-Agent": UA },
    redirect: "follow",
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    throw new Error(`グループ定義シート取得エラー: ${res.status}`);
  }

  const text = await res.text();
  const rows = parseCSV(text);
  if (rows.length === 0) return [];

  const header = rows[0];
  const colCount = header.length;
  const groups: PmaxGroup[] = [];

  for (let c = 0; c < colCount; c++) {
    const name = (header[c] || "").trim();
    if (!name) continue; // グループ名が空の列はスキップ

    const stores: string[] = [];
    const seen = new Set<string>();
    for (let r = 1; r < rows.length; r++) {
      const cell = (rows[r][c] || "").trim();
      if (!cell) continue;
      const key = normalizeShopName(cell);
      if (seen.has(key)) continue; // 同一グループ内の重複を排除
      seen.add(key);
      stores.push(cell);
    }
    groups.push({ name, stores });
  }

  return groups;
}

/**
 * グループ一覧を取得（キャッシュ付き）
 * @param forceRefresh true でキャッシュを無視してシートを再取得
 */
export async function getPmaxGroups(forceRefresh = false): Promise<PmaxGroup[]> {
  if (!forceRefresh && cache && Date.now() - cache.ts < CACHE_TTL) {
    return cache.groups;
  }
  const groups = await fetchGroupsFromSheet();
  cache = { groups, ts: Date.now() };
  return groups;
}

/**
 * 指定グループ名に属する店舗名リストを取得
 * @returns グループが存在しなければ null
 */
export async function getGroupStores(
  groupName: string,
  forceRefresh = false
): Promise<{ name: string; stores: string[] } | null> {
  const groups = await getPmaxGroups(forceRefresh);
  const target = normalizeShopName(groupName);
  const found = groups.find((g) => normalizeShopName(g.name) === target);
  return found ? { name: found.name, stores: found.stores } : null;
}
