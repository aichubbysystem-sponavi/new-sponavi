import { NextRequest, NextResponse } from "next/server";
import { getSupabase, requireRole } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * GET /api/pmax/known-shops
 * pmax_account_mappingから既知の店舗名一覧を返す（API呼び出しなし）
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
  return NextResponse.json({ shops });
}
