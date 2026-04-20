import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// 順位計測シート（2つ）
const SHEETS = [
  { id: "1JpehMxL2I-fgef1sckNaY8RIUDIknvmT2OqhHj0my1k", label: "Sheet1", useSheetName: true },
  { id: "10hvP7iSEyst0Bp_96eVsjicM4_qxVfG0BmMkDgFyg-Q", label: "Sheet2", useSheetName: false },
];

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

/**
 * GET /api/report/ranking-keywords?shopName=xxx
 * 公開スプレッドシートから店舗のキーワードを取得（2シート対応）
 */
export async function GET(request: NextRequest) {
  // 内部呼び出し（spreadsheet.ts等）は認証なしで許可、外部はJWT認証
  const isInternal = request.headers.get("x-internal-call") === "1";
  if (!isInternal) {
    const { verifyAuth } = await import("@/lib/auth-verify");
    const auth = await verifyAuth(request.headers.get("authorization"));
    if (!auth.valid) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const shopName = request.nextUrl.searchParams.get("shopName");
  if (!shopName) {
    return NextResponse.json({ error: "shopNameが必要です" }, { status: 400 });
  }

  const month = request.nextUrl.searchParams.get("month") || "";
  const variants = generateNameVariants(shopName);

  // Sheet1: タブ名=店舗名で直接アクセス
  for (const tabName of variants) {
    const result = await fetchFromSheetByName(SHEETS[0].id, tabName, month);
    if (result.success && (result.keywords.length > 0 || result.ranks.length > 0)) {
      return NextResponse.json({
        keywords: result.keywords,
        ranks: result.ranks,
        points: result.points,
        shopName: tabName,
        found: true,
        matchedTab: tabName,
        matchedMonth: result.matchedMonth,
        source: "sheet1",
      });
    }
  }

  // Sheet2: HTMLからタブ名→gidマッピングを取得し、部分マッチで検索
  try {
    const tabMap = await fetchTabGidMap(SHEETS[1].id);
    const matchedTabs = findMatchingTabs(shopName, tabMap);
    for (const matchedTab of matchedTabs) {
      const result = await fetchFromSheetByGid(SHEETS[1].id, matchedTab.gid, month);
      if (result.success) {
        // A1セルで店舗名を検証（レディース/メンズの区別）
        if (result.a1ShopName && !shopName.includes(result.a1ShopName) && !result.a1ShopName.includes(shopName)) {
          continue; // A1の店舗名が合わない → 次のタブを試す
        }
        return NextResponse.json({
          keywords: result.keywords,
          ranks: result.ranks,
          points: result.points,
          shopName,
          found: true,
          matchedTab: matchedTab.name,
          matchedMonth: result.matchedMonth,
          source: "sheet2",
        });
      }
    }
  } catch {}

  return NextResponse.json({
    keywords: [],
    ranks: [],
    shopName,
    found: false,
    triedTabs: variants,
  });
}

/**
 * 店舗名のバリエーションを生成（タブ名との不一致を吸収）
 */
function generateNameVariants(name: string): string[] {
  const variants = new Set<string>();
  variants.add(name);
  variants.add(name.replace(/\s+/g, " ").trim());
  variants.add(name.replace(/\./g, "．"));
  variants.add(name.replace(/．/g, "."));
  variants.add(name.replace(/\s/g, ""));
  variants.add(name.replace(/\s/g, "　"));
  return Array.from(variants);
}

// ===== Sheet1: タブ名で直接アクセス =====

async function fetchFromSheetByName(sheetId: string, tabName: string, targetMonth: string): Promise<FetchResult> {
  try {
    const encodedTab = encodeURIComponent(tabName);

    // ヘッダー行を range 指定で取得（gviz はテキストのみセルを空にするため）
    const headerUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodedTab}&range=A1:AZ1`;
    const headerRes = await fetch(headerUrl, { headers: { "User-Agent": UA }, redirect: "follow" });
    if (!headerRes.ok) return EMPTY_RESULT;
    const headerText = await headerRes.text();
    if (isHtml(headerText)) return EMPTY_RESULT;

    // A1セルが店舗名と一致するか検証（gvizは存在しないタブ名でも最初のタブを返すため）
    const headerRow = parseCSVRow(headerText.split("\n")[0] || "");
    const a1 = (headerRow[0] || "").trim();
    // A1がタブ名と異なり、かつサマリーシートのヘッダー（最終/店舗名/ビジネスプロフィール等）ならスキップ
    if (a1 !== tabName && a1 !== tabName.replace(/\s+/g, " ").trim()) {
      const summaryHeaders = ["最終", "店舗名", "ビジネスプロフィール"];
      if (summaryHeaders.includes(a1)) return EMPTY_RESULT;
    }

    // データ行を取得
    const dataUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodedTab}`;
    const dataRes = await fetch(dataUrl, { headers: { "User-Agent": UA }, redirect: "follow" });
    if (!dataRes.ok) return EMPTY_RESULT;
    const dataText = await dataRes.text();

    return parseSheetData(headerText, dataText, targetMonth);
  } catch {
    return EMPTY_RESULT;
  }
}

// ===== Sheet2: gidでアクセス =====

async function fetchFromSheetByGid(sheetId: string, gid: string, targetMonth: string): Promise<FetchResult> {
  try {
    // ヘッダー行を range 指定で取得
    const headerUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}&range=A1:AZ1`;
    const headerRes = await fetch(headerUrl, { headers: { "User-Agent": UA }, redirect: "follow" });
    if (!headerRes.ok) return EMPTY_RESULT;
    const headerText = await headerRes.text();
    if (isHtml(headerText)) return EMPTY_RESULT;

    // A1セルから店舗名を取得
    const a1Row = parseCSVRow(headerText.split("\n")[0] || "");
    const a1ShopName = (a1Row[0] || "").trim();

    // データ行を取得
    const dataUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}`;
    const dataRes = await fetch(dataUrl, { headers: { "User-Agent": UA }, redirect: "follow" });
    if (!dataRes.ok) return EMPTY_RESULT;
    const dataText = await dataRes.text();

    const result = parseSheetData(headerText, dataText, targetMonth);
    result.a1ShopName = a1ShopName;
    return result;
  } catch {
    return EMPTY_RESULT;
  }
}

// ===== タブ名→gidマッピング取得 =====

let tabMapCache: { map: Map<string, string>; ts: number } | null = null;

async function fetchTabGidMap(sheetId: string): Promise<Map<string, string>> {
  // 30分キャッシュ
  if (tabMapCache && Date.now() - tabMapCache.ts < 1800000) return tabMapCache.map;

  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/htmlview`;
  const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!res.ok) return new Map();

  const html = await res.text();
  const map = new Map<string, string>();

  // items.push({name: "旭川院", ... gid: "1705054054" ...}) パターンを抽出
  const regex = /name:\s*"([^"]+)"[^}]*?gid:\s*"(\d+)"/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    map.set(match[1], match[2]);
  }

  tabMapCache = { map, ts: Date.now() };
  return map;
}

/**
 * 店舗名からタブを部分マッチで検索
 * 例: "エミナルクリニック 旭川院" → "旭川院" にマッチ
 * 例: "メンズエミナル 渋谷駅前院" → "渋谷駅前" or "渋谷駅前院" にマッチ
 */
function findMatchingTabs(shopName: string, tabMap: Map<string, string>): { name: string; gid: string }[] {
  const normalized = shopName.replace(/\s+/g, " ").trim();
  const results: { name: string; gid: string; len: number }[] = [];

  // 1. 完全一致
  for (const [name, gid] of Array.from(tabMap.entries())) {
    if (name === normalized || name === shopName) return [{ name, gid }];
  }

  // 2. タブ名が店舗名に含まれる（全候補を返す）
  for (const [name, gid] of Array.from(tabMap.entries())) {
    // 管理用・地方タブは除外
    if (name.match(/全店舗|ひな型|kw\s|シート|まとめ|P-MAX|口コミ|◯△|レディース|メンズ/)) continue;
    if (normalized.includes(name) || shopName.includes(name)) {
      results.push({ name, gid, len: name.length });
    }
  }

  if (results.length > 0) {
    results.sort((a, b) => b.len - a.len);
    return results;
  }

  // 3. 店舗名がタブ名に含まれる（逆方向）
  for (const [name, gid] of Array.from(tabMap.entries())) {
    if (name.includes(normalized) || name.includes(shopName)) {
      results.push({ name, gid, len: name.length });
    }
  }

  return results;
}

// ===== 共通パーサー =====

interface FetchResult {
  success: boolean;
  keywords: string[];
  ranks: { word: string; rank: number; prevRank: number }[];
  matchedMonth: string;
  points: { label: string; lat: number; lng: number }[];
  a1ShopName?: string;
}

const EMPTY_RESULT: FetchResult = { success: false, keywords: [], ranks: [], matchedMonth: "", points: [] };

function isHtml(text: string): boolean {
  return text.includes("<!DOCTYPE") || text.includes("<html") || text.includes("Invalid sheet");
}

// KW除外ヘッダー
const NON_KW_HEADERS = new Set([
  "最終", "今月点数", "今月件数", "先月点数", "先月件数", "前月比", "コード",
  "点数コピペ列", "件数コピペ列", "店舗名", "住所", "今月→", "#REF!",
  "前月比　検索", "前月比　マップ", "前月比　アクション",
  "日付", "Google 検索 - モバイル", "Google 検索 - パソコン", "Google検索合計",
  "Google マップ - モバイル", "Google マップ - パソコン", "Googleマップ合計",
  "通話", "メッセージ", "予約", "ルート", "ウェブサイトのクリック",
  "料理の注文", "フードメニューのクリック", "ホテルの予約",
  "アクション数合計", "口コミ数", "評価", "クチコミ",
  "local", "ビジネスプロフィール", "先月対比",
]);

// 都市名→座標マッピング
const CITY_COORDS: Record<string, { lat: number; lng: number; label: string }> = {
  tokyo: { lat: 35.6812, lng: 139.7671, label: "東京駅" },
  osaka: { lat: 34.7024, lng: 135.4959, label: "大阪駅" },
  fukuoka: { lat: 33.5902, lng: 130.4017, label: "博多駅" },
  sapporo: { lat: 43.0687, lng: 141.3508, label: "札幌駅" },
  nagoya: { lat: 35.1709, lng: 136.8815, label: "名古屋駅" },
  yokohama: { lat: 35.4437, lng: 139.6380, label: "横浜駅" },
  kobe: { lat: 34.6901, lng: 135.1956, label: "三ノ宮駅" },
  kyoto: { lat: 34.9858, lng: 135.7588, label: "京都駅" },
  sendai: { lat: 38.2602, lng: 140.8824, label: "仙台駅" },
  hiroshima: { lat: 34.3963, lng: 132.4594, label: "広島駅" },
  naha: { lat: 26.2124, lng: 127.6792, label: "那覇" },
};

/**
 * ヘッダーCSVとデータCSVからキーワード・順位・計測地点を抽出
 */
function parseSheetData(headerText: string, dataText: string, targetMonth: string): FetchResult {
  const headerLines = headerText.split("\n").filter(l => l.trim());
  if (headerLines.length < 1) return EMPTY_RESULT;

  const headerRow = parseCSVRow(headerLines[0]);

  // 動的にKW列を検出（固定インデックスではなく、ヘッダー名で判定）
  const kwIndices: number[] = [];
  for (let i = 0; i < headerRow.length; i++) {
    const cell = (headerRow[i] || "").trim();
    if (!cell) continue;
    if (NON_KW_HEADERS.has(cell)) continue;
    if (cell.includes("前月比")) continue;
    // 注記・記号セルを除外
    if (cell.includes("※") || cell.includes("#REF") || cell.includes("#VALUE") || cell.includes("#DIV")) continue;
    // 数値列（座標等）を除外
    if (/^\d+(\.\d+)?$/.test(cell)) continue;
    // 年月形式を除外（"2025年1月"等）
    if (/^\d{4}年\d{1,2}月$/.test(cell)) continue;
    // A列は店舗名なのでスキップ（ただし名前でフィルタ済み）
    if (i === 0) continue;
    kwIndices.push(i);
  }

  const keywords = kwIndices.map(i => (headerRow[i] || "").trim()).filter(Boolean);

  // データ行パース
  const dataLines = dataText.split("\n").filter(l => l.trim());
  if (dataLines.length < 2) return { success: true, keywords, ranks: [], matchedMonth: "", points: [] };
  const dataRows = dataLines.slice(1).map(l => parseCSVRow(l));

  // 対象月の行を探す
  let targetRow: string[] | null = null;
  let prevRow: string[] | null = null;
  let matchedMonth = "";

  if (targetMonth) {
    const [ty, tm] = targetMonth.split("-").map(Number);
    for (let i = dataRows.length - 1; i >= 0; i--) {
      const dateCell = (dataRows[i][1] || "").trim();
      const m = dateCell.match(/(\d{4})[\/年](\d{1,2})/);
      if (m && parseInt(m[1]) === ty && parseInt(m[2]) === tm) {
        targetRow = dataRows[i];
        matchedMonth = `${ty}-${String(tm).padStart(2, "0")}`;
        const prevMonth = tm === 1 ? 12 : tm - 1;
        const prevYear = tm === 1 ? ty - 1 : ty;
        for (let j = i - 1; j >= 0; j--) {
          const pd = (dataRows[j][1] || "").trim();
          const pm = pd.match(/(\d{4})[\/年](\d{1,2})/);
          if (pm && parseInt(pm[1]) === prevYear && parseInt(pm[2]) === prevMonth) {
            prevRow = dataRows[j];
            break;
          }
        }
        break;
      }
    }
  }

  if (!targetRow && dataRows.length > 0) {
    targetRow = dataRows[dataRows.length - 1];
    prevRow = dataRows.length >= 2 ? dataRows[dataRows.length - 2] : null;
    const dateCell = (targetRow[1] || "").trim();
    const m = dateCell.match(/(\d{4})[\/年](\d{1,2})/);
    if (m) matchedMonth = `${m[1]}-${String(parseInt(m[2])).padStart(2, "0")}`;
  }

  // 順位データ
  const ranks: { word: string; rank: number; prevRank: number }[] = [];
  if (targetRow) {
    for (const idx of kwIndices) {
      const kwName = (headerRow[idx] || "").trim();
      if (!kwName) continue;
      const rank = parseInt((targetRow[idx] || "0").replace(/,/g, "")) || 0;
      const prevRank = prevRow ? (parseInt((prevRow[idx] || "0").replace(/,/g, "")) || 0) : 0;
      ranks.push({ word: kwName, rank, prevRank: prevRank || rank });
    }
  }

  // 計測地点（座標列を検出）
  const points: { label: string; lat: number; lng: number }[] = [];
  for (let i = 0; i < headerRow.length; i++) {
    const cell = (headerRow[i] || "").trim().toLowerCase();
    if (!cell) continue;
    if (cell === "local") {
      const lat = parseFloat((headerRow[i + 1] || "").trim());
      const lng = parseFloat((headerRow[i + 2] || "").trim());
      if (!isNaN(lat) && !isNaN(lng)) {
        points.push({ label: "店舗周辺", lat, lng });
      }
    } else if (CITY_COORDS[cell]) {
      points.push(CITY_COORDS[cell]);
    }
  }

  return { success: true, keywords, ranks, matchedMonth, points };
}

function parseCSVRow(line: string): string[] {
  const cells: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      i++;
      let val = "";
      while (i < line.length) {
        if (line[i] === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') { val += '"'; i += 2; }
          else { i++; break; }
        } else { val += line[i]; i++; }
      }
      cells.push(val);
      if (i < line.length && line[i] === ",") i++;
    } else {
      let val = "";
      while (i < line.length && line[i] !== "," && line[i] !== "\n" && line[i] !== "\r") { val += line[i]; i++; }
      cells.push(val);
      if (i < line.length && line[i] === ",") i++;
    }
  }
  return cells;
}
