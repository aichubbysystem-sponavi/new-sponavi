import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getGroupStores, normalizeShopName } from "@/lib/pmax-groups";

export const dynamic = "force-dynamic";

/**
 * GET /api/pmax/group-share/[token]/store?name=<店舗名>&year=YYYY&month=M
 * 認証不要。グループ共有トークンの範囲内で、指定店舗の詳細レポートデータを返す。
 * その店舗がトークンのグループに属していない場合は 403。
 * レスポンス形状は /api/pmax/share/[token] と同一（PmaxReportView が消費）。
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const sp = request.nextUrl.searchParams;
  const nameParam = sp.get("name") || "";

  const now = new Date();
  const year = Number(sp.get("year")) || now.getFullYear();
  const month = Number(sp.get("month")) || now.getMonth() + 1;

  if (!nameParam) {
    return NextResponse.json({ error: "店舗名が指定されていません" }, { status: 400 });
  }
  if (year < 2000 || year > 2100 || month < 1 || month > 12) {
    return NextResponse.json({ error: "year / month が不正です" }, { status: 400 });
  }

  try {
    const sb = getSupabase();

    // トークン → グループ名
    const { data: share } = await sb
      .from("pmax_group_shares")
      .select("group_name")
      .eq("token", token)
      .single();

    if (!share) {
      return NextResponse.json({ error: "無効なリンクです" }, { status: 404 });
    }

    // このグループの店舗リストを取得し、要求された店舗が所属しているか検証
    const group = await getGroupStores(share.group_name);
    if (!group) {
      return NextResponse.json({ error: "グループが見つかりません" }, { status: 404 });
    }
    const target = normalizeShopName(nameParam);
    const belongs = group.stores.some((s) => normalizeShopName(s) === target);
    if (!belongs) {
      return NextResponse.json({ error: "この店舗はグループに含まれていません" }, { status: 403 });
    }

    // DB上の正確な店舗名（表記ゆれ対策で正規化一致を採用）
    // pmax_store_data の shop_name で厳密一致を狙うが、シート表記とDB表記が
    // 微妙に異なる場合に備え、対象月データから正規化一致する実名を特定する。
    const monthKey = `${year}-${String(month).padStart(2, "0")}`;

    // 13ヶ月分の月リスト
    const months: string[] = [];
    for (let i = 12; i >= 0; i--) {
      const d = new Date(year, month - 1 - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }

    // まず対象月＋前後の全データから、この店舗の実際のshop_nameを解決
    // （店舗名で直接 .eq() すると表記ゆれで取りこぼすため in(months) で広めに取得）
    const { data: nameRows } = await sb
      .from("pmax_store_data")
      .select("shop_name")
      .in("month", months)
      .limit(20000);

    const dbShopName =
      (nameRows || []).map((r) => r.shop_name).find((n) => normalizeShopName(n) === target) || nameParam;

    // 月次データ
    const { data: monthlyRows } = await sb
      .from("pmax_store_data")
      .select("*")
      .eq("shop_name", dbShopName)
      .in("month", months)
      .order("month", { ascending: true });

    // 日次データ（対象月のみ）
    const startDate = `${monthKey}-01`;
    const endDay = new Date(year, month, 0).getDate();
    const endDate = `${monthKey}-${String(endDay).padStart(2, "0")}`;
    const { data: dailyRows } = await sb
      .from("pmax_store_daily")
      .select("*")
      .eq("shop_name", dbShopName)
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

    // GBPデータ
    const gbpMonths = months.map((m) => {
      const [yy, mm] = m.split("-");
      return `${yy}/${mm}`;
    });
    const { data: gbpRows } = await sb
      .from("pmax_gbp_data")
      .select("*")
      .eq("shop_name", dbShopName)
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

    return NextResponse.json({
      monthly,
      daily,
      gbp,
      shopName: dbShopName,
      year,
      month,
      summaryText: "",
    });
  } catch (err) {
    console.error("[pmax/group-share/token/store] Error:", err);
    return NextResponse.json({ error: "データ取得に失敗しました" }, { status: 500 });
  }
}
