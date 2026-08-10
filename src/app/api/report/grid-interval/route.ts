/**
 * 多地点順位チェックの店舗ごとの計測設定（斜め4地点の半径・回転角）
 * GET  /api/report/grid-interval?shopName=xxx → { intervalM, angleDeg }
 * PUT  /api/report/grid-interval { shopName, intervalM?, angleDeg? }（どちらか必須）
 * 保存先: shops.grid_interval_m（NULL=既定500m）/ shops.grid_angle_deg（NULL=0度=斜め）
 * ※キーは店舗名。フロントのselectedShopIdはGo API IDでSupabaseのshops.idと
 *   一致しないことがあるため、座標取得と同様に名前で引く（NFC正規化）
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabase, verifyAuth, verifyShopAccess } from "@/lib/supabase";
import { withAudit, requireCtxShopAccess } from "@/lib/audit";

export const dynamic = "force-dynamic";

// 許可値。UIのボタンと一致させる（route.tsはハンドラ以外exportできないため非export）
// 2026-08-10 ユーザー要望で近距離を細分化（100/300/700m追加、1.5km以上は廃止。
// 廃止時点の設定は全店500m/未設定のため影響店舗ゼロ）。UI側 grid-ranking/page.tsx の INTERVALS と揃えること
const ALLOWED_INTERVALS = [100, 300, 500, 700, 1000];
const ALLOWED_ANGLES = [0, 15, 30, 45, 60, 75]; // 4点は90度間隔のため90度で一周
/** 計測地点の既定距離(m)。店舗ごとの設定(shops.grid_interval_m)が無い場合に使う */
const DEFAULT_INTERVAL = 500;

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
    .select("grid_interval_m, grid_angle_deg")
    .eq("name", shopName)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[grid-interval] GET error:", error.message);
    return NextResponse.json({ intervalM: DEFAULT_INTERVAL, angleDeg: 0, _error: error.message });
  }

  return NextResponse.json({
    intervalM: shop?.grid_interval_m || DEFAULT_INTERVAL,
    angleDeg: shop?.grid_angle_deg || 0,
  });
}

export const PUT = withAudit("計測距離設定", "DATA_OP", async (request, ctx) => {
  const body = await request.json().catch(() => ({}));
  const shopName: string = typeof body.shopName === "string" ? body.shopName.normalize("NFC") : "";
  const hasInterval = body.intervalM !== undefined && body.intervalM !== null;
  const hasAngle = body.angleDeg !== undefined && body.angleDeg !== null;
  const intervalM = Number(body.intervalM);
  const angleDeg = Number(body.angleDeg);

  if (!shopName || (!hasInterval && !hasAngle)) {
    return NextResponse.json({ error: "shopName と intervalM または angleDeg が必要です" }, { status: 400 });
  }
  if (hasInterval && !ALLOWED_INTERVALS.includes(intervalM)) {
    return NextResponse.json({ error: `intervalM は ${ALLOWED_INTERVALS.join("/")} のいずれか` }, { status: 400 });
  }
  if (hasAngle && !ALLOWED_ANGLES.includes(angleDeg)) {
    return NextResponse.json({ error: `angleDeg は ${ALLOWED_ANGLES.join("/")} のいずれか` }, { status: 400 });
  }

  const shopErr = await requireCtxShopAccess(ctx, shopName);
  if (shopErr) return shopErr;

  const update: Record<string, number> = {};
  if (hasInterval) update.grid_interval_m = intervalM;
  if (hasAngle) update.grid_angle_deg = angleDeg;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("shops")
    .update(update)
    .eq("name", shopName)
    .select("id");

  if (error) {
    console.error("[grid-interval] PUT error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "店舗が見つかりません" }, { status: 404 });
  }

  const parts: string[] = [];
  if (hasInterval) parts.push(`距離${intervalM >= 1000 ? `${intervalM / 1000}km` : `${intervalM}m`}`);
  if (hasAngle) parts.push(`向き${angleDeg}度`);
  ctx.detail = `${shopName}: 計測設定を${parts.join("・")}に変更`;
  return NextResponse.json({ success: true });
});
