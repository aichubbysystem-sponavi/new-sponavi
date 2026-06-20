import { NextRequest, NextResponse } from "next/server";
import { getSupabase, verifyAuth } from "@/lib/supabase";

export const dynamic = "force-dynamic";



/**
 * GET /api/report/display-settings?shopId=xxx
 */
export async function GET(request: NextRequest) {
  const shopId = request.nextUrl.searchParams.get("shopId");
  if (!shopId) return NextResponse.json({ error: "shopId必須" }, { status: 400 });

  const supabase = getSupabase();
  const { data } = await supabase
    .from("report_display_settings")
    .select("section_visibility, kw_visibility, rw_visibility")
    .eq("shop_id", shopId)
    .maybeSingle();

  return NextResponse.json(data || { section_visibility: {}, kw_visibility: {}, rw_visibility: {} });
}

/**
 * PUT /api/report/display-settings
 * { shopId, sectionVisibility?, kwVisibility?, rwVisibility? }
 */
export async function PUT(request: NextRequest) {
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const body = await request.json();
  const { shopId, sectionVisibility, kwVisibility, rwVisibility } = body;
  if (!shopId) return NextResponse.json({ error: "shopId必須" }, { status: 400 });

  const supabase = getSupabase();

  const row: Record<string, any> = {
    shop_id: shopId,
    updated_at: new Date().toISOString(),
  };
  if (sectionVisibility !== undefined) row.section_visibility = sectionVisibility;
  if (kwVisibility !== undefined) row.kw_visibility = kwVisibility;
  if (rwVisibility !== undefined) row.rw_visibility = rwVisibility;

  const { error } = await supabase
    .from("report_display_settings")
    .upsert(row, { onConflict: "shop_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
