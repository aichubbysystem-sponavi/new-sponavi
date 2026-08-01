/**
 * 月ラベル（"YYYY/M"）の比較・正規化の単一情報源。
 *
 * 【なぜ独立モジュールなのか】
 * 月の比較を文字列で行うと 10〜12月が必ず壊れる:
 *   "2026/10" < "2026/9"  → true（'1' < '9' のため）
 * この罠を過去に複数箇所で踏んでおり、同じ実装が compareMonths（gbp-search-keywords）と
 * monthToNum（report-utils）に分かれて存在し、片方だけ直る事故が起きた。
 * 依存ゼロのこのモジュールを唯一の実装とし、他はここから再エクスポートする。
 *
 * 新しく月を比較・ソートするコードでは、必ず compareMonths / monthToNum を使うこと。
 * localeCompare や < > による月ラベルの直接比較は使用禁止。
 */

/**
 * "2025/10" → 202510 の数値変換（月ソート・比較用）
 * "2025-10" / "2025年10月" / "2025/09" のゆれも受け付ける。
 */
export function monthToNum(m: string): number {
  if (!m) return 0;
  const s = String(m);
  const match = s.match(/(\d{4})\s*[年/\-.]\s*(\d{1,2})/);
  if (match) return (parseInt(match[1]) || 0) * 100 + (parseInt(match[2]) || 0);
  // 区切りなしの "YYYYMM"（スプレッドシートのタブ名形式）も受け付ける
  const compact = s.match(/^(\d{4})(0[1-9]|1[0-2])$/);
  if (compact) return parseInt(compact[1]) * 100 + parseInt(compact[2]);
  return 0;
}

/** "YYYY/M" 形式の月文字列を数値比較（負=a が古い / 0=同じ / 正=a が新しい） */
export function compareMonths(a: string, b: string): number {
  return monthToNum(a) - monthToNum(b);
}

/** 月ラベルを "YYYY/M" に正規化（"2026/09" / "2026-09" / "2026年9月" → "2026/9"）。解釈できなければ空文字 */
export function normalizeMonthLabel(m: string | null | undefined): string {
  const n = monthToNum(m || "");
  if (!n) return "";
  return `${Math.floor(n / 100)}/${n % 100}`;
}
