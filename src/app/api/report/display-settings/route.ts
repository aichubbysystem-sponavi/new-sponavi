import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

let _sb: any = null;
function getSupabase(): any {
  return _sb ||= createClient(SUPABASE_URL, SUPABASE_KEY);
}

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
