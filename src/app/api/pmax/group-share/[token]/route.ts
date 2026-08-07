import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getGroupStores, normalizeShopName } from "@/lib/pmax-groups";
import { isShareActive } from "@/lib/share-token";
import { applyAdsOverrides, parseReportSettings } from "@/lib/pmax-overrides";

export const dynamic = "force-dynamic";

/**
 * GET /api/pmax/group-share/[token]?month=YYYY-MM
 * 認証不要。トークン→グループ名を引き、そのグループに属する店舗のデータ「のみ」返す。
 * 他グループの店舗はレスポンスに一切含めない。
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const monthParam = request.nextUrl.searchParams.get("month");

  // 月指定（未指定なら当月）
  let month = monthParam || "";
  if (!month) {
    const now = new Date();
    month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "month は YYYY-MM 形式で指定してください" }, { status: 400 });
  }

  try {
    const sb = getSupabase();

    // トークン → グループ名（有効期限・失効チェック込み）
    const { data: share } = await sb
      .from("pmax_group_shares")
      .select("group_name, expires_at, revoked_at")
      .eq("token", token)
      .single();

    if (!share || !isShareActive(share)) {
      return NextResponse.json({ error: "無効または期限切れのリンクです" }, { status: 404 });
    }

    // 現在のシート定義から、このグループの店舗名リストを取得
    const group = await getGroupStores(share.group_name);
    if (!group || group.stores.length === 0) {
      return NextResponse.json({ groupName: share.group_name, month, stores: [] });
    }

    // グループ所属店舗の正規化名セット（このセットに含まれる店舗だけを対象にする）
    const memberSet = new Set(group.stores.map((s) => normalizeShopName(s)));

    // 対象月の全店舗データを取得し、グループ所属店舗のみに絞り込む
    const { data: rows, error } = await sb
      .from("pmax_store_data")
      .select("shop_name, language, impressions, clicks, cost_micros")
      .eq("month", month)
      .limit(10000);

    if (error) {
      console.error("[pmax/group-share/token] DB error:", error.message);
      return NextResponse.json({ error: "データ取得に失敗しました" }, { status: 500 });
    }

    // 言語別に集計してから店舗合計を出す（レポートの手動編集を一覧の数値にも反映するため）
    const storeMap = new Map<string, {
      shopName: string;
      langAgg: Map<string, { impressions: number; clicks: number; ctr: number; averageCpc: number; costMicros: number }>;
    }>();

    for (const row of rows || []) {
      if (!memberSet.has(normalizeShopName(row.shop_name))) continue; // グループ外は除外
      let store = storeMap.get(row.shop_name);
      if (!store) {
        store = { shopName: row.shop_name, langAgg: new Map() };
        storeMap.set(row.shop_name, store);
      }
      const lang = row.language || "";
      const agg = store.langAgg.get(lang) || { impressions: 0, clicks: 0, ctr: 0, averageCpc: 0, costMicros: 0 };
      agg.impressions += Number(row.impressions || 0);
      agg.clicks += Number(row.clicks || 0);
      agg.costMicros += Number(row.cost_micros || 0);
      store.langAgg.set(lang, agg);
    }

    // 手動編集（数値上書き）を取得し、詳細レポートと同じロジックで一覧の合計に適用
    const shopNames = Array.from(storeMap.keys());
    const overridesByShop = new Map<string, Record<string, number>>();
    if (shopNames.length > 0) {
      const { data: settingsRows } = await sb
        .from("pmax_report_settings")
        .select("shop_name, overrides")
        .in("shop_name", shopNames);
      for (const s of settingsRows || []) {
        overridesByShop.set(s.shop_name, parseReportSettings(s).overrides);
      }
    }

    const stores = Array.from(storeMap.values())
      .map((v) => {
        const ov = overridesByShop.get(v.shopName) || {};
        let impressions = 0, clicks = 0, costMicros = 0;
        for (const [lang, agg] of Array.from(v.langAgg.entries())) {
          applyAdsOverrides(agg, `m|${lang}|${month}`, ov);
          impressions += agg.impressions;
          clicks += agg.clicks;
          costMicros += agg.costMicros;
        }
        // KPIサマリー合計の直接上書き（k|）は言語合算より優先
        const oImp = ov[`k|${month}|impressions`];
        if (oImp !== undefined) impressions = oImp;
        const oClk = ov[`k|${month}|clicks`];
        if (oClk !== undefined) clicks = oClk;
        const oCost = ov[`k|${month}|costYen`];
        if (oCost !== undefined) costMicros = Math.round(oCost * 1_000_000);
        return {
          shopName: v.shopName,
          languages: Array.from(v.langAgg.keys()).filter(Boolean).sort(),
          impressions,
          clicks,
          costMicros,
        };
      })
      .sort((a, b) => b.impressions - a.impressions);

    return NextResponse.json({
      groupName: group.name,
      month,
      stores,
      storeCount: stores.length,
    });
  } catch (err) {
    console.error("[pmax/group-share/token] Error:", err);
    return NextResponse.json({ error: "データ取得に失敗しました" }, { status: 500 });
  }
}
