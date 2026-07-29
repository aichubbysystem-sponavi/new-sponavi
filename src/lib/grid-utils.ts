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
