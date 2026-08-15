"use client";

import { useEffect, useState } from "react";
import api from "@/lib/api";

/**
 * shops.gbp_shop_name（GBP上の現在の店名）を shopId => 名前 で返すフック。
 *
 * shops.name は「システム全体の結合キー」なのでGBPの改名に追従しない（2026-08-08の設計判断）。
 * そのため業態変更などで改名された店舗は、現場が使う名前とDB上の name が食い違う。
 *   例) name = アイブロウサロンWHITE EYE まつ毛と眉毛の専門店 高崎店 ホワイトアイ
 *       gbp_shop_name = ジェルネイル専門 WHITE NAIL 高崎店
 * Go APIの /api/shop は gbp_shop_name を返さないので Supabase から補完する。
 */

let cache: Promise<Record<string, string>> | null = null;

export function loadGbpAliases(): Promise<Record<string, string>> {
  if (!cache) {
    cache = api.get("/api/report/shop-gbp-info", { timeout: 20000 })
      .then(r => {
        const map: Record<string, string> = {};
        for (const g of (r.data?.shops || [])) {
          // 店名はNFCに揃える（shop-provider が Go API側をNFC正規化しているのに合わせる）
          if (g?.id && g?.gbp_shop_name) map[g.id] = String(g.gbp_shop_name).normalize("NFC");
        }
        return map;
      })
      .catch(err => { cache = null; throw err; }); // 失敗を握りつぶして永久にキャッシュしない
  }
  return cache;
}

export function useGbpAliases() {
  const [aliases, setAliases] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    loadGbpAliases()
      .then(m => { if (alive) { setAliases(m); setError(false); } })
      .catch(() => { if (alive) { setAliases({}); setError(true); } });
    return () => { alive = false; };
  }, []);

  return { aliases, error };
}

/**
 * 店舗リストを「シート照合用の店舗名リスト」に展開する。
 * auto-post の filterShopNames はシートB列と完全一致で比較されるため、
 * 改名店舗はシートが新旧どちらの表記でも通るように両方を渡す。
 */
export function expandShopNames(
  list: { id: string; name: string }[],
  aliases: Record<string, string> | null,
): string[] {
  const out: string[] = [];
  for (const s of list) {
    out.push(s.name);
    const g = aliases?.[s.id];
    if (g && g !== s.name) out.push(g);
  }
  return Array.from(new Set(out));
}
