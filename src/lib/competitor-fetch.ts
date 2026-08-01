/**
 * 口コミの競合比較（同エリア）データの取得と月次保存
 *
 * レポートの「口コミ競合比較」ページ用。店舗のメインKW（順位計測と同じ軸）で
 * 周辺3kmの上位20店舗（評価・口コミ数込み）をPlaces APIから取得し、
 * (shop_name, month) 単位でDBに保存する。同月2回目以降はDBから返すため
 * 課金は月1回・1店舗¥4.8のみ。
 *
 * 自店の特定は place_id 一致を最優先（2026-07-29の一括取得で599店舗が保有）。
 * フォールバックは正規化した店名の相互includes（診断用 competitors/route.ts と同方式）。
 */
import { getSupabase } from "@/lib/supabase";
import type { CompetitorComparison, CompetitorEntry } from "@/lib/report-data";

const GCP_API_KEY = process.env.GCP_API_KEY || "";

/**
 * レポート表示用のローダー。
 * レポートは「最新の確定月＝前月」を表示する仕様のため、
 * 表示月が当月または前月（JST）→ DBに無ければ取得保存（¥4.8・月1回のみ課金）。
 * それより過去の月 → DB読みのみ（無ければnull=ページ非表示）。
 * ※競合の口コミ数は過去に遡って取れないため、保存されるのは常に「取得時点」の
 *   スナップショット（fetchedAtで明示）。表示月はレポートの紐付けキー。
 */
export async function loadCompetitorComparison(shopName: string, displayMonth?: string): Promise<CompetitorComparison | null> {
  if (!displayMonth) return null;
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  const y = jst.getUTCFullYear();
  const m = jst.getUTCMonth() + 1;
  const curLabel = `${y}/${m}`;
  const prevLabel = m === 1 ? `${y - 1}/12` : `${y}/${m - 1}`;
  if (displayMonth === curLabel || displayMonth === prevLabel) {
    return await fetchAndStoreCompetitors(shopName, displayMonth);
  }
  return await getStoredCompetitors(shopName, displayMonth);
}

/** 保存済みの月次データを取得（fetchしない・課金なし） */
export async function getStoredCompetitors(shopName: string, month: string): Promise<CompetitorComparison | null> {
  try {
    const supabase = getSupabase();
    const { data } = await supabase
      .from("competitor_reviews")
      .select("month, keyword, self, competitors, created_at")
      .eq("shop_name", shopName.normalize("NFC"))
      .eq("month", month)
      .maybeSingle();
    if (!data) return null;
    return {
      month: data.month,
      keyword: data.keyword,
      self: data.self || null,
      competitors: (data.competitors || []) as CompetitorEntry[],
      fetchedAt: data.created_at || null,
    };
  } catch {
    return null;
  }
}

/**
 * 対象月のデータを取得。未保存ならPlaces APIで取得して保存する（¥4.8/回）。
 * 座標なし・KWなし・API失敗時は null（レポート側はページ非表示で対応）。
 */
export async function fetchAndStoreCompetitors(shopName: string, month: string): Promise<CompetitorComparison | null> {
  const normalized = shopName.normalize("NFC");

  // 1. 保存済みなら即返す（月1回課金ガード）
  const stored = await getStoredCompetitors(normalized, month);
  if (stored) return stored;

  if (!GCP_API_KEY) return null;

  const supabase = getSupabase();

  // 2. 店舗情報（座標・place_id）
  const { data: shop } = await supabase
    .from("shops")
    .select("id, name, gbp_latitude, gbp_longitude, gbp_place_id, gbp_shop_name, gbp_main_category")
    .eq("name", normalized)
    .limit(1)
    .maybeSingle();
  if (!shop?.gbp_latitude || !shop?.gbp_longitude) return null;

  // 3. 検索KW: メインKW（順位計測と同じ軸）→ 無ければGBPカテゴリ
  //
  // main_keyword に明示指定があればそれを使う。指定が無ければ従来どおり keywords[0]。
  // 先頭固定だと、シート側の並びが変わっただけで競合比較の対象キーワードが
  // 黙って変わってしまうため、管理画面から指定できるようにした。
  let keyword = "";
  try {
    const { data: kwRow } = await supabase
      .from("shop_keywords")
      .select("keywords, main_keyword")
      .eq("shop_id", shop.id)
      .maybeSingle();
    const list: string[] = kwRow?.keywords || [];
    const main = (kwRow as any)?.main_keyword || "";
    // 指定が実際のKW一覧に残っている場合のみ採用（KWが差し替わった後の亡霊を防ぐ）
    keyword = main && list.includes(main) ? main : (list[0] || "");
  } catch {}
  if (!keyword) keyword = shop.gbp_main_category || "";
  if (!keyword) return null;

  // 4. Places Text Search（評価・口コミ数込み = Pro SKU ¥4.8/回）
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GCP_API_KEY,
        "X-Goog-FieldMask": "places.id,places.displayName,places.rating,places.userRatingCount",
      },
      body: JSON.stringify({
        textQuery: keyword,
        languageCode: "ja",
        locationBias: { circle: { center: { latitude: shop.gbp_latitude, longitude: shop.gbp_longitude }, radius: 3000 } },
        pageSize: 20,
      }),
    });
    if (!res.ok) {
      console.error("[competitor-fetch] Places API error:", res.status, await res.text().catch(() => ""));
      return null;
    }
    const data = await res.json();
    const places: { id?: string; displayName?: { text?: string }; rating?: number; userRatingCount?: number }[] = data.places || [];
    if (places.length === 0) return null;

    const entries: CompetitorEntry[] = places.map(p => ({
      name: p.displayName?.text || "",
      rating: p.rating || 0,
      reviewCount: p.userRatingCount || 0,
    }));

    // 5. 自店の特定: place_id一致 → 正規化名の相互includes
    const selfNameNorm = ((shop.gbp_shop_name || shop.name || "") as string).normalize("NFC").replace(/\s+/g, "");
    let selfIdx = -1;
    if (shop.gbp_place_id) {
      selfIdx = places.findIndex(p => p.id === shop.gbp_place_id);
    }
    if (selfIdx < 0) {
      selfIdx = places.findIndex(p => {
        const n = (p.displayName?.text || "").normalize("NFC").replace(/\s+/g, "");
        return n.length > 0 && (n.includes(selfNameNorm) || selfNameNorm.includes(n));
      });
    }
    const self = selfIdx >= 0
      ? { ...entries[selfIdx], rank: selfIdx + 1 }
      : null; // 上位20圏外（表示側は「圏外」表記で対応可能）

    const fetchedAt = new Date().toISOString();
    const result: CompetitorComparison = { month, keyword, self, competitors: entries, fetchedAt };

    // 6. 保存（upsert: 競合状態でも二重課金は最大1回分）
    const { error: upErr } = await supabase
      .from("competitor_reviews")
      .upsert(
        {
          shop_name: normalized,
          month,
          keyword,
          self,
          competitors: entries,
          created_at: fetchedAt,
        },
        { onConflict: "shop_name,month" }
      );
    if (upErr) console.error("[competitor-fetch] upsert error:", upErr.message);

    return result;
  } catch (e: any) {
    console.error("[competitor-fetch] error:", e?.message || e);
    return null;
  }
}
