import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { isShareActive } from "@/lib/share-token";

export const dynamic = "force-dynamic";

/** GET: トークンでレポートデータを取得（認証不要、DBから読み込み） */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  try {
    const sb = getSupabase();
    const { data: shareData } = await sb
      .from("pmax_share_tokens")
      .select("shop_name, year, month, summary_text, expires_at, revoked_at")
      .eq("token", token)
      .single();

    if (!shareData || !isShareActive(shareData)) {
      return NextResponse.json({ error: "無効または期限切れのリンクです" }, { status: 404 });
    }

    const { shop_name: shopName, year, month, summary_text: summaryText } = shareData;
    const monthKey = `${year}-${String(month).padStart(2, "0")}`;

    // 13ヶ月分の月リストを生成
    const months: string[] = [];
    for (let i = 12; i >= 0; i--) {
      const d = new Date(year, month - 1 - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }

    // 月次データ取得
    const { data: monthlyRows } = await sb
      .from("pmax_store_data")
      .select("*")
      .eq("shop_name", shopName)
      .in("month", months)
      .order("month", { ascending: true });

    // 日次データ取得（対象月のみ）
    const startDate = `${monthKey}-01`;
    const endDay = new Date(year, month, 0).getDate();
    const endDate = `${monthKey}-${String(endDay).padStart(2, "0")}`;

    const { data: dailyRows } = await sb
      .from("pmax_store_daily")
      .select("*")
      .eq("shop_name", shopName)
      .gte("date", startDate)
      .lte("date", endDate)
      .order("date", { ascending: true });

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

    // GBPデータ取得
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
      reservation: Number(r.reservation ?? 0),
    }));

    return NextResponse.json({
      monthly,
      daily,
      gbp,
      shopName,
      year,
      month,
      summaryText: summaryText || "",
    });
  } catch (err) {
    console.error("[pmax/share/token] Error:", err);
    return NextResponse.json({ error: "データ取得に失敗しました" }, { status: 500 });
  }
}
