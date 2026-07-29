/**
 * 多地点順位チェックの店舗ごとの計測距離設定（斜め4地点の半径）
 * GET  /api/report/grid-interval?shopName=xxx → { intervalM }
 * PUT  /api/report/grid-interval { shopName, intervalM }
 * 保存先: shops.grid_interval_m（NULL=既定1000m）
 * ※キーは店舗名。フロントのselectedShopIdはGo API IDでSupabaseのshops.idと
 *   一致しないことがあるため、座標取得と同様に名前で引く（NFC正規化）
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabase, verifyAuth, verifyShopAccess } from "@/lib/supabase";
import { withAudit, requireCtxShopAccess } from "@/lib/audit";

export const dynamic = "force-dynamic";

// 許可する距離（m）。UIのボタンと一致させる（route.tsはハンドラ以外exportできないため非export）
const ALLOWED_INTERVALS = [500, 1000, 2000, 3000, 4000, 5000];
const DEFAULT_INTERVAL = 1000;

export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid || !auth.sub) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const shopNameRaw = request.nextUrl.searchParams.get("shopName");
  if (!shopNameRaw) return NextResponse.json({ error: "shopNameが必要です" }, { status: 400 });
  const shopName = shopNameRaw.normalize("NFC");

  if (!(await verifyShopAccess(auth.sub, shopName))) {
    return NextResponse.json({ error: "この店舗へのアクセス権がありません" }, { status: 403 });
  }

  const supabase = getSupabase();
  const { data: shop, error } = await supabase
    .from("shops")
    .select("grid_interval_m")
    .eq("name", shopName)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[grid-interval] GET error:", error.message);
    return NextResponse.json({ intervalM: DEFAULT_INTERVAL, _error: error.message });
  }

  return NextResponse.json({ intervalM: shop?.grid_interval_m || DEFAULT_INTERVAL });
}

export const PUT = withAudit("計測距離設定", "DATA_OP", async (request, ctx) => {
  const body = await request.json().catch(() => ({}));
  const shopName: string = typeof body.shopName === "string" ? body.shopName.normalize("NFC") : "";
  const intervalM = Number(body.intervalM);

  if (!shopName || !ALLOWED_INTERVALS.includes(intervalM)) {
    return NextResponse.json({ error: `shopName と intervalM（${ALLOWED_INTERVALS.join("/")}）が必要です` }, { status: 400 });
  }

  const shopErr = await requireCtxShopAccess(ctx, shopName);
  if (shopErr) return shopErr;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("shops")
    .update({ grid_interval_m: intervalM })
    .eq("name", shopName)
    .select("id");

  if (error) {
    console.error("[grid-interval] PUT error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "店舗が見つかりません" }, { status: 404 });
  }

  ctx.detail = `${shopName}: 計測距離を${intervalM >= 1000 ? `${intervalM / 1000}km` : `${intervalM}m`}に設定`;
  return NextResponse.json({ success: true });
});
