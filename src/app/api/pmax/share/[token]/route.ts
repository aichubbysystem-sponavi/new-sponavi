import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getStoreDetail } from "@/lib/google-ads";
import { getGbpDataForShop } from "@/lib/pmax-sheet";
import { getPmaxCache, setPmaxCache } from "@/lib/pmax-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** GET: トークンでレポートデータを取得（認証不要） */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  try {
    const sb = getSupabase();
    const { data: shareData } = await sb
      .from("pmax_share_tokens")
      .select("shop_name, year, month, summary_text")
      .eq("token", token)
      .single();

    if (!shareData) {
      return NextResponse.json({ error: "無効または期限切れのリンクです" }, { status: 404 });
    }

    const { shop_name: shopName, year, month, summary_text: summaryText } = shareData;

    // キャッシュチェック
    const cacheKey = `share:${token}`;
    const cached = await getPmaxCache<{ monthly: unknown[]; daily: unknown[]; gbp: unknown[] }>(cacheKey);
    if (cached) {
      return NextResponse.json({ ...cached, shopName, year, month, summaryText: summaryText || "", cached: true });
    }

    // 月次: 13ヶ月分
    const monthlyEnd = new Date(year, month, 0);
    const monthlyStart = new Date(year, month - 1 - 13, 1);
    // 日次: 対象月のみ
    const dailyStart = new Date(year, month - 1, 1);
    const dailyEnd = new Date(year, month, 0);

    // store-summaryキャッシュからaccountIdsを取得（全アカウント検索を回避）
    let knownAccountIds: string[] | undefined;
    const { data: cacheRows } = await sb.from("pmax_cache").select("cache_key, data");
    if (cacheRows) {
      for (const row of cacheRows) {
        if (!row.cache_key.startsWith("store-summary:")) continue;
        const stores = (row.data as { stores?: { shopName: string; accountIds: string[] }[] })?.stores;
        const match = stores?.find(s => s.shopName === shopName);
        if (match?.accountIds) { knownAccountIds = match.accountIds; break; }
      }
    }

    const [adsData, gbpData] = await Promise.all([
      getStoreDetail(
        shopName,
        fmtDate(monthlyStart), fmtDate(monthlyEnd),
        knownAccountIds,
        fmtDate(dailyStart), fmtDate(dailyEnd),
      ),
      getGbpDataForShop(shopName).catch(() => []),
    ]);

    const result = {
      monthly: adsData.monthly,
      daily: adsData.daily,
      gbp: gbpData,
    };

    setPmaxCache(cacheKey, result);

    return NextResponse.json({ ...result, shopName, year, month, summaryText: summaryText || "", cached: false });
  } catch (err) {
    console.error("[pmax/share/token] Error:", err);
    return NextResponse.json({ error: "データ取得に失敗しました" }, { status: 500 });
  }
}
