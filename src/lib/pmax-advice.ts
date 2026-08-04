/**
 * P-MAXレポート「店舗様へのアドバイス」ページの文章生成（決定論・AI不使用）。
 *
 * 文面の出典は営業定例の商談分析シート（C列「原文引用」）。実際の商談で
 * クライアントに説明・提案した内容のうち、数値条件で汎用化できるものを
 * アドバイス文として整備した。特定クライアント名・店舗固有の数値は除去し、
 * 各店舗の当月実数値を埋め込んで出力する。
 *
 * 条件に合致した項目のみを優先度順に最大 MAX_PARAGRAPHS 件返す。
 * 1件も合致しない場合は空配列（ページ自体を出さない）。
 */

export type PmaxAdviceInput = {
  impressions: number;
  prevImpressions: number;
  clicks: number;
  prevClicks: number;
  /** クリック率（0〜1） */
  ctr: number;
  prevCtr: number;
  /** 平均クリック単価（円） */
  cpcYen: number;
  prevCpcYen: number;
  /**
   * 当月のGBP行動合計（来店+電話+経路案内+メニュー+予約+WEB+保存共有）。
   * GBP未連携・当月未同期など「未計測」の場合はnull（0件とは区別する）
   */
  mapActionsTotal: number | null;
  /** マップ+検索への配信割合（0〜100）。チャネルデータが無い場合はnull */
  mapsSearchSharePct: number | null;
  /** 当月の言語別平均クリック単価（クリックが発生した言語のみ） */
  langCpcs: { language: string; cpcYen: number }[];
  /** 保存・共有・写真（当月/前月）。未計測の月はnull（0件とは区別する） */
  saveShare: number | null;
  prevSaveShare: number | null;
};

const MAX_PARAGRAPHS = 5;

// parseCampaignName（google-ads.ts）の KNOWN_LANGUAGES に対応する日本語ラベル
const LANG_LABELS: Record<string, string> = {
  Japanese: "日本語",
  Chinese: "中国語",
  English: "英語",
  Korean: "韓国語",
  Thai: "タイ語",
  Vietnamese: "ベトナム語",
  French: "フランス語",
  Spanish: "スペイン語",
  Portuguese: "ポルトガル語",
  German: "ドイツ語",
  Italian: "イタリア語",
  Russian: "ロシア語",
  Arabic: "アラビア語",
  Hindi: "ヒンディー語",
};

const fmtPct = (ratio: number) => `${(ratio * 100).toFixed(2)}%`;
const fmtYen = (yen: number) => `¥${yen.toFixed(1)}`;

export function buildPmaxAdvice(input: PmaxAdviceInput): string[] {
  const {
    impressions, prevImpressions, clicks, ctr, prevCtr,
    cpcYen, prevCpcYen, mapActionsTotal, mapsSearchSharePct,
    langCpcs, saveShare, prevSaveShare,
  } = input;

  const paragraphs: string[] = [];
  const hasPrevMonth = prevImpressions > 0;

  // ① クリック率が業界平均を大きく上回る（まとめページと同じ「0.3〜0.6%」基準に統一）
  // 少数サンプルのノイズ発火を防ぐため、表示1,000回以上・クリック10件以上に限定
  if (impressions >= 1000 && clicks >= 10 && ctr >= 0.008) {
    paragraphs.push(
      `当月のクリック率は${fmtPct(ctr)}と、業界平均の0.3〜0.6%を大きく上回る非常に高い水準でございます。広告の訴求内容がユーザーの関心をしっかり捉えられている状態ですので、クリック率は単体の数値ではなく平均値とセットでご覧いただくと、現在の好調ぶりがより分かりやすいかと存じます。`
    );
  }

  // ② クリック単価の変動（上昇と低水準は排他。上昇の説明を優先）
  const cpcRose = hasPrevMonth && prevCpcYen > 0 && cpcYen >= prevCpcYen * 1.15 && cpcYen - prevCpcYen >= 0.5;
  if (cpcRose) {
    paragraphs.push(
      `平均クリック単価は前月の${fmtYen(prevCpcYen)}から${fmtYen(cpcYen)}へ上昇しております。主な要因としては競合店舗がP-MAX広告の配信を開始したことが考えられ、Googleの入札メカニズム上、競合が増えるとクリック単価が上がる仕組みとなっております。上昇幅から判断いたしますと、1〜3社程度が新たに配信を開始した可能性が高い状況です。単価の上昇が継続する場合は、予算配分の見直しも含めて改めてご相談させていただきます。`
    );
  } else if (clicks > 0 && cpcYen > 0 && cpcYen <= 5) {
    paragraphs.push(
      `平均クリック単価は${fmtYen(cpcYen)}と、Instagram広告の約10円やリスティング広告の約100円と比較しても圧倒的に効率的な水準でございます。これは同エリアでP-MAX広告を配信している競合がまだ少ないためで、競合が増えて単価が上がる前に配信を継続することで、先行者利益を確保できている状態です。`
    );
  }

  // ③ 表示回数は減少したがクリック率は上昇（配信精度の向上）
  // 表示上の同値（0.50%→0.50%）で「上昇」と書く矛盾を防ぐため、丸め後の値が異なる場合のみ
  if (hasPrevMonth && impressions < prevImpressions * 0.97 && prevCtr > 0 && ctr > prevCtr && fmtPct(ctr) !== fmtPct(prevCtr)) {
    paragraphs.push(
      `表示回数は前月より減少しておりますが、クリック率は${fmtPct(prevCtr)}から${fmtPct(ctr)}へ上昇しております。表示の母数が減っても反応の質が上がっていれば成果は維持されており、広告配信の精度が高まっている状態と捉えていただければと存じます。`
    );
  }

  // ④ マップ・検索への配信集中（P-MAXの配信ロジックの優位性）
  if (mapsSearchSharePct !== null && mapsSearchSharePct >= 85) {
    paragraphs.push(
      `媒体別の配信比率では、GoogleマップとGoogle検索への配信が全体の${mapsSearchSharePct.toFixed(1)}%を占めております。通常のP-MAX広告は6つの媒体へ約6分の1ずつ分散配信されますが、来店に最も近いユーザーが集まるマップ・検索へ配信を集中できており、広告費を無駄なく活用できている状態です。`
    );
  }

  // ⑤ 言語別クリック単価（予算配分の判断材料）。日本語を先頭に表示
  const namedLangs = langCpcs
    .filter((l) => l.language !== "Unknown" && l.cpcYen > 0)
    .map((l) => ({ label: LANG_LABELS[l.language] || l.language, cpcYen: l.cpcYen, isJa: l.language === "Japanese" }))
    .sort((a, b) => Number(b.isJa) - Number(a.isJa));
  if (namedLangs.length >= 2) {
    const listed = namedLangs.map((l) => `${l.label}${fmtYen(l.cpcYen)}`).join("、");
    paragraphs.push(
      `言語別の平均クリック単価は${listed}となっております。言語ごとの単価を把握いただくことで、どの言語に予算を寄せるかのご判断材料としていただけます。`
    );
  }

  // ⑥ 保存・共有の増加（検討中の見込み客）
  // 前月が「未計測(null)」の場合は前月比較を書かない（0件との混同禁止）
  if (saveShare !== null && prevSaveShare !== null && saveShare > 0 && saveShare > prevSaveShare) {
    paragraphs.push(
      `保存・共有のご利用は前月の${prevSaveShare.toLocaleString()}件から${saveShare.toLocaleString()}件へ増加しております。保存はすぐのご来店に結びつかない場合もございますが、タイミングが合えばご来店いただける見込みのお客様が増えている傾向として捉えられます。`
    );
  }

  // ⑦ MAP上の行動が出ていない（口コミ獲得の提案。表示かクリックがある店舗のみ）
  // 「未計測(null)」は0件と区別し、計測済みで0件の店舗にのみ出す
  if (mapActionsTotal === 0 && (impressions > 0 || clicks > 0)) {
    paragraphs.push(
      `一方で、Googleマップ上での経路案内やお電話などの行動数には伸びしろがございます。広告の表示やクリックが増えても、口コミなどの資産が少ないと来店の後押しが弱くなりますため、口コミの継続的な獲得が必要でございます。新規のお客様がご来店された際にお声がけいただくなど、まずは月5件程度の口コミ獲得を目標に取り組んでいただくことをおすすめいたします。`
    );
  }

  return paragraphs.slice(0, MAX_PARAGRAPHS);
}
