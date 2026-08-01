/**
 * レポート表示用ユーティリティ関数
 * client.tsxから抽出したテスト可能なロジック
 */

// ── 型定義 ──

import type { KPI } from "./report-data";
export type { KPI };

export interface PctChangeResult {
  pct: number;
  text: string;
  isUp: boolean;
  isFlat: boolean;
}

// ── 定数 ──

export const SLIDE_W = 1123;
export const SLIDE_H = 794;

export const COLORS = {
  primary: "#0f3460",
  accent: "#e94560",
  danger: "#d32f2f",
  positive: "#0a8f3c",
  negative: "#c0392b",
  neutral: "#888",
  rank1to3: "#2563EB",   // 青
  rank4to10: "#16A34A",  // 緑
  rank11to20: "#F59E0B", // 黄
  rank21plus: "#EF4444", // 赤
  rankOut: "#6B7280",    // グレー
  // ダークバリアント（テーブル用）
  rank1to3Dark: "#1d4ed8",
  rank4to10Dark: "#15803d",
  rank11to20Dark: "#b45309",
} as const;

export const CHART_COLORS = {
  searchMobile: "rgba(79,195,247,.75)",
  searchPC: "rgba(2,136,209,.75)",
  mapMobile: "rgba(129,199,132,.75)",
  mapPC: "rgba(56,142,60,.75)",
  websites: "rgba(255,183,77,.75)",
  routes: "rgba(186,104,200,.75)",
  foodMenus: "rgba(77,182,172,.75)",
  bookings: "rgba(121,134,203,.75)",
  reviewLine: "#fbc02d",
  reviewFill: "rgba(251,192,45,.35)",
  deltaGreen: "rgba(39,174,96,.75)",
  deltaYellow: "rgba(251,192,45,.75)",
  deltaRed: "rgba(229,115,115,.75)",
  deltaGray: "rgba(200,200,200,.4)",
} as const;

export const AI_COMMENT_HEADINGS = ["数値分析", "口コミ傾向と強み", "改善策", "改善点", "施策提案"];

export const SEARCH_QUERIES_PER_PAGE = 20;

/** AIコメント1ページの収容量（推定19行 × 1行52文字の実効量。テーブル行余白込みでスライドに収まる上限） */
export const AI_CHARS_PER_PAGE = 19 * 52;

// ── 関数 ──

/** 前月比の計算 */
export function pctChange(cur: number, prev: number): PctChangeResult {
  if (prev === 0 && cur === 0) return { pct: 0, text: "±0.0%", isUp: true, isFlat: true };
  // 前月0からの増加は%が定義できない（「+∞」は顧客向け表示として不適切なため実数を表示）
  if (prev === 0) return { pct: 999, text: `+${cur.toLocaleString()}`, isUp: true, isFlat: false };
  const pct = ((cur - prev) / prev) * 100;
  const isFlat = Math.abs(pct) < 0.05;
  return { pct, text: isFlat ? "+0.0%" : `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`, isUp: pct >= 0, isFlat };
}

// 月比較の実装は month-utils.ts が単一情報源（文字列比較の罠を1箇所に閉じ込めるため）
export { monthToNum, compareMonths, normalizeMonthLabel } from "./month-utils";
import { monthToNum } from "./month-utils";

/** "2025年8月" / "2025/8" / "2025-08-01" などを "2025/8" に正規化。解釈できなければ null */
export function parseStartMonth(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = String(s).match(/(\d{4})\s*[年/\-.]\s*(\d{1,2})/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]);
  if (!y || mo < 1 || mo > 12) return null;
  return `${y}/${mo}`;
}

/**
 * 前年同月比を出してよいかの判定。
 *
 * 【重要】対策開始前の月はGBPデータが未取得（0件）か断片的なため、
 * そのまま比較すると「+116325.0%（4→4,657）」のような無意味な数字になる（2026-07-31 発見）。
 * 対策開始月より前の前年同月とは比較しない。
 *
 * @param yoyValue  前年同月の値
 * @param curLabel  当月ラベル "2026/6"
 * @param startDate 対策開始日（"2025年8月" 等の表記ゆれを許容）
 */
export function isYoyComparable(
  yoyValue: number | null | undefined,
  curLabel: string,
  startDate?: string | null,
): boolean {
  if (yoyValue == null || yoyValue <= 0) return false; // 0基準の増減率は定義できない
  const parts = String(curLabel).split("/").map(Number);
  if (!parts[0] || !parts[1]) return false;
  const yoyMonth = `${parts[0] - 1}/${parts[1]}`;
  const start = parseStartMonth(startDate);
  // 対策開始月「以前」は比較しない（< でなく <=）。
  // 開始月は月の途中から計測が始まる不完全データのため、そこと比較すると
  // 「+3989.4%（1,632→66,739）」のような誇張された前年比になる（2026-08-01 CHILLRI堀江店）。
  // 開始翌月以降＝フルに計測された月とだけ比較する
  if (start && monthToNum(yoyMonth) <= monthToNum(start)) return false;
  return true;
}

/** ランク → マーカー色 */
export function rankColor(rank: number): string {
  if (rank <= 0) return COLORS.rankOut;
  if (rank <= 3) return COLORS.rank1to3;
  if (rank <= 10) return COLORS.rank4to10;
  if (rank <= 20) return COLORS.rank11to20;
  return COLORS.rank21plus;
}

/** ランク → テーブルテキスト色（ダークバリアント） */
export function rankTextColor(rank: number): string {
  if (rank <= 0) return "#999";
  if (rank <= 3) return COLORS.rank1to3Dark;
  if (rank <= 10) return COLORS.rank4to10Dark;
  if (rank <= 20) return COLORS.rank11to20Dark;
  return "#999";
}

/** 多地点平均順位の表示文字列。avgRank<=0 は「全地点圏外」を意味するため数値として表示しない */
export function fmtAvgRank(v: number | null | undefined): string {
  if (v == null) return "-";
  return v > 0 ? String(v) : "圏外";
}

/**
 * 多地点平均順位の変動表示。圏外(0以下)を数値として比較しない。
 * @deprecated 隣接2値だけを見るため「当月未計測」を表現できない。
 *   月系列がある場合は rankTrend() を使うこと（最新列基準で圏外/未計測を正しく出し分ける）
 */
export function avgRankDiff(
  prev: number | null | undefined,
  cur: number | null | undefined,
): { text: string; color: string } {
  const GREEN = "#0a8f3c", RED = "#c0392b", GRAY = "#888";
  if (prev == null || cur == null) return { text: "-", color: GRAY };
  if (prev > 0 && cur > 0) {
    const d = prev - cur;
    if (d > 0) return { text: `↑${d.toFixed(1)}`, color: GREEN };
    if (d < 0) return { text: `↓${Math.abs(d).toFixed(1)}`, color: RED };
    return { text: "→", color: GRAY };
  }
  if (prev > 0 && cur <= 0) return { text: "圏外へ", color: RED };
  if (prev <= 0 && cur > 0) return { text: "圏内復帰", color: GREEN };
  return { text: "→", color: GRAY };
}

/**
 * 順位系列の「変動」。
 *
 * 【重要】null（データなし）を除外してから末尾2件を比較してはいけない。
 * 2026-07-31 発見のバグ: ranks=[3,7,null,1,null]（当月データなし）で
 * null除外後の [3,7,1] の末尾2件を比較し、2月(7位)→4月(1位)の差を
 * 当月の変動「↑6」として緑表示していた。圏外/未計測への転落が「改善」に見える。
 * 変動は必ず「最新列」を基準にし、比較相手だけを過去に遡って探すこと。
 *
 * @param series  月順の順位（null=データなし、0以下=圏外）
 * @param measured 各月に計測が存在したか。省略時は「順位>0の月のみ計測済み」とみなす
 */
export interface RankTrendResult {
  text: string;
  color: string;
  /** 比較相手の月インデックス。見つからない場合 -1 */
  prevIndex: number;
  kind: "up" | "down" | "flat" | "out" | "first" | "none";
}

export function rankTrend(
  series: (number | null | undefined)[],
  measured?: boolean[],
  decimals = 0,
): RankTrendResult {
  const GREEN = "#0a8f3c", RED = "#c0392b", GRAY = "#888";
  const NONE: RankTrendResult = { text: "-", color: GRAY, prevIndex: -1, kind: "none" };
  if (!series || series.length === 0) return NONE;

  const last = series.length - 1;
  const cur = series[last];
  const curRanked = cur != null && cur > 0;

  // 比較相手は「最新列より前で順位が付いている直近の月」
  let prevIndex = -1;
  for (let i = last - 1; i >= 0; i--) {
    const v = series[i];
    if (v != null && v > 0) { prevIndex = i; break; }
  }
  const prev = prevIndex >= 0 ? (series[prevIndex] as number) : null;

  if (curRanked && prev != null) {
    const d = prev - (cur as number);
    const abs = Math.abs(d).toFixed(decimals);
    if (Number(abs) === 0) return { text: "→", color: GRAY, prevIndex, kind: "flat" };
    return d > 0
      ? { text: `↑${abs}`, color: GREEN, prevIndex, kind: "up" }
      : { text: `↓${abs}`, color: RED, prevIndex, kind: "down" };
  }
  if (curRanked) {
    // 過去に順位は無いが計測はしていた（＝圏外だった）なら「初計測」ではなく「圏内復帰」。
    // 圏外→1位の大躍進を中立の「初計測」と表示していた（2026-08-01 CHILLRI堀江店で発覚）
    if (measured) {
      for (let i = last - 1; i >= 0; i--) {
        if (measured[i]) return { text: "圏内復帰", color: GREEN, prevIndex: i, kind: "up" };
      }
    }
    // 本当に今回が最初の計測
    return { text: "初計測", color: GRAY, prevIndex: -1, kind: "first" };
  }

  // 当月に順位が無い。計測済みなら「圏外へ」、未計測なら断定しない
  const curMeasured = measured ? measured[last] === true : false;
  if (prev != null) {
    return curMeasured
      ? { text: "圏外へ", color: RED, prevIndex, kind: "out" }
      : { text: "未計測", color: GRAY, prevIndex, kind: "none" };
  }
  return curMeasured ? { text: "圏外", color: GRAY, prevIndex: -1, kind: "none" } : NONE;
}

/**
 * 多地点計測の圏内率。
 * avgRank は圏内地点のみの平均（report-api.ts / spreadsheet.ts で rank>0 のみを平均）なので、
 * 「49地点中45地点が圏外でも平均26.5位」と表示されてしまう。
 * 平均順位を出す場所では必ずこの圏内率を併記すること。
 */
export function rankCoverage(
  results: { rank: number }[] | null | undefined,
): { ranked: number; total: number; pct: number } | null {
  if (!results || results.length === 0) return null;
  const ranked = results.filter(r => r.rank > 0).length;
  return { ranked, total: results.length, pct: Math.round((ranked / results.length) * 100) };
}

/** ランク → モーダル用の背景色+テキスト色 */
export function rankColorModal(rank: number): { bg: string; color: string } {
  if (rank <= 0) return { bg: "rgba(156,163,175,0.3)", color: "#9ca3af" };
  if (rank <= 3) return { bg: "rgba(37,99,235,0.3)", color: "#2563eb" };
  if (rank <= 10) return { bg: "rgba(22,163,74,0.3)", color: "#16a34a" };
  if (rank <= 20) return { bg: "rgba(245,158,11,0.3)", color: "#f59e0b" };
  return { bg: "rgba(239,68,68,0.3)", color: "#ef4444" };
}

/** 月間口コミ増加数の色 */
export function reviewDeltaColor(value: number): string {
  if (value >= 20) return CHART_COLORS.deltaGreen;
  if (value >= 10) return CHART_COLORS.deltaYellow;
  if (value > 0) return CHART_COLORS.deltaRed;
  return CHART_COLORS.deltaGray;
}

/** KPI配列の並べ替え（マップを検索より先に） */
export function reorderKpis(kpis: KPI[]): KPI[] {
  const result = [...kpis];
  const mapIdx = result.findIndex(k => k.label === "Googleマップ 合計");
  const searchIdx = result.findIndex(k => k.label === "Google検索 合計");
  if (mapIdx > 0 && searchIdx === 0) {
    const [search] = result.splice(searchIdx, 1);
    result.splice(mapIdx, 0, search);
  }
  return result;
}

/** AIコメントの整形 */
export function formatAIComment(comment: string, shopRating: number): string {
  let c = comment;
  if (shopRating > 0) {
    c = c.replace(/\d\.\d(\s*\/\s*5\.0)/g, `${shopRating}$1`);
  }
  // 既存の【見出し】を除去（client側で統一付与するため）
  c = c.replace(/^【[^】]*】\s*/g, "");
  // 箇条書き「・」を改行に
  c = c.replace(/(^|[^<])・/gm, '$1<br>・');
  // a) b) c) を改行に
  c = c.replace(/([^<])\s*([a-z]\))/g, '$1<br>$2');
  // ①②③を改行に
  c = c.replace(/([^（(])([①②③④⑤⑥⑦⑧⑨⑩])/g, "$1<br>$2");
  // (1)(2)を改行に
  c = c.replace(/(.)\s*(\(\d+\))/g, "$1<br>$2");
  // 先頭の<br>を除去
  c = c.replace(/^(<br>)+/, "");
  return c;
}

/** AIコメント詳細セルの1行あたり文字数の目安（15pxフォント・実効幅約780px） */
const AI_COMMENT_CHARS_PER_LINE = 52;

/**
 * 1コメント項目の推定表示行数。
 * formatAIComment が「・」「a)」等で改行するのと同じ位置で分割し、折り返し行数も加算する。
 * （純粋な文字数だと箇条書きの改行・折り返しを無視してしまい、
 *   800字以下でもスライドから溢れるケースがあった: 2026-07-16 新橋店P15）
 */
function estimateCommentLines(comment: string): number {
  const plain = (comment || "").replace(/<[^>]*>/g, "");
  const segments = plain
    .replace(/・/g, "\n・")
    .replace(/\s*([a-z]\))/g, "\n$1")
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean);
  if (segments.length === 0) return 1;
  return segments.reduce((sum, s) => sum + Math.max(1, Math.ceil(s.length / AI_COMMENT_CHARS_PER_LINE)), 0);
}

/** AIコメントのページ分割（推定表示行数ベース。charsPerPage は「行数×1行文字数」の実効量） */
export function splitCommentPages(
  comments: string[],
  charsPerPage: number = AI_CHARS_PER_PAGE
): { start: number; end: number }[] {
  const pages: { start: number; end: number }[] = [];
  let ci = 0;
  while (ci < comments.length) {
    let charCount = 0;
    let end = ci;
    while (end < comments.length) {
      const len = estimateCommentLines(comments[end]) * AI_COMMENT_CHARS_PER_LINE;
      if (end > ci && charCount + len > charsPerPage) break;
      charCount += len;
      end++;
    }
    pages.push({ start: ci, end });
    ci = end;
  }
  if (pages.length === 0) pages.push({ start: 0, end: 0 });
  return pages;
}

/**
 * グリッド計測結果から中心セル（=店舗位置）を取得する。
 * 偶数グリッド（斜め4地点計測 gridSize=2 など）には中心セルが存在しないため undefined を返す。
 * ※ガード無しで Math.floor(gridSize/2) を使うと、gridSize=2 では (1,1)=南東の点を
 *   誤って「中心」として拾ってしまう（2026-07-29 4地点計測導入時の罠）
 */
export function centerCell<T extends { row: number; col: number }>(
  results: T[] | null | undefined,
  gridSize: number,
): T | undefined {
  if (!results || results.length === 0) return undefined;
  if (gridSize % 2 === 0) return undefined; // 偶数グリッドに中心は無い
  const c = Math.floor(gridSize / 2);
  return results.find(r => r.row === c && r.col === c);
}

/**
 * 計測レイアウトの表示ラベル。
 * gridSize=2 → 旧「4地点」計測、gridSize=3かつ5点 → 「5地点」計測（中心＋外周4点）、
 * それ以外（旧3×3全9点・7×7等）→ 「N×N」。
 */
export function gridLayoutLabel(gridSize: number, pointCount: number): string {
  if (gridSize === 2) return "4地点";
  if (gridSize === 3 && pointCount === 5) return "5地点";
  return `${gridSize}×${gridSize}`;
}

/** diff表示の色 */
export function diffColor(d: number | null): string {
  if (d === null) return "#ccc";
  if (d > 0) return COLORS.positive;
  if (d < 0) return COLORS.negative;
  return COLORS.neutral;
}

/** diff表示のフォーマット */
export function formatDiff(d: number | null): string {
  if (d === null) return "-";
  if (d > 0) return `+${d.toLocaleString()}`;
  if (d === 0) return "→";
  return d.toLocaleString();
}
