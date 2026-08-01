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
// 取得可否の判定は month-utils.ts（依存なし・テスト可能）に置く
export { COMPETITOR_FETCH_MONTHS_BACK, isCompetitorFetchAllowed } from "./month-utils";
import { isCompetitorFetchAllowed, normalizeMonthLabel } from "./month-utils";

/**
 * レポート表示用の読み込み。**課金しない**（保存済みのみ）。
 *
 * 以前はここで自動取得していたが、レポートを開くだけで ¥4.8 が発生していた。
 * 611店舗を開けば約¥2,900が意図せず走る。取得は明示的なボタン操作に限定する
 * （POST /api/report/competitors）。
 */
export async function loadCompetitorComparison(shopName: string, displayMonth?: string): Promise<CompetitorComparison | null> {
  if (!displayMonth) return null;
  return await getStoredCompetitors(shopName, displayMonth);
}

/**
 * 月キーを "YYYY/M" に統一する。
 *
 * DBのUNIQUEは (shop_name, month) なので、"2026/06" と "2026/6" は別行になる。
 * レポート側は normalizedMonth でゼロ埋めを落としてから読むのに、
 * 取得側は画面から来た値をそのまま保存していたため、
 * 「取得済みなのにレポートに出ない」「同じ月に2回課金される」が起きていた。
 */
function normalizeMonthKey(month: string): string {
  return normalizeMonthLabel(month) || month;
}

/** 保存済みの月次データを取得（fetchしない・課金なし） */
export async function getStoredCompetitors(shopName: string, month: string): Promise<CompetitorComparison | null> {
  try {
    const supabase = getSupabase();
    const { data } = await supabase
      .from("competitor_reviews")
      .select("month, keyword, self, competitors, created_at")
      .eq("shop_name", shopName.normalize("NFC"))
      .eq("month", normalizeMonthKey(month))
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

/** 取得の結果。課金の有無と失敗理由を必ず返す（¥0と報告してしまう事故を防ぐ） */
export interface CompetitorFetchOutcome {
  data: CompetitorComparison | null;
  /** Places API を実際に呼んだか（＝課金が発生したか） */
  charged: boolean;
  /** data が null のときの理由。画面に出して対処できるようにする */
  reason?: "no_api_key" | "no_coords" | "no_keyword" | "api_error" | "no_results" | "save_failed" | "exception";
}

/**
 * 対象月のデータを取得。未保存ならPlaces APIで取得して保存する（¥4.8/回）。
 * 課金の有無と失敗理由を返す。
 */
export async function fetchAndStoreCompetitorsDetailed(
  shopName: string,
  monthRaw: string,
): Promise<CompetitorFetchOutcome> {
  const outcome: CompetitorFetchOutcome = { data: null, charged: false };
  // 保存キーは必ず正規化する。画面から "2026/06" が来ると、レポートが読む
  // "2026/6" とは別行になり、取得済みなのにページが出ない／再課金される
  const month = normalizeMonthKey(monthRaw);
  const normalized = shopName.normalize("NFC");

  // 1. 保存済みなら即返す（月1回課金ガード）
  const stored = await getStoredCompetitors(normalized, month);
  if (stored) return { data: stored, charged: false };

  if (!GCP_API_KEY) return { ...outcome, reason: "no_api_key" };

  const supabase = getSupabase();

  // 2. 店舗情報（座標・place_id）
  const { data: shop } = await supabase
    .from("shops")
    .select("id, name, gbp_latitude, gbp_longitude, gbp_place_id, gbp_shop_name, gbp_main_category")
    .eq("name", normalized)
    .limit(1)
    .maybeSingle();
  if (!shop?.gbp_latitude || !shop?.gbp_longitude) return { ...outcome, reason: "no_coords" };

  // 3. 検索KW: メインKW（順位計測と同じ軸）→ 無ければGBPカテゴリ
  //
  // main_keyword に明示指定があればそれを使う。指定が無ければ従来どおり keywords[0]。
  // 先頭固定だと、シート側の並びが変わっただけで競合比較の対象キーワードが
  // 黙って変わってしまうため、管理画面から指定できるようにした。
  let keyword = "";
  {
    // main_keyword 列が未作成の環境でも壊れないよう、keywords だけは必ず取得する。
    // 1クエリにまとめると、列が無いときPostgRESTがエラーを返して data が null になり、
    // keywords まで空になってキーワード解決に失敗する（＝競合比較のページが消える）
    const { data: kwRow, error } = await supabase
      .from("shop_keywords")
      .select("keywords")
      .eq("shop_id", shop.id)
      .maybeSingle();
    if (error) console.error("[competitor] shop_keywords select failed:", error.message);
    const list: string[] = kwRow?.keywords || [];

    let main = "";
    const { data: mkRow } = await supabase
      .from("shop_keywords")
      .select("main_keyword")
      .eq("shop_id", shop.id)
      .maybeSingle();
    main = (mkRow as any)?.main_keyword || ""; // 列が無い場合は null → ""

    // 指定が実際のKW一覧に残っている場合のみ採用（KWが差し替わった後の亡霊を防ぐ）
    keyword = main && list.includes(main) ? main : (list[0] || "");
  }
  if (!keyword) keyword = shop.gbp_main_category || "";
  if (!keyword) return { ...outcome, reason: "no_keyword" };

  // 4. Places Text Search（評価・口コミ数込み = Pro SKU ¥4.8/回）
  //
  // ここから先は「APIを呼んだ＝課金された」区間。
  // 以前はこの中で null を返す経路が3つあり、課金済みなのに呼び出し側は
  // 失敗として扱い「¥0・失敗」と報告していた（実課金と表示の乖離）。
  // 課金の事実は outcome.charged で必ず返す。
  outcome.charged = true;
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
      return { ...outcome, reason: "api_error" };
    }
    const data = await res.json();
    const places: { id?: string; displayName?: { text?: string }; rating?: number; userRatingCount?: number }[] = data.places || [];
    if (places.length === 0) return { ...outcome, reason: "no_results" };

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
    if (upErr) {
      // 保存に失敗したのに成功として返すと、次回も未保存と判定されて
      // Places APIを再度叩き、同じ店舗に何度でも課金が発生する。
      // データは返しつつ「保存できていない」ことを呼び出し側へ伝える
      console.error("[competitor-fetch] upsert error:", upErr.message);
      return { data: result, charged: true, reason: "save_failed" };
    }

    return { data: result, charged: true };
  } catch (e: any) {
    console.error("[competitor-fetch] error:", e?.message || e);
    return { ...outcome, reason: "exception" };
  }
}

/**
 * 後方互換のラッパー。データだけが必要な呼び出し元向け。
 * 課金の有無を扱う場合は fetchAndStoreCompetitorsDetailed を使うこと。
 */
export async function fetchAndStoreCompetitors(
  shopName: string,
  month: string,
): Promise<CompetitorComparison | null> {
  return (await fetchAndStoreCompetitorsDetailed(shopName, month)).data;
}
