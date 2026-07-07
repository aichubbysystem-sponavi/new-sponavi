/**
 * P-MAX広告レポート用スプレッドシートデータ取得
 * シート: 1wludlpnMw7xithCJc3-9iIkjnhx2RFSWR9A8ihOsJ4A
 * タブ: Google広告 店舗別データ (gid=372148068)
 *
 * 列構成:
 * A: 日+店舗名, B: 日(YYYY/MM), C: 店舗名,
 * D: 総表示回数, E: 総クリック数, F: 総広告費,
 * G: 来来店, H: 電話, I: 経路案内, J: WEBサイト,
 * K: メニュークリック, L: 保存・共有, M: 注文,
 * N: 来店（ビュースルー）, O: 合計来店数
 */

const SHEET_ID = "1wludlpnMw7xithCJc3-9iIkjnhx2RFSWR9A8ihOsJ4A";
const GID = "372148068";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

export interface PmaxGbpRow {
  month: string;       // "2025/04"
  shopName: string;
  totalImpressions: number; // 総表示回数 (D列)
  totalVisits: number; // 合計来店数 (O列)
  phone: number;       // 電話 (H列)
  directions: number;  // 経路案内 (I列)
  website: number;     // WEBサイト (J列)
  menuClicks: number;  // メニュークリック (K列)
  saveShare: number;   // 保存・共有 (L列)
  reservation: number; // 予約（数値はM列「注文」由来。レポート上のラベルは「予約」）
}

let cache: { data: PmaxGbpRow[]; ts: number } | null = null;
const CACHE_TTL = 10 * 60 * 1000; // 10分

function parseNum(s: string): number {
  const n = Number(s.replace(/,/g, "").trim());
  return isNaN(n) ? 0 : n;
}

async function fetchAllRows(): Promise<PmaxGbpRow[]> {
  if (cache && Date.now() - cache.ts < CACHE_TTL) return cache.data;

  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;
  const res = await fetch(url, {
    cache: "no-store",
    headers: { "User-Agent": UA },
    redirect: "follow",
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    throw new Error(`スプレッドシート取得エラー: ${res.status}`);
  }

  const text = await res.text();
  const lines = text.split(/\r?\n/);
  const rows: PmaxGbpRow[] = [];

  // 1行目はヘッダー、2行目以降がデータ
  for (let i = 1; i < lines.length; i++) {
    // CSVパース（ダブルクォート内のカンマ対応）
    const cols = parseCSVLine(lines[i]);
    if (cols.length < 15) continue;

    const month = cols[1]?.trim();
    const shopName = cols[2]?.trim();
    if (!month || !shopName) continue;

    rows.push({
      month,
      shopName,
      totalImpressions: parseNum(cols[3]), // D列 = index 3
      totalVisits: parseNum(cols[14]),  // O列 = index 14
      phone: parseNum(cols[7]),         // H列 = index 7
      directions: parseNum(cols[8]),    // I列 = index 8
      website: parseNum(cols[9]),       // J列 = index 9
      menuClicks: parseNum(cols[10]),   // K列 = index 10
      saveShare: parseNum(cols[11]),    // L列 = index 11
      reservation: parseNum(cols[12]),  // M列「注文」= index 12。表示ラベルは「予約」（2026-07-06ユーザー確定）
    });
  }

  cache = { data: rows, ts: Date.now() };
  return rows;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

/**
 * 店舗名でフィルタしたGBPデータを取得
 * @param shopName 店舗名（部分一致）
 * @param targetMonth "YYYY/MM" 形式（省略時は全月）
 */
/** 店舗名の照合用正規化（NFKCで全半角統一 + 空白除去 + 小文字化） */
export function normShopName(s: string): string {
  return s.normalize("NFKC").replace(/[\s　]+/g, "").toLowerCase();
}

/**
 * Ads側店舗名を、GBPシート側の正規化済み店舗名候補に安全に照合する。
 * backfill-gbp と sync で共有する唯一の照合ロジック（相互includesの誤マッチ防止）。
 *
 * 優先順位:
 *  1. 完全一致（正規化後）
 *  2. 相互部分一致の候補が「1件だけ」→ 採用
 *  3. 候補が複数 → 「{key}店」への完全一致が1件だけなら採用、それ以外は ambiguous でスキップ
 *
 * @returns key: 採用するシート側正規化キー（無ければnull） / ambiguous: 複数候補で保留したか
 */
export function pickGbpMatch(
  adsName: string,
  candidateNormKeys: string[],
): { key: string | null; ambiguous: boolean } {
  const key = normShopName(adsName);
  if (!key) return { key: null, ambiguous: false };
  // 1. 完全一致
  if (candidateNormKeys.includes(key)) return { key, ambiguous: false };
  // 2/3. 相互部分一致
  const cands = candidateNormKeys.filter((k) => k.length > 0 && (k.includes(key) || key.includes(k)));
  if (cands.length === 1) return { key: cands[0], ambiguous: false };
  if (cands.length > 1) {
    const exactPlusTen = cands.filter((k) => k === `${key}店`);
    if (exactPlusTen.length === 1) return { key: exactPlusTen[0], ambiguous: false };
    return { key: null, ambiguous: true };
  }
  return { key: null, ambiguous: false };
}

/**
 * 指定月について、Ads側店舗名に「安全に」対応するGBP行を1件解決する。
 * 相互includesで複数候補にマッチする場合は誤った店舗の数値を書き込まず null(ambiguous) を返す。
 * sync の GBP同期はこれを使い、gbpRows[0] の先頭採用による誤マッチを避ける。
 */
export async function getGbpRowStrict(
  shopName: string,
  targetMonth: string,
): Promise<{ row: PmaxGbpRow | null; ambiguous: boolean }> {
  const allRows = await fetchAllRows();
  // 当月行を正規化キーでまとめる（同一店×月の重複はシート後方=最新行を採用）
  const byNorm = new Map<string, PmaxGbpRow>();
  for (const r of allRows) {
    if (r.month !== targetMonth) continue;
    byNorm.set(normShopName(r.shopName), r);
  }
  const { key, ambiguous } = pickGbpMatch(shopName, Array.from(byNorm.keys()));
  return { row: key ? byNorm.get(key) || null : null, ambiguous };
}

export async function getGbpDataForShop(
  shopName: string,
  targetMonth?: string
): Promise<PmaxGbpRow[]> {
  const allRows = await fetchAllRows();
  const normalizedShop = normShopName(shopName);

  return allRows.filter((row) => {
    const normalizedRow = normShopName(row.shopName);
    const nameMatch = normalizedRow.includes(normalizedShop) || normalizedShop.includes(normalizedRow);
    if (targetMonth) {
      return nameMatch && row.month === targetMonth;
    }
    return nameMatch;
  });
}

/**
 * 全店舗名の一覧を取得（重複排除）
 */
/** 全店舗×全月のGBP行を取得（バックフィル用） */
export async function getAllGbpRows(): Promise<PmaxGbpRow[]> {
  return fetchAllRows();
}

export async function getShopNames(): Promise<string[]> {
  const allRows = await fetchAllRows();
  return Array.from(new Set(allRows.map((r) => r.shopName))).sort();
}
