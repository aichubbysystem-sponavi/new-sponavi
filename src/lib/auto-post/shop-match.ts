/**
 * シートB列の店舗名 ⇔ 店舗マスタ（shops.name / gbp_shop_name）の照合
 *
 * 1. 完全一致（全角半角・スペースの揺れだけ吸収）
 * 2. 末尾の英語名だけが違う場合の一致（2026-09-04 追加）
 *    例: マスタ「カネマス弥平とうふ店 KANEMASU YAHEI TOFU」 ⇔ シート「カネマス弥平とうふ店」
 *    英語名を落とした名前が指す店舗がマスタに **1店舗だけ** のときに限り一致させる。
 *    2店舗以上（「店A TOKYO」と「店A OSAKA」など）は取り違えを防ぐため不一致のままにする。
 *    英語名は「空白＋英数字で始まる3文字以上の末尾」だけを対象にし、「個室シーシャLuxia」のように
 *    空白なしで続く語や、全部英字の店名（KYOTO SAMURAI WALK）は対象にしない。
 */

/** 店舗名の正規化（全角半角・スペースの揺れを吸収） */
export function normName(s: string): string {
  return (s || "").normalize("NFKC").replace(/[\s　]+/g, "").toLowerCase();
}

/** 完全一致（正規化後） */
export function matchShopName(a: string, b: string): boolean {
  return normName(a) === normName(b);
}

/**
 * 末尾の英語名を落とした照合キー。ルールの適用外（落とすものが無い／落とすと日本語が残らない）なら ""。
 * 「カネマス弥平とうふ店 KANEMASU YAHEI TOFU」→「カネマス弥平とうふ店」
 */
export function looseKey(s: string): string {
  const n = (s || "").normalize("NFKC").trim();
  const m = n.match(/^(.*?\S)[\s　]+([A-Za-z0-9][A-Za-z0-9\s　.,&'’\-–—!?()/]{2,})$/);
  if (!m) return "";
  const head = m[1];
  // 落とした後に日本語（非ASCII）が残るときだけ有効。全部英字の店名はこのルールの対象外
  if (!/[^\x00-\x7F]/.test(head)) return "";
  return normName(head);
}

export type ShopLike = { id: string; name: string; gbp_shop_name?: string | null };

/**
 * 店舗マスタからシート名→店舗を引くリゾルバを作る。
 * 完全一致を最優先し、無ければ末尾英語名を吸収した照合で「候補が1店舗だけ」のときに返す。
 */
export function buildShopResolver<T extends ShopLike>(shops: T[]): (sheetName: string) => T | null {
  // 吸収後キー → 店舗id の集合（完全一致名のキーも入れる: 「カネマス弥平とうふ店」という別店舗が実在すれば候補2件になり止まる）
  const byKey = new Map<string, Set<string>>();
  const add = (k: string, id: string) => { if (!k) return; const set = byKey.get(k) || new Set<string>(); set.add(id); byKey.set(k, set); };
  for (const s of shops) {
    for (const nm of [s.name, s.gbp_shop_name || ""]) {
      if (!nm) continue;
      add(normName(nm), s.id);
      add(looseKey(nm), s.id);
    }
  }
  const byId = new Map(shops.map((s) => [s.id, s] as const));
  return (sheetName: string): T | null => {
    const exact = shops.find((s) => matchShopName(s.name, sheetName) || matchShopName(s.gbp_shop_name || "", sheetName));
    if (exact) return exact;
    for (const k of [looseKey(sheetName), normName(sheetName)]) {
      if (!k) continue;
      const ids = byKey.get(k);
      if (ids && ids.size === 1) return byId.get(Array.from(ids)[0]) || null;
    }
    return null;
  };
}
