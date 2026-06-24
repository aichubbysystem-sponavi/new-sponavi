import { NextRequest, NextResponse } from "next/server";
import { getSupabase, verifyAuth, verifyShopAccess } from "@/lib/supabase";

export const dynamic = "force-dynamic";



/**
 * GET /api/report/grid-ranking-presets
 * いつも計測する店舗一覧を取得
 */
export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

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
  // 座標ステータス取得
  const { data: shopCoords } = shopIds.length > 0
    ? await supabase.from("shops").select("id, gbp_latitude, gbp_longitude").in("id", shopIds)
    : { data: [] };
  const coordMap = new Map<string, boolean>();
  for (const s of (shopCoords || [])) {
    coordMap.set(s.id, !!(s.gbp_latitude && s.gbp_latitude !== 0));
  }

  // 最新計測結果を取得（各店舗の最新1件）
  const { data: latestLogs } = shopIds.length > 0
    ? await supabase.from("grid_ranking_logs")
        .select("shop_id, keyword, measured_at, results")
        .in("shop_id", shopIds)
        .order("measured_at", { ascending: false })
    : { data: [] };
  const logMap = new Map<string, { measured_at: string; keyword: string; avg_rank: number | null; top3: number; total: number }>();
  for (const log of (latestLogs || [])) {
    if (!logMap.has(log.shop_id)) {
      const results = log.results || [];
      const ranked = results.filter((r: any) => r.rank > 0);
      const avgRank = ranked.length > 0
        ? ranked.reduce((sum: number, r: any) => sum + r.rank, 0) / ranked.length
        : null;
      logMap.set(log.shop_id, {
        measured_at: log.measured_at,
        keyword: log.keyword,
        avg_rank: avgRank ? parseFloat(avgRank.toFixed(1)) : null,
        top3: results.filter((r: any) => r.rank > 0 && r.rank <= 3).length,
        total: results.length,
      });
    }
  }

  for (const p of (data || [])) {
    (p as any).all_keywords = kwMap.get(p.shop_id) || [];
    (p as any).has_coordinates = coordMap.get(p.shop_id) || false;
    (p as any).last_measurement = logMap.get(p.shop_id) || null;
  }

  // 月額コスト見積もり（メインKW=full grid、サブKW=3×3=9地点）
  let totalRequests = 0;
  for (const p of (data || [])) {
    const size = p.grid_size || 7;
    const kwCount = Math.max(1, ((p as any).all_keywords || []).length);
    // メイン1KW=full grid + サブKW=3×3(9地点)
    totalRequests += size * size + Math.max(0, kwCount - 1) * 9;
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
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid || !auth.sub) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const body = await request.json();
  const { shops } = body as { shops: { shopId: string; shopName: string; keyword?: string; gridSize?: number }[] };

  if (!shops || shops.length === 0) {
    return NextResponse.json({ error: "店舗が指定されていません" }, { status: 400 });
  }

  // 認可: 全店舗のアクセス権を検証
  for (const s of shops) {
    const hasAccess = await verifyShopAccess(auth.sub, s.shopName);
    if (!hasAccess) return NextResponse.json({ error: `${s.shopName}へのアクセス権がありません` }, { status: 403 });
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
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid || !auth.sub) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const body = await request.json();
  const { shopIds } = body as { shopIds: string[] };

  if (!shopIds || shopIds.length === 0) {
    return NextResponse.json({ error: "shopIdsが必要です" }, { status: 400 });
  }

  // 認可: shopIdからshop_nameを取得して検証
  const supabase = getSupabase();
  const { data: shopData } = await supabase.from("shops").select("id, name").in("id", shopIds);
  for (const s of (shopData || [])) {
    const hasAccess = await verifyShopAccess(auth.sub, s.name);
    if (!hasAccess) return NextResponse.json({ error: `${s.name}へのアクセス権がありません` }, { status: 403 });
  }
  const { error } = await supabase
    .from("grid_ranking_presets")
    .delete()
    .in("shop_id", shopIds);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
