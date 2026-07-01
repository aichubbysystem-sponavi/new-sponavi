import { NextRequest, NextResponse } from "next/server";
import { getSupabase, requireRole } from "@/lib/supabase";
import { getCampaignDaily, parseCampaignName } from "@/lib/google-ads";

export const dynamic = "force-dynamic";

/**
 * GET /api/pmax/store-detail?shopName=X&month=YYYY-MM
 * Supabaseから店舗の月次+日次データを返す（Google Ads APIは呼ばない）
 * 月次は13ヶ月分（対象月から遡り）、日次は対象月のみ
 */
export async function GET(request: NextRequest) {
  const r = await requireRole(request, ["president", "manager"]);
  if (r.error) return r.error;

  const { searchParams } = request.nextUrl;
  const shopName = searchParams.get("shopName");
  const month = searchParams.get("month");

  if (!shopName || !month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "shopName, month(YYYY-MM) は必須です" }, { status: 400 });
  }

  const sb = getSupabase();

  // 13ヶ月分の月リストを生成（対象月を含む過去13ヶ月）
  const [y, m] = month.split("-").map(Number);
  const months: string[] = [];
  for (let i = 12; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  // 月次データ取得（13ヶ月分）
  const { data: monthlyRows, error: mErr } = await sb
    .from("pmax_store_data")
    .select("*")
    .eq("shop_name", shopName)
    .in("month", months)
    .order("month", { ascending: true });

  if (mErr) {
    console.error("[pmax/store-detail] monthly error:", mErr.message);
    return NextResponse.json({ error: "月次データ取得失敗" }, { status: 500 });
  }

  // 日次データ取得（対象月のみ）— DBになければAPIからオンデマンド取得
  const startDate = `${month}-01`;
  const endDay = new Date(y, m, 0).getDate();
  const endDate = `${month}-${String(endDay).padStart(2, "0")}`;

  let dailyRows: typeof monthlyRows = [];
  const { data: dbDaily } = await sb
    .from("pmax_store_daily")
    .select("*")
    .eq("shop_name", shopName)
    .gte("date", startDate)
    .lte("date", endDate)
    .order("date", { ascending: true });

  if (dbDaily && dbDaily.length > 0) {
    dailyRows = dbDaily;
  } else {
    // DBにないのでAPIから取得して保存（この店舗のaccountIdだけ使う）
    try {
      const accountIds = Array.from(new Set((monthlyRows || []).map((r) => r.account_id).filter(Boolean)));
      if (accountIds.length > 0) {
        const apiDaily: typeof dailyRows = [];
        for (const accId of accountIds) {
          const rows = await getCampaignDaily(accId, startDate, endDate).catch(() => []);
          for (const c of rows) {
            const parsed = parseCampaignName(c.campaignName);
            if (parsed.shopName === shopName) {
              apiDaily.push({
                id: "",
                shop_name: shopName,
                language: parsed.language,
                date: c.date || "",
                campaign_name: c.campaignName,
                campaign_id: c.campaignId,
                impressions: c.impressions,
                clicks: c.clicks,
                ctr: c.ctr,
                average_cpc: c.averageCpc,
                cost_micros: c.costMicros,
                account_id: accId,
                synced_at: new Date().toISOString(),
              });
            }
          }
        }
        // DB保存
        if (apiDaily.length > 0) {
          await sb.from("pmax_store_daily").delete().eq("shop_name", shopName).gte("date", startDate).lte("date", endDate);
          const insertRows = apiDaily.map(({ id: _id, ...rest }) => rest);
          await sb.from("pmax_store_daily").insert(insertRows);
        }
        dailyRows = apiDaily;
      }
    } catch (e) {
      console.error("[pmax/store-detail] daily API fetch:", e instanceof Error ? e.message : e);
    }
  }

  // フロントの既存形式に合わせる
  const monthly = (monthlyRows || []).map((r) => ({
    language: r.language,
    campaignName: r.campaign_name,
    campaignId: r.campaign_id,
    month: r.month,
    impressions: Number(r.impressions),
    clicks: Number(r.clicks),
    ctr: Number(r.ctr),
    averageCpc: Number(r.average_cpc),
    costMicros: Number(r.cost_micros),
  }));

  const daily = (dailyRows || []).map((r) => ({
    language: r.language,
    campaignName: r.campaign_name,
    campaignId: r.campaign_id,
    date: r.date,
    impressions: Number(r.impressions),
    clicks: Number(r.clicks),
    ctr: Number(r.ctr),
    averageCpc: Number(r.average_cpc),
    costMicros: Number(r.cost_micros),
  }));

  // GBPデータ取得（13ヶ月分、"YYYY/MM"形式）
  const gbpMonths = months.map((m) => {
    const [yy, mm] = m.split("-");
    return `${yy}/${mm}`;
  });
  const { data: gbpRows } = await sb
    .from("pmax_gbp_data")
    .select("*")
    .eq("shop_name", shopName)
    .in("month", gbpMonths);

  const gbp = (gbpRows || []).map((r) => ({
    month: r.month,
    shopName: r.shop_name,
    totalImpressions: Number(r.total_impressions),
    totalVisits: Number(r.total_visits),
    phone: Number(r.phone),
    directions: Number(r.directions),
    website: Number(r.website),
    menuClicks: Number(r.menu_clicks),
    saveShare: Number(r.save_share),
  }));

  // 同期ログ
  const { data: syncLog } = await sb
    .from("pmax_sync_log")
    .select("synced_at, status")
    .eq("shop_name", shopName)
    .eq("month", month)
    .maybeSingle();

  return NextResponse.json({
    monthly,
    daily,
    gbp,
    lastSyncedAt: syncLog?.synced_at || null,
    syncStatus: syncLog?.status || "not_synced",
  });
}
