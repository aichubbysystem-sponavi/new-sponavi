import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_KEY);
}

/**
 * GET /api/report/grid-ranking-presets
 * いつも計測する店舗一覧を取得
 */
export async function GET() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("grid_ranking_presets")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 各店舗のshop_keywordsも取得して付与
  const shopIds = (data || []).map((p: any) => p.shop_id);
  const { data: kwData } = shopIds.length > 0
    ? await supabase.from("shop_keywords").select("shop_id, keywords").in("shop_id", shopIds)
    : { data: [] };
  const kwMap = new Map<string, string[]>();
  for (const kw of (kwData || [])) {
    kwMap.set(kw.shop_id, kw.keywords || []);
  }
  for (const p of (data || [])) {
    (p as any).all_keywords = kwMap.get(p.shop_id) || [];
  }

  // 月額コスト見積もり
  let totalRequests = 0;
  for (const p of (data || [])) {
    const size = p.grid_size || 7;
    totalRequests += size * size;
  }
  const costPerRequest = 0.032;
  const freeCredit = 200;
  const monthlyCost = Math.max(0, totalRequests * costPerRequest - freeCredit);

  return NextResponse.json({
    presets: data || [],
    estimate: {
      totalShops: (data || []).length,
      totalRequests,
      monthlyCost: monthlyCost.toFixed(0),
      freeRequests: Math.floor(freeCredit / costPerRequest),
      withinFree: monthlyCost === 0,
    },
  });
}

/**
 * POST /api/report/grid-ranking-presets
 * いつも計測する店舗を追加
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { shops } = body as { shops: { shopId: string; shopName: string; keyword?: string; gridSize?: number }[] };

  if (!shops || shops.length === 0) {
    return NextResponse.json({ error: "店舗が指定されていません" }, { status: 400 });
  }

  const supabase = getSupabase();
  const rows = shops.map(s => ({
    shop_id: s.shopId,
    shop_name: s.shopName,
    keyword: s.keyword || null,
    grid_size: s.gridSize || 7,
  }));

  const { error } = await supabase
    .from("grid_ranking_presets")
    .upsert(rows, { onConflict: "shop_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, count: rows.length });
}

/**
 * DELETE /api/report/grid-ranking-presets
 * いつも計測する店舗を削除
 */
export async function DELETE(request: NextRequest) {
  const body = await request.json();
  const { shopIds } = body as { shopIds: string[] };

  if (!shopIds || shopIds.length === 0) {
    return NextResponse.json({ error: "shopIdsが必要です" }, { status: 400 });
  }

  const supabase = getSupabase();
  const { error } = await supabase
    .from("grid_ranking_presets")
    .delete()
    .in("shop_id", shopIds);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
