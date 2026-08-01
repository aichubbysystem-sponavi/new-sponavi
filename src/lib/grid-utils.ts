/**
 * 多地点順位チェックの地点生成ユーティリティ
 * page.tsx（クライアント）から分離してテスト可能にする
 */

export interface GeneratedPoint {
  row: number;
  col: number;
  lat: number;
  lng: number;
  rank: number;
}

/** 4点の回転角の許可値（15度刻み。4点は90度間隔のため90度で一周＝0〜75で全方位カバー） */
export const GRID_ANGLES = [0, 15, 30, 45, 60, 75];

// ── 多地点平均順位の集計（表示する全箇所でこれを使う）──

export interface GridRankSummary {
  /** 圏内（順位が取れた）地点数 */
  inRange: number;
  /** 計測地点数 */
  total: number;
  /** 圏内地点のみの平均順位。圏内が0なら null（＝全地点圏外） */
  avg: number | null;
}

/**
 * 多地点計測の結果を集計する。
 *
 * 【圏外を数値に混ぜてはいけない】
 * 以前は圏外を 101 として平均に足し込んでいた（grid-ranking/page.tsx）。
 * 計測は最大4ページ＝80位までしか見ないため、101位は観測されていない架空の値。
 * さらに5地点中4地点が圏外で1地点が10位のとき (101*4+10)/5 = 82.8位 と表示され、
 * 「82位くらいには入っている」と誤読させていた。実際は8割の地点で表示されていない。
 *
 * ここでは圏内地点のみを平均し、圏内0なら null（＝圏外）を返す。
 * レポート側（report-api.ts / spreadsheet.ts / report-utils.fmtAvgRank）と同じ規則。
 */
export function summarizeGridRanks(results: { rank: number }[] | null | undefined): GridRankSummary {
  const list = results || [];
  const ranked = list.filter((r) => typeof r?.rank === "number" && r.rank > 0);
  return {
    inRange: ranked.length,
    total: list.length,
    avg: ranked.length > 0 ? ranked.reduce((sum, r) => sum + r.rank, 0) / ranked.length : null,
  };
}

/**
 * 平均順位の表示文字列。全地点圏外は数値化せず「圏外」と出す。
 * 小数第1位まで（12.25 → "12.3位"）。
 */
export function formatAvgRank(s: GridRankSummary): string {
  if (s.total === 0) return "-";
  if (s.avg == null) return "圏外";
  return `${s.avg.toFixed(1)}位`;
}

/**
 * 圏内率の表示文字列。平均順位を出す場所には必ずこれを併記する。
 * （report-utils.ts に「平均順位を出す場所では必ず圏内率を併記すること」と明記されている）
 */
export function formatCoverage(s: GridRankSummary): string {
  if (s.total === 0) return "-";
  return `${s.inRange}/${s.total}`;
}

/**
 * 店舗中心から距離rの4地点を生成する。各点は店舗からちょうど r メートル。
 * angleDeg=0 で斜め（方位角45/135/225/315度 = NE/SE/SW/NW）、45で十字（N/E/S/W）。
 * row/col は 2×2 グリッドのスロットとして保存（回転時も同じ割当。描画はlat/lngベース）。
 */
export function generate4Points(
  centerLat: number,
  centerLng: number,
  radiusM: number,
  angleDeg: number = 0,
): GeneratedPoint[] {
  const latPerM = 1 / 111320;
  const lngPerM = 1 / (111320 * Math.cos((centerLat * Math.PI) / 180));
  // スロット順: (0,0)=NW系 315度, (0,1)=NE系 45度, (1,0)=SW系 225度, (1,1)=SE系 135度
  const slots: { row: number; col: number; bearing: number }[] = [
    { row: 0, col: 0, bearing: 315 + angleDeg },
    { row: 0, col: 1, bearing: 45 + angleDeg },
    { row: 1, col: 0, bearing: 225 + angleDeg },
    { row: 1, col: 1, bearing: 135 + angleDeg },
  ];
  return slots.map(({ row, col, bearing }) => {
    const rad = (bearing * Math.PI) / 180; // 方位角: 北=0度, 東=90度（時計回り）
    return {
      row,
      col,
      lat: centerLat + radiusM * Math.cos(rad) * latPerM,
      lng: centerLng + radiusM * Math.sin(rad) * lngPerM,
      rank: 0,
    };
  });
}

/**
 * 店舗中心＋外周4地点の計5地点を生成する（2026-07-31 中心計測を復活）。
 * 3×3グリッドの奇数スロットとして保存する: 中心=(1,1)、外周4点=四隅(0,0)(0,2)(2,0)(2,2)。
 * 奇数グリッドにすることで centerCell() がそのまま中心=店舗位置を返し、
 * レポート側の「中心順位」がシートフォールバックではなく実測値になる。
 * 1点目は必ず中心（呼び出し側が center フラグ＝place_id失効チェックのトリガーにする）。
 */
export function generate5Points(
  centerLat: number,
  centerLng: number,
  radiusM: number,
  angleDeg: number = 0,
): GeneratedPoint[] {
  const center: GeneratedPoint = { row: 1, col: 1, lat: centerLat, lng: centerLng, rank: 0 };
  const outer = generate4Points(centerLat, centerLng, radiusM, angleDeg).map((p) => ({
    ...p,
    row: p.row * 2, // 2×2スロット(0,1) → 3×3の四隅(0,2)
    col: p.col * 2,
  }));
  return [center, ...outer];
}
