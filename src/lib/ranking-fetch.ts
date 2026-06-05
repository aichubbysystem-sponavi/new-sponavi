/**
 * スプレッドシートからキーワード順位を直接取得（HTTP自己呼び出し不要）
 */

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

export async function fetchRankingHistoryFromSheets(shopName: string): Promise<RankHistoryData> {
  const variants = generateNameVariants(shopName);

  for (const tabName of variants) {
    const history = await trySheetHistoryByName(SHEETS[0].id, tabName);
    if (history.labels.length > 0) return history;
  }

  try {
    const tabMap = await fetchTabGidMap(SHEETS[1].id);
    const matchedTabs = findMatchingTabs(shopName, tabMap);
    for (const tab of matchedTabs) {
      const history = await trySheetHistoryByGid(SHEETS[1].id, tab.gid, shopName);
      if (history.labels.length > 0) return history;
    }
  } catch {}

  // Sheet3: タブ名で直接アクセス → gidフォールバック
  for (const tabName of variants) {
    const history = await trySheet3HistoryByName(SHEETS[2].id, tabName);
    if (history.labels.length > 0) return history;
  }
  try {
    const tabMap3 = await fetchTabGidMap(SHEETS[2].id);
    const matched3 = findMatchingTabs(shopName, tabMap3);
    for (const tab of matched3) {
      const history = await trySheet3HistoryByGid(SHEETS[2].id, tab.gid, shopName);
      if (history.labels.length > 0) return history;
    }
  } catch {}

  return { labels: [], datasets: [] };
}

async function trySheetHistoryByName(sheetId: string, tabName: string): Promise<RankHistoryData> {
  try {
    const encoded = encodeURIComponent(tabName);
    const headerRes = await fetch(
      `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encoded}&range=A1:AZ1`,
      { headers: { "User-Agent": UA }, redirect: "follow" }
    );
    if (!headerRes.ok) return { labels: [], datasets: [] };
    const headerText = await headerRes.text();
    if (headerText.includes("<!DOCTYPE") || headerText.includes("<html")) return { labels: [], datasets: [] };
    const headerRow = parseCSVRow(headerText.split("\n")[0] || "");
    const a1 = (headerRow[0] || "").trim();
    if (a1 !== tabName && a1 !== tabName.replace(/\s+/g, " ").trim()) {
      if (["最終", "店舗名", "ビジネスプロフィール"].includes(a1)) return { labels: [], datasets: [] };
    }
    const dataRes = await fetch(
      `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encoded}`,
      { headers: { "User-Agent": UA }, redirect: "follow" }
    );
    if (!dataRes.ok) return { labels: [], datasets: [] };
    return parseRanksHistory(headerText, await dataRes.text());
  } catch { return { labels: [], datasets: [] }; }
}

async function trySheetHistoryByGid(sheetId: string, gid: string, shopName: string): Promise<RankHistoryData> {
  try {
    const headerRes = await fetch(
      `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}&range=A1:AZ1`,
      { headers: { "User-Agent": UA }, redirect: "follow" }
    );
    if (!headerRes.ok) return { labels: [], datasets: [] };
    const headerText = await headerRes.text();
    if (headerText.includes("<!DOCTYPE") || headerText.includes("<html")) return { labels: [], datasets: [] };
    const a1Row = parseCSVRow(headerText.split("\n")[0] || "");
    const a1 = (a1Row[0] || "").trim();
    if (a1 && !shopName.includes(a1) && !a1.includes(shopName)) return { labels: [], datasets: [] };
    const dataRes = await fetch(
      `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}`,
      { headers: { "User-Agent": UA }, redirect: "follow" }
    );
    if (!dataRes.ok) return { labels: [], datasets: [] };
    return parseRanksHistory(headerText, await dataRes.text());
  } catch { return { labels: [], datasets: [] }; }
}

function parseRanksHistory(headerText: string, dataText: string): RankHistoryData {
  const headerRow = parseCSVRow(headerText.split("\n").filter(l => l.trim())[0] || "");
  const kwIndices = getKwIndices(headerRow);
  if (kwIndices.length === 0) return { labels: [], datasets: [] };

  const dataLines = dataText.split("\n").filter(l => l.trim());
  if (dataLines.length < 2) return { labels: [], datasets: [] };
  const dataRows = dataLines.slice(1).map(l => parseCSVRow(l));

  // 月ラベルと順位を全行分取得（直近13ヶ月＝前年同月含む）
  const allMonths: { label: string; row: string[] }[] = [];
  for (const row of dataRows) {
    const dateCell = (row[1] || "").trim();
    const m = dateCell.match(/(\d{4})[\/年](\d{1,2})/);
    if (m) allMonths.push({ label: `${m[1]}/${parseInt(m[2])}`, row });
  }
  const recent = allMonths.slice(-13);

  const labels = recent.map(m => m.label);
  const datasets = kwIndices.map(idx => {
    const word = (headerRow[idx] || "").trim();
    const ranks = recent.map(m => {
      const v = parseInt((m.row[idx] || "0").replace(/,/g, "")) || 0;
      return v > 0 ? v : null;
    });
    return { word, ranks };
  });

  return { labels, datasets };
}

// ── Sheet3専用パーサー（KW=F列〜、地域別行あり） ──

async function trySheet3HistoryByName(sheetId: string, tabName: string): Promise<RankHistoryData> {
  try {
    const encoded = encodeURIComponent(tabName);
    const headerRes = await fetch(
      `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encoded}&range=A1:AZ1`,
      { headers: { "User-Agent": UA }, redirect: "follow" }
    );
    if (!headerRes.ok) return { labels: [], datasets: [] };
    const headerText = await headerRes.text();
    if (headerText.includes("<!DOCTYPE") || headerText.includes("<html")) return { labels: [], datasets: [] };
    // A1が店舗名と一致するか検証
    const headerRow = parseCSVRow(headerText.split("\n")[0] || "");
    const a1 = (headerRow[0] || "").trim();
    if (a1 !== tabName && a1 !== tabName.replace(/\s+/g, " ").trim()) {
      if (!tabName.includes(a1) && !a1.includes(tabName)) return { labels: [], datasets: [] };
    }
    const dataRes = await fetch(
      `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encoded}`,
      { headers: { "User-Agent": UA }, redirect: "follow" }
    );
    if (!dataRes.ok) return { labels: [], datasets: [] };
    return parseRanksHistorySheet3(headerText, await dataRes.text());
  } catch { return { labels: [], datasets: [] }; }
}

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

async function trySheet3HistoryByGid(sheetId: string, gid: string, shopName: string): Promise<RankHistoryData> {
  try {
    const headerRes = await fetch(
      `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}&range=A1:AZ1`,
      { headers: { "User-Agent": UA }, redirect: "follow" }
    );
    if (!headerRes.ok) return { labels: [], datasets: [] };
    const headerText = await headerRes.text();
    if (headerText.includes("<!DOCTYPE") || headerText.includes("<html")) return { labels: [], datasets: [] };
    const dataRes = await fetch(
      `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}`,
      { headers: { "User-Agent": UA }, redirect: "follow" }
    );
    if (!dataRes.ok) return { labels: [], datasets: [] };
    return parseRanksHistorySheet3(headerText, await dataRes.text());
  } catch { return { labels: [], datasets: [] }; }
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
