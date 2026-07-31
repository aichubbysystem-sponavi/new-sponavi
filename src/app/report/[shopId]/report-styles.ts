import type React from "react";
import { SLIDE_W, SLIDE_H, COLORS } from "@/lib/report-utils";

export const slideStyle: React.CSSProperties = {
  width: SLIDE_W, height: SLIDE_H, margin: "20px auto", background: "#f0f2f5",
  borderRadius: 8, overflow: "hidden", boxShadow: "0 8px 40px rgba(0,0,0,.4)",
  display: "flex", flexDirection: "column", position: "relative",
  pageBreakAfter: "always", pageBreakInside: "avoid",
};

export const slideBarStyle: React.CSSProperties = {
  background: `linear-gradient(135deg,#1a1a2e,${COLORS.primary})`, color: "#fff",
  padding: "12px 9px", fontSize: 16, fontWeight: 700,
  display: "flex", justifyContent: "space-between", alignItems: "center",
  flexShrink: 0, letterSpacing: 0.5,
};

export const slideBodyStyle: React.CSSProperties = {
  flex: 1, padding: "28px 9px", display: "flex", flexDirection: "column",
  justifyContent: "center", overflow: "hidden",
  // flexのmin-height:auto既定値だと中身が多いときbodyがスライドの外まで伸びて
  // 枠線ごと切れる（ページからはみ出す）。0にして必ずスライド内でクリップする
  minHeight: 0,
};

export const stitleStyle: React.CSSProperties = {
  fontSize: 17, fontWeight: 700, color: COLORS.primary,
  borderLeft: `4px solid ${COLORS.accent}`, paddingLeft: 12, marginBottom: 16,
};

/**
 * セクション別カラー。
 * 全ページ同じ紺色だとページを開いても何の話か分からないため、
 * 指標グループごとに色を割り当てる。グラフの系列色と対応させてある
 * （マップ=緑／検索=青／ユーザー反応=オレンジ）。
 * ヘッダーバーと見出しアクセントを同色にして1ページ1色に揃える。
 */
export const SECTION_COLORS = {
  summary: "#0f3460", // 表紙・月次推移（従来の紺）
  map:     "#1b5e20", // Googleマップ表示数
  search:  "#01579b", // Google検索数
  actions: "#b34700", // ユーザー反応数
  ranking: "#00695c", // キーワード順位・多地点順位
  queries: "#283593", // 検索語句
  reviews: "#ad1457", // 口コミ各種
  wrapup:  "#37474f", // 総括・メモ
} as const;

export type SectionColorKey = keyof typeof SECTION_COLORS;

/** #rrggbb を暗くする（ヘッダーのグラデーション始点用） */
function darken(hex: string, ratio: number): string {
  const m = hex.replace("#", "");
  const n = parseInt(m, 16);
  const r = Math.round(((n >> 16) & 255) * (1 - ratio));
  const g = Math.round(((n >> 8) & 255) * (1 - ratio));
  const b = Math.round((n & 255) * (1 - ratio));
  return `#${[r, g, b].map(v => v.toString(16).padStart(2, "0")).join("")}`;
}

/** セクション色のヘッダーバー背景（CSSのbackground値） */
export function sectionBarBg(color: string): string {
  return `linear-gradient(135deg,${darken(color, 0.55)},${color})`;
}

/** セクション色を反映したヘッダーバー */
export function slideBar(color: string = SECTION_COLORS.summary): React.CSSProperties {
  return { ...slideBarStyle, background: sectionBarBg(color) };
}

/** セクション色を反映した見出し（左のアクセント線をヘッダーと同色にする） */
export function stitle(color: string = COLORS.accent, extra?: React.CSSProperties): React.CSSProperties {
  return { ...stitleStyle, borderLeft: `4px solid ${color}`, ...extra };
}

export const footerStyle: React.CSSProperties = {
  background: "#1a1a2e", color: "rgba(255,255,255,0.3)", textAlign: "center",
  padding: 8, fontSize: 16, flexShrink: 0,
};

export const kpiTopColors = [
  "linear-gradient(90deg,#4fc3f7,#0288d1)",
  "linear-gradient(90deg,#81c784,#388e3c)",
  "linear-gradient(90deg,#ffb74d,#f57c00)",
  "linear-gradient(90deg,#ba68c8,#7b1fa2)",
  "linear-gradient(90deg,#e57373,#d32f2f)",
  "linear-gradient(90deg,#4db6ac,#00897b)",
  "linear-gradient(90deg,#7986cb,#3949ab)",
  "linear-gradient(90deg,#ffd54f,#fbc02d)",
];

export const apiNoteStyle: React.CSSProperties = {
  fontSize: 16, color: COLORS.danger, textAlign: "right",
  margin: "4px 16px 0", fontWeight: 600,
};

export const API_NOTE_TEXT = "※ 2025年11月以降、Google Business Profile APIの計測仕様変更により数値が大幅に変動する場合があります";
