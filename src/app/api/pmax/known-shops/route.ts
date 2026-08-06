import { NextRequest, NextResponse } from "next/server";
import { getSupabase, requireRole } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * GET /api/pmax/known-shops?month=YYYY-MM
 * pmax_account_mappingから既知の店舗名一覧を返す（Google Ads API呼び出しなし）
 * month指定時は、その月のpmax_store_dataに1行も無い店舗名を missing として返す
 * （同期の部分失敗・新規店舗の取りこぼしを選択パネルで可視化するため）
 */
export async function GET(request: NextRequest) {
  const r = await requireRole(request, ["president", "executive", "manager"]);
  if (r.error) return r.error;

  const sb = getSupabase();
  const { data, error } = await sb
    .from("pmax_account_mapping")
    .select("shop_name")
    .limit(5000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const shops = Array.from(new Set((data || []).map((r: { shop_name: string }) => r.shop_name))).sort();

  const month = request.nextUrl.searchParams.get("month");
  let missing: string[] | undefined;
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    // PostgRESTは1リクエスト最大1000行のためページングで全件取得（言語別に複数行あるため店舗数×言語数）
    const present = new Set<string>();
    for (let from = 0; from < 10000; from += 1000) {
      const { data: rows, error: e2 } = await sb
        .from("pmax_store_data")
        .select("shop_name")
        .eq("month", month)
        .range(from, from + 999);
      if (e2) {
        return NextResponse.json({ error: e2.message }, { status: 500 });
      }
      for (const row of rows || []) present.add((row as { shop_name: string }).shop_name);
      if (!rows || rows.length < 1000) break;
    }
    missing = shops.filter((s) => !present.has(s));
  }

  return NextResponse.json({ shops, missing });
}
