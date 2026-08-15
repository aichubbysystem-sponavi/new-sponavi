/**
 * 貼り付けた店舗名リストを shops と照合する。
 *
 * ■ 別名(aliases)について
 * shops.name は「システム全体の結合キー」なのでGBPの改名に追従しない（2026-08-08の設計判断）。
 * GBP上の現在名は shops.gbp_shop_name にだけ入る。
 * 例) name       = アイブロウサロンWHITE EYE まつ毛と眉毛の専門店 高崎店 ホワイトアイ
 *     gbp_shop_name = ジェルネイル専門 WHITE NAIL 高崎店
 * 現場から送られてくるのはGBPの現在名なので、aliases に gbp_shop_name を入れて照合する。
 *
 * ■ 照合の優先順位（誤チェック防止のため段階を分ける）
 *  1. name の完全一致（NFKC + 小文字化 + 空白除去）
 *  2. alias の完全一致
 *  3. name の記号無視一致（括弧・中黒などを除去）
 *  4. alias の記号無視一致
 *  上位の段階でヒットしたら下位は見ない。各段階で候補が複数なら ambiguous（自動チェックしない）。
 *  どの段階でもヒットしなければ unmatched。類似候補は提示するが自動チェックはしない。
 * 部分一致で勝手にチェックを入れることは絶対にしない（別店舗を巻き込む事故を防ぐ）
 */

export type MatchShop = { id: string; name: string; aliases?: string[] };

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

export type MatchedEntry = {
  input: string;
  shop: MatchShop;
  /** name で一致したか、GBP現在名などの別名で一致したか */
  matchedBy: "name" | "alias";
  /** alias一致のとき、どの別名に当たったか */
  via?: string;
};

export type ShopNameMatchResult = {
  matched: MatchedEntry[];
  ambiguous: { input: string; candidates: MatchShop[] }[];
  unmatched: { input: string; suggestions: MatchShop[] }[];
  /** 同じ店舗を指す行が2回以上あった（1件として扱う） */
  duplicated: string[];
};

type Bucket = { shop: MatchShop; alias?: string };

function push(map: Map<string, Bucket[]>, key: string, entry: Bucket) {
  if (!key) return;
  const cur = map.get(key);
  if (cur) cur.push(entry);
  else map.set(key, [entry]);
}

export function buildShopIndex(shops: MatchShop[]) {
  const nameNorm = new Map<string, Bucket[]>();
  const aliasNorm = new Map<string, Bucket[]>();
  const nameLoose = new Map<string, Bucket[]>();
  const aliasLoose = new Map<string, Bucket[]>();
  for (const s of shops) {
    push(nameNorm, normKey(s.name), { shop: s });
    push(nameLoose, looseKey(s.name), { shop: s });
    for (const a of s.aliases || []) {
      if (!a) continue;
      // name と同じ別名は登録しない（同一店舗が二重に候補化するのを防ぐ）
      if (normKey(a) === normKey(s.name)) continue;
      push(aliasNorm, normKey(a), { shop: s, alias: a });
      push(aliasLoose, looseKey(a), { shop: s, alias: a });
    }
  }
  return { nameNorm, aliasNorm, nameLoose, aliasLoose };
}

/** 同一店舗を指す候補は1件に畳む（同じ店舗がnameとaliasの両方で当たるケース） */
function uniqueShops(buckets: Bucket[]): Bucket[] {
  const seen = new Set<string>();
  const out: Bucket[] = [];
  for (const b of buckets) {
    if (seen.has(b.shop.id)) continue;
    seen.add(b.shop.id);
    out.push(b);
  }
  return out;
}

export function matchShopNames(
  raw: string,
  shops: MatchShop[],
  index?: ReturnType<typeof buildShopIndex>,
): ShopNameMatchResult {
  const idx = index || buildShopIndex(shops);
  const lines = raw
    .split(/\r?\n/)
    .map(l => stripBullet(l).trim())
    .filter(l => l.length > 0);

  const res: ShopNameMatchResult = { matched: [], ambiguous: [], unmatched: [], duplicated: [] };
  const seenLine = new Set<string>();
  const matchedShopIds = new Set<string>();

  for (const line of lines) {
    const n = normKey(line);
    if (!n) continue;
    if (seenLine.has(n)) { res.duplicated.push(line); continue; }
    seenLine.add(n);

    const l = looseKey(line);
    const tiers: { by: "name" | "alias"; hits: Bucket[] }[] = [
      { by: "name", hits: uniqueShops(idx.nameNorm.get(n) || []) },
      { by: "alias", hits: uniqueShops(idx.aliasNorm.get(n) || []) },
      { by: "name", hits: uniqueShops((l && idx.nameLoose.get(l)) || []) },
      { by: "alias", hits: uniqueShops((l && idx.aliasLoose.get(l)) || []) },
    ];

    const tier = tiers.find(t => t.hits.length > 0);
    if (tier) {
      if (tier.hits.length > 1) {
        res.ambiguous.push({ input: line, candidates: tier.hits.map(h => h.shop) });
        continue;
      }
      const hit = tier.hits[0];
      // 旧名と新名の両方が貼られていた場合、同じ店舗を2回数えない
      if (matchedShopIds.has(hit.shop.id)) { res.duplicated.push(line); continue; }
      matchedShopIds.add(hit.shop.id);
      res.matched.push({ input: line, shop: hit.shop, matchedBy: tier.by, via: hit.alias });
      continue;
    }

    // 未検出: 候補だけ出す（自動チェックはしない）
    const suggestions = shops
      .map(s => {
        const keys = [s.name, ...(s.aliases || [])].map(looseKey).filter(Boolean);
        let best = 0;
        for (const sl of keys) {
          const contain = l && (sl.includes(l) || l.includes(sl)) ? 0.3 : 0;
          best = Math.max(best, similarity(l, sl) + contain);
        }
        return { s, score: best };
      })
      .filter(x => x.score >= 0.45)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(x => x.s);
    res.unmatched.push({ input: line, suggestions });
  }

  return res;
}
