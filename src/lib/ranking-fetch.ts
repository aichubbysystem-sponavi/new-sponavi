/**
 * スプレッドシートからキーワード順位を直接取得（HTTP自己呼び出し不要）
 */

import { normalizeKw } from "./keyword-normalize";

const SHEETS = [
  { id: "1JpehMxL2I-fgef1sckNaY8RIUDIknvmT2OqhHj0my1k", label: "Sheet1" },
  { id: "10hvP7iSEyst0Bp_96eVsjicM4_qxVfG0BmMkDgFyg-Q", label: "Sheet2" },
  { id: "1em-V1c4rJnoG-rqpdLGaFrqz8kQKepvHABt8NLOvvtE", label: "Sheet3" }, // KW=F列〜、地域別行あり
];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

export interface RankEntry { word: string; rank: number; prevRank: number; }
export interface RankHistoryData {
  labels: string[];
  datasets: { word: string; ranks: (number | null)[] }[];
}

export interface RankingSheetsResult {
  ranks: RankEntry[];
  history: RankHistoryData;
}

/** 発見済みタブ位置のメモリキャッシュ（ウォームなインスタンスで再探索を省く。ミス時は全探索にフォールバック） */
/** key: s1name/s3name はタブ名、s2gid/s3gid は gid */
type TabLocation = { kind: "s1name" | "s2gid" | "s3name" | "s3gid"; key: string };
/** main: Sheet1/2（旧・手動シート）/ s3: Sheet3（順位自動計測）。両方にタブがある店舗があるため別々に記憶する */
type TabLocations = { main?: TabLocation; s3?: TabLocation };
const tabLocationCache = new Map<string, { locs: TabLocations; ts: number }>();
const TAB_LOCATION_TTL = 24 * 60 * 60 * 1000;

/** header(A1:AZ1) + データ本体を1組だけ取得する共通ヘルパー。HTMLが返る/失敗時は null */
async function fetchSheetCsv(sheetId: string, param: string): Promise<{ headerText: string; dataText: string } | null> {
  try {
    const headerRes = await fetch(
      `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&${param}&range=A1:AZ1`,
      { headers: { "User-Agent": UA }, redirect: "follow" }
    );
    if (!headerRes.ok) return null;
    const headerText = await headerRes.text();
    if (headerText.includes("<!DOCTYPE") || headerText.includes("<html")) return null;
    const dataRes = await fetch(
      `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&${param}`,
      { headers: { "User-Agent": UA }, redirect: "follow" }
    );
    if (!dataRes.ok) return null;
    return { headerText, dataText: await dataRes.text() };
  } catch { return null; }
}

/** trySheetByName / trySheetHistoryByName と同じA1検証（Sheet1/2系の汎用） */
function validateA1ByName(headerText: string, tabName: string): boolean {
  const headerRow = parseCSVRow(headerText.split("\n")[0] || "");
  const a1 = (headerRow[0] || "").trim();
  if (a1 !== tabName && a1 !== tabName.replace(/\s+/g, " ").trim()) {
    if (["最終", "店舗名", "ビジネスプロフィール"].includes(a1)) return false;
  }
  return true;
}

/** trySheetByGid / trySheetHistoryByGid と同じA1検証（店舗名の包含チェック） */
function validateA1ByGid(headerText: string, shopName: string): boolean {
  const a1Row = parseCSVRow(headerText.split("\n")[0] || "");
  const a1 = (a1Row[0] || "").trim();
  return !(a1 && !shopName.includes(a1) && !a1.includes(shopName));
}

/** trySheet3HistoryByName と同じA1検証（Sheet3の履歴用） */
function validateA1Sheet3Name(headerText: string, tabName: string): boolean {
  const headerRow = parseCSVRow(headerText.split("\n")[0] || "");
  const a1 = (headerRow[0] || "").trim();
  if (a1 !== tabName && a1 !== tabName.replace(/\s+/g, " ").trim()) {
    if (!tabName.includes(a1) && !a1.includes(tabName)) return false;
  }
  return true;
}

/**
 * 履歴マージ: Sheet3（自動計測）の値をKW×月単位で優先し、無い月・KWはSheet1/2（旧・手動シート）で補完。
 * KWは正規化キーで同一視（全角/半角スペースの表記ゆれ吸収）。
 */
function mergeHistories(base: RankHistoryData, priority: RankHistoryData): RankHistoryData {
  if (base.labels.length === 0) return priority;
  if (priority.labels.length === 0) return base;

  const monthNum = (m: string) => {
    const [y, mo] = m.split("/").map(Number);
    return (y || 0) * 100 + (mo || 0);
  };
  const labels = Array.from(new Set([...base.labels, ...priority.labels]))
    .sort((a, b) => monthNum(a) - monthNum(b))
    .slice(-13);

  // KW一覧: 自動計測側の並びを先に（正規化キーで統合）
  const words: { key: string; word: string }[] = [];
  const seen = new Set<string>();
  for (const ds of [...priority.datasets, ...base.datasets]) {
    const key = normalizeKw(ds.word);
    if (!seen.has(key)) { seen.add(key); words.push({ key, word: ds.word }); }
  }

  const rankAt = (h: RankHistoryData, key: string, month: string): number | null => {
    const i = h.labels.indexOf(month);
    if (i < 0) return null;
    const ds = h.datasets.find(d => normalizeKw(d.word) === key);
    const r = ds ? ds.ranks[i] : null;
    return r && r > 0 ? r : null;
  };

  return {
    labels,
    datasets: words.map(({ key, word }) => ({
      word,
      ranks: labels.map(m => rankAt(priority, key, m) ?? rankAt(base, key, m)),
    })),
  };
}

/**
 * キーワード順位（最新+前月）と順位推移を、同じタブのCSVを1回だけ取得して両方パースする。
 * fetchRankingFromSheets + fetchRankingHistoryFromSheets を別々に呼ぶと同じ探索・同じCSV取得が
 * 2系統走って遅いため、その統合版。検証・パースは既存関数と同一。
 *
 * Sheet1/2（旧・手動シート）とSheet3（順位自動計測）は並列に両方探索し、履歴をマージして返す。
 * （以前はSheet1でヒットした時点で打ち切っていたため、両方にタブがある店舗で
 *   Sheet3の自動計測順位がレポートに反映されなかった）
 */
export async function fetchRankingAndHistoryFromSheets(shopName: string): Promise<RankingSheetsResult> {
  const variants = generateNameVariants(shopName);

  const rec = tabLocationCache.get(shopName);
  const cachedLocs: TabLocations = rec && Date.now() - rec.ts < TAB_LOCATION_TTL ? rec.locs : {};

  let mainRanks: RankEntry[] = [];
  let mainHist: RankHistoryData = { labels: [], datasets: [] };
  let mainLoc: TabLocation | undefined;
  let s3Ranks: RankEntry[] = [];
  let s3Hist: RankHistoryData = { labels: [], datasets: [] };
  let s3Loc: TabLocation | undefined;

  // ── Sheet1/2 探索（順位+履歴が両方埋まったら打ち切り）──
  const searchMain = async () => {
    const tryLoc = async (loc: TabLocation): Promise<boolean> => {
      if (loc.kind === "s1name") {
        const csv = await fetchSheetCsv(SHEETS[0].id, `sheet=${encodeURIComponent(loc.key)}`);
        if (!csv || !validateA1ByName(csv.headerText, loc.key)) return false;
        if (mainRanks.length === 0) mainRanks = parseRanks(csv.headerText, csv.dataText);
        if (mainHist.labels.length === 0) mainHist = parseRanksHistory(csv.headerText, csv.dataText);
      } else if (loc.kind === "s2gid") {
        const csv = await fetchSheetCsv(SHEETS[1].id, `gid=${loc.key}`);
        if (!csv || !validateA1ByGid(csv.headerText, shopName)) return false;
        if (mainRanks.length === 0) mainRanks = parseRanks(csv.headerText, csv.dataText);
        if (mainHist.labels.length === 0) mainHist = parseRanksHistory(csv.headerText, csv.dataText);
      } else return false;
      return mainRanks.length > 0 || mainHist.labels.length > 0;
    };
    const done = () => mainRanks.length > 0 && mainHist.labels.length > 0;

    if (cachedLocs.main) {
      if (await tryLoc(cachedLocs.main)) mainLoc = cachedLocs.main;
      if (done()) return;
    }
    for (const tabName of variants) {
      if (done()) return;
      if (await tryLoc({ kind: "s1name", key: tabName })) mainLoc = { kind: "s1name", key: tabName };
    }
    if (!done()) {
      try {
        const tabMap = await fetchTabGidMap(SHEETS[1].id);
        const matchedTabs = findMatchingTabs(shopName, tabMap);
        for (const tab of matchedTabs) {
          if (done()) return;
          if (await tryLoc({ kind: "s2gid", key: tab.gid })) mainLoc = { kind: "s2gid", key: tab.gid };
        }
      } catch {}
    }
  };

  // ── Sheet3 探索（履歴が埋まったら打ち切り）──
  const searchS3 = async () => {
    const tryLoc = async (loc: TabLocation): Promise<boolean> => {
      if (loc.kind === "s3name") {
        const csv = await fetchSheetCsv(SHEETS[2].id, `sheet=${encodeURIComponent(loc.key)}`);
        if (!csv) return false;
        // 順位は汎用検証+汎用パーサ、履歴はSheet3検証+Sheet3パーサ（既存の trySheetByName / trySheet3HistoryByName と同じ）
        if (s3Ranks.length === 0 && validateA1ByName(csv.headerText, loc.key)) {
          s3Ranks = parseRanks(csv.headerText, csv.dataText);
        }
        if (s3Hist.labels.length === 0 && validateA1Sheet3Name(csv.headerText, loc.key)) {
          s3Hist = parseRanksHistorySheet3(csv.headerText, csv.dataText);
        }
      } else if (loc.kind === "s3gid") {
        const csv = await fetchSheetCsv(SHEETS[2].id, `gid=${loc.key}`);
        if (!csv) return false;
        if (s3Ranks.length === 0) s3Ranks = parseRanksSheet3(csv.headerText, csv.dataText);
        if (s3Hist.labels.length === 0) s3Hist = parseRanksHistorySheet3(csv.headerText, csv.dataText);
      } else return false;
      return s3Ranks.length > 0 || s3Hist.labels.length > 0;
    };
    const done = () => s3Hist.labels.length > 0;

    if (cachedLocs.s3) {
      if (await tryLoc(cachedLocs.s3)) s3Loc = cachedLocs.s3;
      if (done()) return;
    }
    for (const tabName of variants) {
      if (done()) return;
      if (await tryLoc({ kind: "s3name", key: tabName })) s3Loc = { kind: "s3name", key: tabName };
    }
    if (!done()) {
      try {
        const tabMap3 = await fetchTabGidMap(SHEETS[2].id);
        const matched3 = findMatchingTabs(shopName, tabMap3);
        for (const tab of matched3) {
          if (done()) return;
          if (await tryLoc({ kind: "s3gid", key: tab.gid })) s3Loc = { kind: "s3gid", key: tab.gid };
        }
      } catch {}
    }
  };

  await Promise.all([searchMain(), searchS3()]);

  if (mainLoc || s3Loc) {
    tabLocationCache.set(shopName, { locs: { main: mainLoc, s3: s3Loc }, ts: Date.now() });
  } else {
    tabLocationCache.delete(shopName);
  }

  return {
    ranks: mainRanks.length > 0 ? mainRanks : s3Ranks,
    history: mergeHistories(mainHist, s3Hist),
  };
}

export async function fetchRankingFromSheets(shopName: string): Promise<RankEntry[]> {
  const variants = generateNameVariants(shopName);

  // Sheet1: タブ名=店舗名で直接アクセス
  for (const tabName of variants) {
    const ranks = await trySheetByName(SHEETS[0].id, tabName);
    if (ranks.length > 0) return ranks;
  }

  // Sheet2: タブ名→gidマッピングで検索
  try {
    const tabMap = await fetchTabGidMap(SHEETS[1].id);
    const matchedTabs = findMatchingTabs(shopName, tabMap);
    for (const tab of matchedTabs) {
      const ranks = await trySheetByGid(SHEETS[1].id, tab.gid, shopName);
      if (ranks.length > 0) return ranks;
    }
  } catch {}

  // Sheet3: タブ名=店舗名で直接アクセス → gidフォールバック
  for (const tabName of variants) {
    const ranks = await trySheetByName(SHEETS[2].id, tabName);
    if (ranks.length > 0) return ranks;
  }
  try {
    const tabMap3 = await fetchTabGidMap(SHEETS[2].id);
    const matched3 = findMatchingTabs(shopName, tabMap3);
    for (const tab of matched3) {
      const ranks = await trySheet3ByGid(SHEETS[2].id, tab.gid, shopName);
      if (ranks.length > 0) return ranks;
    }
  } catch {}

  return [];
}

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

async function trySheetByName(sheetId: string, tabName: string): Promise<RankEntry[]> {
  try {
    const encoded = encodeURIComponent(tabName);
    const headerRes = await fetch(
      `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encoded}&range=A1:AZ1`,
      { headers: { "User-Agent": UA }, redirect: "follow" }
    );
    if (!headerRes.ok) return [];
    const headerText = await headerRes.text();
    if (headerText.includes("<!DOCTYPE") || headerText.includes("<html")) return [];

    const headerRow = parseCSVRow(headerText.split("\n")[0] || "");
    const a1 = (headerRow[0] || "").trim();
    if (a1 !== tabName && a1 !== tabName.replace(/\s+/g, " ").trim()) {
      if (["最終", "店舗名", "ビジネスプロフィール"].includes(a1)) return [];
    }

    const dataRes = await fetch(
      `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encoded}`,
      { headers: { "User-Agent": UA }, redirect: "follow" }
    );
    if (!dataRes.ok) return [];
    const dataText = await dataRes.text();

    return parseRanks(headerText, dataText);
  } catch { return []; }
}

async function trySheetByGid(sheetId: string, gid: string, shopName: string): Promise<RankEntry[]> {
  try {
    const headerRes = await fetch(
      `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}&range=A1:AZ1`,
      { headers: { "User-Agent": UA }, redirect: "follow" }
    );
    if (!headerRes.ok) return [];
    const headerText = await headerRes.text();
    if (headerText.includes("<!DOCTYPE") || headerText.includes("<html")) return [];

    // A1で店舗名検証
    const a1Row = parseCSVRow(headerText.split("\n")[0] || "");
    const a1 = (a1Row[0] || "").trim();
    if (a1 && !shopName.includes(a1) && !a1.includes(shopName)) return [];

    const dataRes = await fetch(
      `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}`,
      { headers: { "User-Agent": UA }, redirect: "follow" }
    );
    if (!dataRes.ok) return [];
    const dataText = await dataRes.text();

    return parseRanks(headerText, dataText);
  } catch { return []; }
}

let tabMapCache: { map: Map<string, string>; ts: number; sheetId: string } | null = null;

function decodeJsEscapes(s: string): string {
  return s
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\\//g, "/");
}

export async function fetchTabGidMap(sheetId: string): Promise<Map<string, string>> {
  if (tabMapCache && tabMapCache.sheetId === sheetId && Date.now() - tabMapCache.ts < 1800000) return tabMapCache.map;
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/htmlview`, {
    headers: { "User-Agent": UA }, redirect: "follow",
  });
  if (!res.ok) return new Map();
  const html = await res.text();
  const map = new Map<string, string>();
  const regex = /name:\s*"([^"]+)"[^}]*?gid:\s*"(\d+)"/g;
  let match;
  while ((match = regex.exec(html)) !== null) map.set(decodeJsEscapes(match[1]), match[2]);
  tabMapCache = { map, ts: Date.now(), sheetId };
  return map;
}

function findMatchingTabs(shopName: string, tabMap: Map<string, string>): { name: string; gid: string }[] {
  const normalized = shopName.replace(/\s+/g, " ").trim();
  for (const [name, gid] of Array.from(tabMap.entries())) {
    if (name === normalized || name === shopName) return [{ name, gid }];
  }
  const results: { name: string; gid: string; len: number }[] = [];
  for (const [name, gid] of Array.from(tabMap.entries())) {
    if (name.match(/全店舗|ひな型|kw\s|シート|まとめ|P-MAX|口コミ|◯△|レディース|メンズ/)) continue;
    if (normalized.includes(name) || shopName.includes(name)) {
      results.push({ name, gid, len: name.length });
    }
  }
  if (results.length > 0) {
    results.sort((a, b) => b.len - a.len);
    return results;
  }
  for (const [name, gid] of Array.from(tabMap.entries())) {
    if (name.includes(normalized) || name.includes(shopName)) {
      results.push({ name, gid, len: name.length });
    }
  }
  return results;
}

function parseRanksHistory(headerText: string, dataText: string): RankHistoryData {
  const headerRow = parseCSVRow(headerText.split("\n").filter(l => l.trim())[0] || "");
  const kwIndices = getKwIndices(headerRow);
  if (kwIndices.length === 0) return { labels: [], datasets: [] };

  const dataLines = dataText.split("\n").filter(l => l.trim());
  if (dataLines.length < 2) return { labels: [], datasets: [] };
  const dataRows = dataLines.slice(1).map(l => parseCSVRow(l));

  // 日付パース+ソート（シートの行順に依存しない）
  const allMonths: { label: string; row: string[]; date: Date }[] = [];
  for (const row of dataRows) {
    const dateCell = (row[1] || "").trim();
    const m = dateCell.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
    if (m) {
      allMonths.push({
        label: `${m[1]}/${parseInt(m[2])}`,
        row,
        date: new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3])),
      });
    } else {
      // "2026/5" のような日なしフォーマットにも対応
      const m2 = dateCell.match(/(\d{4})[\/年](\d{1,2})/);
      if (m2) {
        allMonths.push({
          label: `${m2[1]}/${parseInt(m2[2])}`,
          row,
          date: new Date(parseInt(m2[1]), parseInt(m2[2]) - 1, 1),
        });
      }
    }
  }

  // 月ごとに最新の行だけ残す（重複排除）+ 日付順ソート
  const monthMap = new Map<string, { label: string; row: string[]; date: Date }>();
  for (const r of allMonths) {
    const existing = monthMap.get(r.label);
    if (!existing || r.date > existing.date) {
      monthMap.set(r.label, r);
    }
  }
  const sorted = Array.from(monthMap.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
  const recent = sorted.slice(-13);

  const labels = recent.map(m => m.label);
  const datasets = kwIndices.map(idx => {
    const word = (headerRow[idx] || "").trim();
    const ranks = recent.map(m => {
      const val = (m.row[idx] || "").trim();
      if (val === "圏外") return null;
      const v = parseInt(val.replace(/,/g, "")) || 0;
      return v > 0 ? v : null;
    });
    return { word, ranks };
  });

  return { labels, datasets };
}

// ── Sheet3専用パーサー（KW=F列〜、地域別行あり） ──

async function trySheet3ByGid(sheetId: string, gid: string, shopName: string): Promise<RankEntry[]> {
  try {
    const headerRes = await fetch(
      `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}&range=A1:AZ1`,
      { headers: { "User-Agent": UA }, redirect: "follow" }
    );
    if (!headerRes.ok) return [];
    const headerText = await headerRes.text();
    if (headerText.includes("<!DOCTYPE") || headerText.includes("<html")) return [];
    const dataRes = await fetch(
      `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}`,
      { headers: { "User-Agent": UA }, redirect: "follow" }
    );
    if (!dataRes.ok) return [];
    return parseRanksSheet3(headerText, await dataRes.text());
  } catch { return []; }
}

/** Sheet3のデータ行をフィルタ: [平均]行 or 地域指定なし行のみ使用 */
function filterSheet3Rows(dataRows: string[][]): string[][] {
  return dataRows.filter(row => {
    const a = (row[0] || "").trim();
    const b = (row[1] || "").trim();
    // [平均]行を優先
    if (a === "[平均]") return true;
    // A列が空でB列に日付がある行（地域指定なしの単独計測）
    if (!a && b && /\d{4}\//.test(b)) return true;
    return false;
  });
}

/** Sheet3: 月ごとに最新の[平均]行を1つだけ残す（重複排除） */
function dedupeByMonth(rows: { label: string; row: string[]; date: Date }[]): { label: string; row: string[] }[] {
  const map = new Map<string, { label: string; row: string[]; date: Date }>();
  for (const r of rows) {
    const existing = map.get(r.label);
    if (!existing || r.date > existing.date) {
      map.set(r.label, r);
    }
  }
  // 月の数値ソート
  return Array.from(map.values()).sort((a, b) => {
    const [ay, am] = a.label.split("/").map(Number);
    const [by, bm] = b.label.split("/").map(Number);
    return (ay * 100 + am) - (by * 100 + bm);
  });
}

function parseRanksSheet3(headerText: string, dataText: string): RankEntry[] {
  const headerRow = parseCSVRow(headerText.split("\n").filter(l => l.trim())[0] || "");
  const kwIndices = getKwIndices(headerRow);
  if (kwIndices.length === 0) return [];

  const dataLines = dataText.split("\n").filter(l => l.trim());
  if (dataLines.length < 2) return [];
  const allRows = dataLines.slice(1).map(l => parseCSVRow(l));
  const filtered = filterSheet3Rows(allRows);
  if (filtered.length === 0) return [];

  // 最新行と前月行
  const targetRow = filtered[filtered.length - 1];
  const prevRow = filtered.length >= 2 ? filtered[filtered.length - 2] : null;

  const ranks: RankEntry[] = [];
  for (const idx of kwIndices) {
    const word = (headerRow[idx] || "").trim();
    if (!word) continue;
    const val = (targetRow[idx] || "").trim();
    const rank = val === "圏外" ? 0 : (parseInt(val.replace(/,/g, "")) || 0);
    const prevVal = prevRow ? (prevRow[idx] || "").trim() : "";
    const prevRank = prevVal === "圏外" ? 0 : (parseInt(prevVal.replace(/,/g, "")) || 0);
    if (rank > 0) ranks.push({ word, rank, prevRank: prevRank || rank });
  }
  return ranks;
}

function parseRanksHistorySheet3(headerText: string, dataText: string): RankHistoryData {
  const headerRow = parseCSVRow(headerText.split("\n").filter(l => l.trim())[0] || "");
  const kwIndices = getKwIndices(headerRow);
  if (kwIndices.length === 0) return { labels: [], datasets: [] };

  const dataLines = dataText.split("\n").filter(l => l.trim());
  if (dataLines.length < 2) return { labels: [], datasets: [] };
  const allRows = dataLines.slice(1).map(l => parseCSVRow(l));
  const filtered = filterSheet3Rows(allRows);

  // 月ラベル抽出（日付に時刻が含まれる場合あり: "2026/5/25 12:43"）
  const allMonths: { label: string; row: string[]; date: Date }[] = [];
  for (const row of filtered) {
    const dateCell = (row[1] || "").trim();
    const m = dateCell.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
    if (m) {
      allMonths.push({
        label: `${m[1]}/${parseInt(m[2])}`,
        row,
        date: new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3])),
      });
    }
  }

  const deduped = dedupeByMonth(allMonths);
  const recent = deduped.slice(-13);

  const labels = recent.map(m => m.label);
  const datasets = kwIndices.map(idx => {
    const word = (headerRow[idx] || "").trim();
    const ranks = recent.map(m => {
      const val = (m.row[idx] || "").trim();
      if (val === "圏外") return null;
      const v = parseInt(val.replace(/,/g, "")) || 0;
      return v > 0 ? v : null;
    });
    return { word, ranks };
  });

  return { labels, datasets };
}

function getKwIndices(headerRow: string[]): number[] {
  const indices: number[] = [];
  for (let i = 0; i < headerRow.length; i++) {
    const cell = (headerRow[i] || "").trim();
    if (!cell || NON_KW_HEADERS.has(cell)) continue;
    if (cell.includes("前月比") || cell.includes("※")) continue;
    if (/^#(REF|VALUE|DIV)/.test(cell)) continue;
    if (/^\d+(\.\d+)?$/.test(cell)) continue;
    if (/^\d{4}年\d{1,2}月$/.test(cell)) continue;
    if (i === 0) continue;
    indices.push(i);
  }
  return indices;
}

function parseRanks(headerText: string, dataText: string): RankEntry[] {
  const headerRow = parseCSVRow(headerText.split("\n").filter(l => l.trim())[0] || "");
  const kwIndices = getKwIndices(headerRow);
  if (kwIndices.length === 0) return [];

  const dataLines = dataText.split("\n").filter(l => l.trim());
  if (dataLines.length < 2) return [];
  const dataRows = dataLines.slice(1).map(l => parseCSVRow(l));

  // 日付でソートして最新行と前月行を取得（シートの行順に依存しない）
  const dated: { date: Date; row: string[] }[] = [];
  for (const row of dataRows) {
    const dateCell = (row[1] || "").trim();
    const m = dateCell.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
    if (m) {
      dated.push({ date: new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3])), row });
    }
  }
  if (dated.length === 0) return [];
  dated.sort((a, b) => a.date.getTime() - b.date.getTime());

  const targetRow = dated[dated.length - 1].row;
  const prevRow = dated.length >= 2 ? dated[dated.length - 2].row : null;

  const ranks: RankEntry[] = [];
  for (const idx of kwIndices) {
    const word = (headerRow[idx] || "").trim();
    if (!word) continue;
    const val = (targetRow[idx] || "").trim();
    const rank = val === "圏外" ? 0 : (parseInt(val.replace(/,/g, "")) || 0);
    const prevVal = prevRow ? (prevRow[idx] || "").trim() : "";
    const prevRank = prevVal === "圏外" ? 0 : (parseInt(prevVal.replace(/,/g, "")) || 0);
    if (rank > 0) ranks.push({ word, rank, prevRank: prevRank || rank });
  }

  return ranks;
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
      else break;
    }
  }
  return cells;
}
