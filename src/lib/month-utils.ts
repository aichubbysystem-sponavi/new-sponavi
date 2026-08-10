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

/**
 * 競合比較の取得を許可する遡り月数（当月を0として何か月前まで）。
 *
 * 以前は当月と前月だけだった。しかしパフォーマンスデータの提供が数日遅れるため、
 * 8月初旬に作る「最新の確定月」レポートは6月になる。当月・前月だけだと
 * その6月レポートで競合比較のページだけが消えていた（2026-08-01 発見）。
 *
 * 一方で無制限にすると、古いレポートを開くたびに ¥4.8 の課金が発生する。
 * (shop, month) 単位の保存ガードに加えて、遡れる範囲自体でも歯止めをかける。
 */
export const COMPETITOR_FETCH_MONTHS_BACK = 3;

/** 表示月が競合比較の取得を許可する範囲内か（now はJST基準の日時） */
export function isCompetitorFetchAllowed(displayMonth: string, now: Date): boolean {
  const n = monthToNum(displayMonth);
  if (!n) return false;
  const target = Math.floor(n / 100) * 12 + ((n % 100) - 1);
  const cur = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const diff = cur - target;
  // 未来月は取得しない。過去は COMPETITOR_FETCH_MONTHS_BACK まで
  return diff >= 0 && diff <= COMPETITOR_FETCH_MONTHS_BACK;
}

/** 月ラベルを "YYYY/M" に正規化（"2026/09" / "2026-09" / "2026年9月" → "2026/9"）。解釈できなければ空文字 */
export function normalizeMonthLabel(m: string | null | undefined): string {
  const n = monthToNum(m || "");
  if (!n) return "";
  return `${Math.floor(n / 100)}/${n % 100}`;
}

/**
 * 順位計測時刻（ISO）→ レポート帰属月 "YYYY/M"。
 *
 * 順位は毎月1日（前月末時点のスナップショット）に計測する運用のため、
 * JSTで1〜3日の計測は「前月分レポート」の値として扱う。4日以降は当月扱い
 * （月中の臨時計測を前月へ誤帰属させないための境界。2026-08-10決定）。
 *
 * grid_ranking_logs.report_month のbackfill SQL
 * （sql/2026-08-10_grid_ranking_report_month.sql）と同一ルール。
 * 読み取り側は report_month 列を優先し、無い行のみこの関数で導出する。
 * measured_at の月をそのまま使うのは禁止（7/1計測が7月分に載る旧バグの再発）。
 */
export function reportMonthFromMeasuredAt(iso: string): string {
  const jst = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  let y = jst.getUTCFullYear();
  let m = jst.getUTCMonth() + 1;
  if (jst.getUTCDate() <= 3) {
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  return `${y}/${m}`;
}
