import { NextRequest, NextResponse } from "next/server";
import { getSupabase, requireRole } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * GET /api/report/kw-missing
 * KW未取得（source="not_found"）の店舗一覧を返す
 */
export async function GET(request: NextRequest) {
  const r = await requireRole(request, ["president", "manager"]);
  if (r.error) return r.error;

  const sb = getSupabase();
  const { data, error } = await sb
    .from("shop_keywords")
    .select("shop_id, updated_at")
    .eq("source", "not_found")
    .order("updated_at", { ascending: false })
    .limit(1000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // shop_idから店舗名を取得
  const shopIds = (data || []).map((r: { shop_id: string }) => r.shop_id);
  if (shopIds.length === 0) {
    return NextResponse.json({ shops: [] });
  }

  const { data: shopRows } = await sb
    .from("shops")
    .select("id, name")
    .in("id", shopIds)
    .limit(1000);

  const nameMap = new Map((shopRows || []).map((s: { id: string; name: string }) => [s.id, s.name]));

  const shops = (data || []).map((r: { shop_id: string; updated_at: string }) => ({
    shopId: r.shop_id,
    shopName: nameMap.get(r.shop_id) || r.shop_id,
    checkedAt: r.updated_at,
  }));

  return NextResponse.json({ shops, count: shops.length });
}
