/**
 * 検索語句スプレッドシートからデータ取得
 * シート: 1tTpqYjGju0txvr6p5E--NSEzbNmysSIodCxcSGQyeW0
 * 月別タブ(YYYYMM): A=順位, B/C=店舗1(KW/検索数), D/E=店舗2...
 */

const SHEET_ID = "1tTpqYjGju0txvr6p5E--NSEzbNmysSIodCxcSGQyeW0";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

export interface SearchQueryMonth {
  month: string; // "2026/3"
  keywords: { word: string; count: number }[];
}

export interface SearchQueryData {
  months: SearchQueryMonth[];
  // 最新月のTOP20
  latestKeywords: { word: string; count: number }[];
  latestMonth: string;
}

let tabCache: { map: Map<string, string>; ts: number } | null = null;

async function getMonthlyTabs(): Promise<Map<string, string>> {
  if (tabCache && Date.now() - tabCache.ts < 3600000) return tabCache.map;

  try {
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/htmlview`, {
      headers: { "User-Agent": UA }, redirect: "follow",
    });
    if (!res.ok) return new Map();
    const html = await res.text();
    const map = new Map<string, string>();
    const regex = /name:\s*"([^"]+)"[^}]*?gid:\s*"(\d+)"/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
      const name = match[1];
      // 月別タブのみ(YYYYMM形式)
      if (/^\d{6}$/.test(name)) {
        map.set(name, match[2]);
      }
    }
    tabCache = { map, ts: Date.now() };
    return map;
  } catch {
    return new Map();
  }
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

async function fetchOneTab(tabName: string, gid: string, shopName: string): Promise<SearchQueryMonth | null> {
  try {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;
    const res = await fetch(url, { cache: "no-store", headers: { "User-Agent": UA }, redirect: "follow" });
    if (!res.ok) return null;

    const text = await res.text();
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return null;

    const headerRow = parseCSVRow(lines[0]);

    let kwColIdx = -1;
    let countColIdx = -1;
    for (let c = 0; c < headerRow.length; c++) {
      const h = (headerRow[c] || "").trim();
      if (h.startsWith("キーワード") && (h.includes(shopName) || shopNameMatch(h, shopName))) kwColIdx = c;
      if (h.startsWith("検索数") && (h.includes(shopName) || shopNameMatch(h, shopName))) countColIdx = c;
    }
    if (kwColIdx === -1 || countColIdx === -1) return null;

    const keywords: { word: string; count: number }[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVRow(lines[i]);
      const word = (cols[kwColIdx] || "").trim();
      const count = parseInt((cols[countColIdx] || "0").replace(/,/g, "")) || 0;
      if (word && word !== "キーワード") keywords.push({ word, count });
    }
    if (keywords.length === 0) return null;

    const year = tabName.slice(0, 4);
    const month = String(parseInt(tabName.slice(4)));
    return { month: `${year}/${month}`, keywords };
  } catch { return null; }
}

export async function fetchSearchQueries(shopName: string): Promise<SearchQueryData> {
  const tabs = await getMonthlyTabs();
  if (tabs.size === 0) return { months: [], latestKeywords: [], latestMonth: "" };

  const sortedTabs = Array.from(tabs.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  // 全タブを並列で取得（大幅高速化）
  const results = await Promise.all(
    sortedTabs.map(([tabName, gid]) => fetchOneTab(tabName, gid, shopName))
  );

  const months = results.filter((m): m is SearchQueryMonth => m !== null);
  const latestMonth = months.length > 0 ? months[months.length - 1] : null;

  return {
    months,
    latestKeywords: latestMonth ? latestMonth.keywords.slice(0, 30) : [],
    latestMonth: latestMonth?.month || "",
  };
}

function shopNameMatch(header: string, shopName: string): boolean {
  // "キーワード 有馬焼肉 丞 -TASUKU-" のようなヘッダーから店舗名を抽出
  const headerShop = header.replace(/^(キーワード|検索数)\s*/, "").trim();
  if (!headerShop) return false;
  // 完全一致 or 部分一致
  return shopName.includes(headerShop) || headerShop.includes(shopName);
}
