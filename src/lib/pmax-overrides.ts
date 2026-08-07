/**
 * P-MAXレポートの数値上書き（手動編集）の共通定義。
 *
 * 上書きは pmax_report_settings.overrides に「フラットなキー→数値」で保存し、
 * レポート描画時に元データへ適用する。元データ（pmax_store_data等）は書き換えない
 * ため、「全店舗を更新」で再同期しても手動編集は消えない。
 * 値を空にして確定するとキーが削除され、元の実測値に戻る。
 *
 * キー形式（区切りは "|"。店舗名はテーブルの行キーなのでキーには含めない）:
 *   m|<言語>|<YYYY-MM>|<field>    … 言語別・月次集計行
 *   d|<言語>|<YYYY-MM-DD>|<field> … 言語別・日次行
 *   g|<YYYY/MM>|<field>           … GBPコンバージョン行（月キーはシート準拠のスラッシュ形式）
 *   c|<YYYY-MM>|<network>|impressions … 媒体別配信比率（対象月ごと）
 *   k|<YYYY-MM>|<field>           … KPIサマリーの全言語合計の直接上書き
 *
 * field（保存する値は「画面の表示単位」）:
 *   impressions / clicks … 回数
 *   costYen              … 広告費（円）
 *   ctrPct               … クリック率（% 例: 2.45）
 *   cpcYen               … 平均クリック単価（円 例: 4.1）
 */

export type PmaxOverrides = Record<string, number>;

export type PmaxSectionVisibility = Record<string, boolean>;

export type PmaxReportSettings = {
  overrides: PmaxOverrides;
  sectionVisibility: PmaxSectionVisibility;
};

export const EMPTY_PMAX_SETTINGS: PmaxReportSettings = { overrides: {}, sectionVisibility: {} };

type AdsLikeRow = {
  impressions: number;
  clicks: number;
  ctr: number; // 比率（0.0245 = 2.45%）
  averageCpc: number; // micros
  costMicros: number;
};

/**
 * 広告系の行（月次集計・日次）に上書きを適用する（行をミューテートする）。
 * impressions/clicks/costYen を先に適用 → ctr/cpc を再計算 →
 * ctrPct/cpcYen の明示上書きがあればそれを最優先。
 */
export function applyAdsOverrides(row: AdsLikeRow, prefix: string, overrides: PmaxOverrides): void {
  const imp = overrides[`${prefix}|impressions`];
  const clk = overrides[`${prefix}|clicks`];
  const cost = overrides[`${prefix}|costYen`];
  if (imp !== undefined) row.impressions = imp;
  if (clk !== undefined) row.clicks = clk;
  if (cost !== undefined) row.costMicros = Math.round(cost * 1_000_000);
  if (imp !== undefined || clk !== undefined || cost !== undefined) {
    row.ctr = row.impressions > 0 ? row.clicks / row.impressions : 0;
    row.averageCpc = row.clicks > 0 ? row.costMicros / row.clicks : 0;
  }
  const ctrPct = overrides[`${prefix}|ctrPct`];
  if (ctrPct !== undefined) row.ctr = ctrPct / 100;
  const cpcYen = overrides[`${prefix}|cpcYen`];
  if (cpcYen !== undefined) row.averageCpc = cpcYen * 1_000_000;
}

/** GBPコンバージョン行のフィールド名（画面の指標と1:1） */
export const GBP_OVERRIDE_FIELDS = [
  "totalVisits",
  "phone",
  "directions",
  "website",
  "menuClicks",
  "saveShare",
  "reservation",
] as const;

export type GbpOverrideField = (typeof GBP_OVERRIDE_FIELDS)[number];

/** GBP行に g|<月>|<field> の上書きを適用する（行をミューテートする） */
export function applyGbpOverrides(
  row: Record<string, unknown> & { month: string },
  overrides: PmaxOverrides,
): void {
  for (const f of GBP_OVERRIDE_FIELDS) {
    const v = overrides[`g|${row.month}|${f}`];
    if (v !== undefined) (row as Record<string, number | string>)[f] = v;
  }
}

/** DB行 → 設定オブジェクト（型ゆるめのJSONBを安全に数値/真偽だけ通す） */
export function parseReportSettings(row: {
  overrides?: unknown;
  section_visibility?: unknown;
} | null): PmaxReportSettings {
  const overrides: PmaxOverrides = {};
  if (row?.overrides && typeof row.overrides === "object") {
    for (const [k, v] of Object.entries(row.overrides as Record<string, unknown>)) {
      if (typeof v !== "number" && typeof v !== "string") continue;
      if (typeof v === "string" && v.trim() === "") continue;
      const n = Number(v);
      if (Number.isFinite(n)) overrides[k] = n;
    }
  }
  const sectionVisibility: PmaxSectionVisibility = {};
  if (row?.section_visibility && typeof row.section_visibility === "object") {
    for (const [k, v] of Object.entries(row.section_visibility as Record<string, unknown>)) {
      if (typeof v === "boolean") sectionVisibility[k] = v;
    }
  }
  return { overrides, sectionVisibility };
}
