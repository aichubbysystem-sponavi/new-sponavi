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
