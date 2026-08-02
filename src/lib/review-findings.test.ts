/**
 * 2026-08-02 コードレビューで指摘された照合ゲートの誤検知を再現するテスト。
 * ここが red のままなら「正しいAI総評が空欄化される」実害がある。
 */
import { describe, it, expect } from "vitest";
import {
  validateOutOfRangeClaims,
  validateMonthlyAverage,
  buildKeywordFacts,
} from "./comment-validation";

// 2026-08-02 レビュー指摘 M-2 の再現テスト（修正済み）。
// 予防表現の除外を不在主張判定より先に評価するよう順序を入れ替えた。
describe("[レビュー指摘] 圏外の予防表現を不在主張と誤検知しないこと", () => {
  // 「名東区 パスタ」は直近で 1位→圏外 に転落済み（fellNow=true の状態）
  const FACTS = buildKeywordFacts(
    [{ word: "名東区 パスタ", rank: 0, prevRank: 1 }],
    {
      labels: ["2026/4", "2026/6"],
      datasets: [
        { word: "名東区 パスタ", ranks: [1, null], outOfRange: [false, true] } as any,
      ],
    },
  );

  it("「圏外に転落しないよう」は予防表現であり違反ではない", () => {
    const text =
      "「名東区 パスタ」が1位から圏外へ転落した。他のキーワードも圏外に転落しないよう、投稿頻度の維持を継続したい";
    expect(validateOutOfRangeClaims(text, FACTS)).toHaveLength(0);
  });

  it("「圏外にならないよう」も違反ではない", () => {
    const text = "上位表示を維持し、圏外にならないよう対策を続ける";
    expect(validateOutOfRangeClaims(text, FACTS)).toHaveLength(0);
  });
});

describe("[レビュー指摘] 月平均の全角表記を誤検知しないこと", () => {
  // 直近6ヶ月 = 19,1,1,-1,1,2 → 平均3.8件
  const deltas = [2, 3, 2, 1, 3, 0, 1, 19, 1, 1, -1, 1, 2];

  it("全角プラス・全角小数点の「＋3．8件」は正しい記述として通す", () => {
    const text = "直近6ヶ月の月平均は＋3．8件で推移している";
    expect(validateMonthlyAverage(text, deltas)).toHaveLength(0);
  });

  it("全角数字のみの「+3.8件」も通す", () => {
    const text = "直近6ヶ月の月平均は+３.８件で推移している";
    expect(validateMonthlyAverage(text, deltas)).toHaveLength(0);
  });

  it("本物の誤り（4.3件）は引き続き検出する", () => {
    const text = "直近6ヶ月の月平均は+4.3件だった";
    expect(validateMonthlyAverage(text, deltas)).toHaveLength(1);
  });
});
