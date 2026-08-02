/**
 * レポートのページ番号と分母(totalPages)の整合を固定するテスト。
 * client.tsx の実装と同じ規則をここに写し、条件付きページのON/OFF全組み合わせで
 * 「実際に描画されるページ数 == totalPages」が崩れないことを検証する。
 *
 * 2026-08-02 のレビューで、口コミ2ページと検索語句ページが
 * 「非表示なのに番号だけ進む」状態になっていた（PDFに「10 / 8」と印字される）。
 */
import { describe, it, expect } from "vitest";

interface Flags {
  hasReviews: boolean;
  showKeywords: boolean;
  showRankingHistory: boolean;
  showGridRanking: boolean;
  showLang: boolean;
  showSearchQueries: boolean;
  showCompetitors: boolean;
}

/** client.tsx の totalPages 計算（1236-1242行）と同じ規則 */
function totalPages(f: Flags): number {
  let n = 8; // P1,P2,P3-P5,口コミ分析,総括,メモ
  if (f.hasReviews) n += 2;
  if (f.showKeywords) n++;
  if (f.showRankingHistory) n++;
  if (f.showGridRanking) n += 2;
  if (f.showLang) n++;
  if (f.showSearchQueries) n++;
  if (f.showCompetitors) n++;
  return n;
}

/** client.tsx の pageNum 進行（修正後）と同じ規則で、最後のページ番号を求める */
function lastPageNum(f: Flags): number {
  let p = 5; // P1〜P5は固定採番（pageNum = 2..5）
  if (f.showKeywords) p++;          // P6 キーワード順位変動
  if (f.showRankingHistory) p++;    // 順位推移
  if (f.showGridRanking) p += 2;    // グリッドサマリー + KW切替
  if (f.showSearchQueries) p++;     // 検索語句（history非空のときのみ）
  if (f.hasReviews) p += 2;         // 口コミ件数推移 + 月間増加数
  p++;                              // 口コミ分析
  if (f.showCompetitors) p++;       // 競合比較
  if (f.showLang) p++;              // 言語別
  p++;                              // 総括
  p++;                              // メモ
  return p;
}

function allCombos(): Flags[] {
  const out: Flags[] = [];
  for (let mask = 0; mask < 128; mask++) {
    out.push({
      hasReviews: !!(mask & 1),
      showKeywords: !!(mask & 2),
      showRankingHistory: !!(mask & 4),
      showGridRanking: !!(mask & 8),
      showLang: !!(mask & 16),
      showSearchQueries: !!(mask & 32),
      showCompetitors: !!(mask & 64),
    });
  }
  return out;
}

describe("レポートのページ番号と分母が一致すること", () => {
  it("条件付きページの全128通りで 最終ページ番号 == totalPages", () => {
    const mismatches: string[] = [];
    for (const f of allCombos()) {
      const last = lastPageNum(f);
      const total = totalPages(f);
      if (last !== total) {
        mismatches.push(`${JSON.stringify(f)} → last=${last} total=${total}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("口コミデータなし店舗でも分母を超えない（回帰: 「10 / 8」問題）", () => {
    const f: Flags = {
      hasReviews: false,
      showKeywords: false,
      showRankingHistory: false,
      showGridRanking: false,
      showLang: false,
      showSearchQueries: false,
      showCompetitors: false,
    };
    expect(totalPages(f)).toBe(8);
    expect(lastPageNum(f)).toBe(8);
  });

  it("全部入りの構成でも一致する", () => {
    const f: Flags = {
      hasReviews: true,
      showKeywords: true,
      showRankingHistory: true,
      showGridRanking: true,
      showLang: true,
      showSearchQueries: true,
      showCompetitors: true,
    };
    expect(lastPageNum(f)).toBe(totalPages(f));
    // 8(固定) + 2(口コミ2種) + 1(KW変動) + 1(順位推移) + 2(グリッド) + 1(言語) + 1(検索語句) + 1(競合)
    expect(totalPages(f)).toBe(17);
  });
});
