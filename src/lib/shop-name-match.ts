/**
 * 貼り付けた店舗名リストを shops と照合する。
 *
 * 照合ポリシー（誤チェック防止のため段階を分ける）:
 *  1. 完全一致（NFKC + 小文字化 + 空白除去）→ matched（自動チェック可）
 *  2. 記号無視の完全一致（1に加えて括弧・中黒などを除去）→ matched（自動チェック可）
 *  3. 1/2で候補が複数 → ambiguous（自動チェックせず手動で選ばせる）
 *  4. 一致なし → unmatched。類似候補は提示するが自動チェックはしない
 * 部分一致で勝手にチェックを入れることは絶対にしない（別店舗を巻き込む事故を防ぐ）
 */

export type MatchShop = { id: string; name: string };

export const normKey = (x: string) =>
  (x || "").normalize("NFKC").toLowerCase().replace(/[\s　]/g, "");

// 記号を除去した比較用キー（長音「ー」は意味を持つので残す）
export const looseKey = (x: string) =>
  normKey(x).replace(/[【】\[\]「」『』（）()・･、,。．.〜~/／\\|｜&＆!！?？"'’”“:：;；#＃*＊+＋\-‐‑–—−_＿]/g, "");

// 行頭の箇条書き記号・番号を落とす（LINEからのコピペ対策）
export const stripBullet = (line: string) =>
  line.replace(/^[\s　]*(?:[•・･*＊>＞#]+|\d+[.)．）、:：]|[（(]\d+[)）])[\s　]*/, "");

function bigrams(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

/** Dice係数（0〜1）。未検出時の「候補」提示にのみ使う */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.length === 0 || B.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const g of A) counts.set(g, (counts.get(g) || 0) + 1);
  let hit = 0;
  for (const g of B) {
    const c = counts.get(g) || 0;
    if (c > 0) { hit++; counts.set(g, c - 1); }
  }
  return (2 * hit) / (A.length + B.length);
}

export type ShopNameMatchResult = {
  matched: { input: string; shop: MatchShop }[];
  ambiguous: { input: string; candidates: MatchShop[] }[];
  unmatched: { input: string; suggestions: MatchShop[] }[];
  /** 貼り付けテキスト内で重複していた行（1件として扱う） */
  duplicated: string[];
};

export function buildShopIndex(shops: MatchShop[]) {
  const byNorm = new Map<string, MatchShop[]>();
  const byLoose = new Map<string, MatchShop[]>();
  for (const s of shops) {
    const n = normKey(s.name);
    const l = looseKey(s.name);
    if (n) byNorm.set(n, [...(byNorm.get(n) || []), s]);
    if (l) byLoose.set(l, [...(byLoose.get(l) || []), s]);
  }
  return { byNorm, byLoose };
}

export function matchShopNames(
  raw: string,
  shops: MatchShop[],
  index?: ReturnType<typeof buildShopIndex>,
): ShopNameMatchResult {
  const { byNorm, byLoose } = index || buildShopIndex(shops);
  const lines = raw
    .split(/\r?\n/)
    .map(l => stripBullet(l).trim())
    .filter(l => l.length > 0);

  const res: ShopNameMatchResult = { matched: [], ambiguous: [], unmatched: [], duplicated: [] };
  const seen = new Set<string>();

  for (const line of lines) {
    const n = normKey(line);
    if (!n) continue;
    if (seen.has(n)) { res.duplicated.push(line); continue; }
    seen.add(n);

    const exact = byNorm.get(n) || [];
    if (exact.length === 1) { res.matched.push({ input: line, shop: exact[0] }); continue; }
    if (exact.length > 1) { res.ambiguous.push({ input: line, candidates: exact }); continue; }

    const l = looseKey(line);
    const loose = (l && byLoose.get(l)) || [];
    if (loose.length === 1) { res.matched.push({ input: line, shop: loose[0] }); continue; }
    if (loose.length > 1) { res.ambiguous.push({ input: line, candidates: loose }); continue; }

    // 未検出: 候補だけ出す（自動チェックはしない）
    const suggestions = shops
      .map(s => {
        const sl = looseKey(s.name);
        const contain = sl && l && (sl.includes(l) || l.includes(sl)) ? 0.3 : 0;
        return { s, score: similarity(l, sl) + contain };
      })
      .filter(x => x.score >= 0.45)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(x => x.s);
    res.unmatched.push({ input: line, suggestions });
  }

  return res;
}
