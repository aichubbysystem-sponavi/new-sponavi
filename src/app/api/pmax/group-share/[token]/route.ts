import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getGroupStores, normalizeShopName } from "@/lib/pmax-groups";
import { isShareActive } from "@/lib/share-token";

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

    const storeMap = new Map<string, {
      shopName: string;
      languages: Set<string>;
      impressions: number;
      clicks: number;
      costMicros: number;
    }>();

    for (const row of rows || []) {
      if (!memberSet.has(normalizeShopName(row.shop_name))) continue; // グループ外は除外
      const existing = storeMap.get(row.shop_name);
      if (existing) {
        existing.languages.add(row.language);
        existing.impressions += Number(row.impressions || 0);
        existing.clicks += Number(row.clicks || 0);
        existing.costMicros += Number(row.cost_micros || 0);
      } else {
        storeMap.set(row.shop_name, {
          shopName: row.shop_name,
          languages: new Set([row.language]),
          impressions: Number(row.impressions || 0),
          clicks: Number(row.clicks || 0),
          costMicros: Number(row.cost_micros || 0),
        });
      }
    }

    const stores = Array.from(storeMap.values())
      .map((v) => ({
        shopName: v.shopName,
        languages: Array.from(v.languages).filter(Boolean).sort(),
        impressions: v.impressions,
        clicks: v.clicks,
        costMicros: v.costMicros,
      }))
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
