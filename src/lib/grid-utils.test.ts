import { describe, it, expect } from "vitest";
import {
  generate4Points,
  generate5Points,
  GRID_ANGLES,
  summarizeGridRanks,
  formatAvgRank,
  formatCoverage,
} from "./grid-utils";

describe("多地点平均順位の集計（圏外を数値に混ぜない）", () => {
  it("全地点圏外は「圏外」。101.0位という架空の順位を出さない", () => {
    // 実際に管理画面が「101.0位」と表示していたケース（2026-08-01 発見）
    const s = summarizeGridRanks([{ rank: 0 }, { rank: 0 }, { rank: 0 }, { rank: 0 }, { rank: 0 }]);
    expect(s).toEqual({ inRange: 0, total: 5, avg: null });
    expect(formatAvgRank(s)).toBe("圏外");
    expect(formatCoverage(s)).toBe("0/5");
  });

  it("一部だけ圏内なら、圏内地点のみで平均する", () => {
    // 旧実装では (101*4 + 10) / 5 = 82.8位 となり「82位くらいには入っている」と誤読させていた
    const s = summarizeGridRanks([{ rank: 10 }, { rank: 0 }, { rank: 0 }, { rank: 0 }, { rank: 0 }]);
    expect(s.avg).toBe(10);
    expect(formatAvgRank(s)).toBe("10.0位");
    // 平均だけでは実態が伝わらないので圏内率を必ず併記する
    expect(formatCoverage(s)).toBe("1/5");
  });

  it("全地点圏内なら通常の平均", () => {
    const s = summarizeGridRanks([{ rank: 10 }, { rank: 12 }, { rank: 14 }]);
    expect(s.avg).toBe(12);
    expect(formatAvgRank(s)).toBe("12.0位");
    expect(formatCoverage(s)).toBe("3/3");
  });

  it("小数第1位まで表示する", () => {
    const s = summarizeGridRanks([{ rank: 12 }, { rank: 13 }]);
    expect(formatAvgRank(s)).toBe("12.5位");
  });

  it("計測地点が無い場合は「-」", () => {
    expect(formatAvgRank(summarizeGridRanks([]))).toBe("-");
    expect(formatCoverage(summarizeGridRanks([]))).toBe("-");
    expect(formatAvgRank(summarizeGridRanks(null))).toBe("-");
    expect(formatAvgRank(summarizeGridRanks(undefined))).toBe("-");
  });

  it("負の順位や不正値は圏外として扱う", () => {
    const s = summarizeGridRanks([{ rank: -1 }, { rank: 5 }, { rank: NaN as unknown as number }]);
    expect(s.inRange).toBe(1);
    expect(s.avg).toBe(5);
  });

  it("プリセット側APIと同じ規則になっている（圏内のみ平均・全圏外はnull）", () => {
    // grid-ranking-presets/route.ts は元から圏内のみ平均だった。
    // 画面側だけ101混入で、同一画面に2つの計算が混在していた
    const results = [{ rank: 0 }, { rank: 20 }];
    const presetsStyle = (() => {
      const ranked = results.filter((r) => r.rank > 0);
      return ranked.length > 0 ? ranked.reduce((a, r) => a + r.rank, 0) / ranked.length : null;
    })();
    expect(summarizeGridRanks(results).avg).toBe(presetsStyle);
  });
});

// 2点間の概算距離（メートル）— テスト内検算用
function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat2 - lat1) * 111320;
  const dLng = (lng2 - lng1) * 111320 * Math.cos((lat1 * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

describe("generate4Points", () => {
  const LAT = 35.165696; // patty rôti（名古屋）
  const LNG = 136.995758;

  it("常に4点を返し、row/colは2×2スロット", () => {
    const pts = generate4Points(LAT, LNG, 1000);
    expect(pts).toHaveLength(4);
    const keys = pts.map(p => `${p.row},${p.col}`).sort();
    expect(keys).toEqual(["0,0", "0,1", "1,0", "1,1"]);
  });

  it("全角度・全距離で各点は中心からちょうどr（誤差1m未満）", () => {
    for (const angle of GRID_ANGLES) {
      for (const r of [500, 1000, 2000, 3000, 4000, 5000]) {
        for (const pt of generate4Points(LAT, LNG, r, angle)) {
          expect(Math.abs(distanceM(LAT, LNG, pt.lat, pt.lng) - r)).toBeLessThan(1);
        }
      }
    }
  });

  it("角度0（斜め）: (0,1)は北東=緯度+/経度+、(1,0)は南西=緯度-/経度-", () => {
    const pts = generate4Points(LAT, LNG, 1000, 0);
    const ne = pts.find(p => p.row === 0 && p.col === 1)!;
    const sw = pts.find(p => p.row === 1 && p.col === 0)!;
    expect(ne.lat).toBeGreaterThan(LAT);
    expect(ne.lng).toBeGreaterThan(LNG);
    expect(sw.lat).toBeLessThan(LAT);
    expect(sw.lng).toBeLessThan(LNG);
  });

  it("角度45（十字）: (0,0)スロットが真北（経度ほぼ変化なし・緯度+）になる", () => {
    // (0,0)=315度+45度=360度=北
    const pts = generate4Points(LAT, LNG, 1000, 45);
    const north = pts.find(p => p.row === 0 && p.col === 0)!;
    expect(north.lat).toBeGreaterThan(LAT);
    expect(Math.abs(north.lng - LNG)).toBeLessThan(0.00001); // 真北=経度変化なし
    // (0,1)=45+45=90度=真東
    const east = pts.find(p => p.row === 0 && p.col === 1)!;
    expect(east.lng).toBeGreaterThan(LNG);
    expect(Math.abs(east.lat - LAT)).toBeLessThan(0.00001);
  });

  it("4点は常に90度間隔（隣接点間の距離 = r√2）", () => {
    for (const angle of GRID_ANGLES) {
      const r = 2000;
      const pts = generate4Points(LAT, LNG, r, angle);
      // 全ペア距離: 隣接(90度差)=r√2 が4組、対角(180度差)=2r が2組
      const dists: number[] = [];
      for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
        dists.push(distanceM(pts[i].lat, pts[i].lng, pts[j].lat, pts[j].lng));
      }
      dists.sort((a, b) => a - b);
      for (let k = 0; k < 4; k++) expect(Math.abs(dists[k] - r * Math.SQRT2)).toBeLessThan(2);
      for (let k = 4; k < 6; k++) expect(Math.abs(dists[k] - 2 * r)).toBeLessThan(2);
    }
  });

  it("回転角15度で各点が回転前から約2·r·sin(7.5°)移動する", () => {
    const r = 2000;
    const a = generate4Points(LAT, LNG, r, 0);
    const b = generate4Points(LAT, LNG, r, 15);
    const expected = 2 * r * Math.sin((7.5 * Math.PI) / 180); // 弦長
    for (let i = 0; i < 4; i++) {
      const moved = distanceM(a[i].lat, a[i].lng, b[i].lat, b[i].lng);
      expect(Math.abs(moved - expected)).toBeLessThan(2);
    }
  });
});

describe("generate5Points", () => {
  const LAT = 35.165696;
  const LNG = 136.995758;

  it("常に5点を返し、1点目が中心(1,1)=店舗座標そのもの", () => {
    const pts = generate5Points(LAT, LNG, 1000);
    expect(pts).toHaveLength(5);
    expect(pts[0]).toMatchObject({ row: 1, col: 1, lat: LAT, lng: LNG });
  });

  it("row/colは3×3の中心＋四隅スロット（centerCellが中心を拾える奇数グリッド）", () => {
    const keys = generate5Points(LAT, LNG, 1000).map(p => `${p.row},${p.col}`).sort();
    expect(keys).toEqual(["0,0", "0,2", "1,1", "2,0", "2,2"]);
  });

  it("外周4点はgenerate4Pointsと同一座標（スロットの読み替えのみ）", () => {
    for (const angle of GRID_ANGLES) {
      const outer5 = generate5Points(LAT, LNG, 2000, angle).slice(1);
      const outer4 = generate4Points(LAT, LNG, 2000, angle);
      for (let i = 0; i < 4; i++) {
        expect(outer5[i].lat).toBe(outer4[i].lat);
        expect(outer5[i].lng).toBe(outer4[i].lng);
        expect(outer5[i].row).toBe(outer4[i].row * 2);
        expect(outer5[i].col).toBe(outer4[i].col * 2);
      }
    }
  });

  it("外周4点は中心からちょうどr（誤差1m未満）", () => {
    for (const pt of generate5Points(LAT, LNG, 3000, 15).slice(1)) {
      expect(Math.abs(distanceM(LAT, LNG, pt.lat, pt.lng) - 3000)).toBeLessThan(1);
    }
  });
});
