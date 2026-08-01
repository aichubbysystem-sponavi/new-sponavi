/**
 * 口コミの競合比較（レポートの「口コミ競合比較」ページ）の取得。
 *
 * GET  ?shopName=&month=  — 保存済みを返す（課金なし）
 * POST { shopName, month } — Places APIで取得して保存（¥4.8・PAID_OP）
 *
 * 【なぜ明示操作にしたか】
 * 以前はレポートを開いた時点で自動取得していたため、閲覧するだけで
 * 1店舗¥4.8が発生していた。611店舗を開けば約¥2,900が意図せず走る。
 * 課金操作はボタンを押したときだけに限定する。
 */
import { NextRequest, NextResponse } from "next/server";
import { requireShopAccess } from "@/lib/supabase";
import { withAudit, requireCtxShopAccess } from "@/lib/audit";
import {
  getStoredCompetitors,
  fetchAndStoreCompetitors,
  isCompetitorFetchAllowed,
  COMPETITOR_FETCH_MONTHS_BACK,
} from "@/lib/competitor-fetch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const shopName = request.nextUrl.searchParams.get("shopName") || "";
  const month = request.nextUrl.searchParams.get("month") || "";
  if (!shopName || !month) {
    return NextResponse.json({ error: "shopNameとmonthが必要です" }, { status: 400 });
  }
  const access = await requireShopAccess(request, shopName);
  if (access.error) return access.error;

  const data = await getStoredCompetitors(shopName, month);
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  return NextResponse.json({
    data,
    stored: !!data,
    fetchable: isCompetitorFetchAllowed(month, jst),
    monthsBack: COMPETITOR_FETCH_MONTHS_BACK,
  });
}

export const POST = withAudit("口コミ競合比較の取得", "PAID_OP", async (request, ctx) => {
  const body = await request.json().catch(() => ({}));
  const shopName = typeof body?.shopName === "string" ? body.shopName : "";
  const month = typeof body?.month === "string" ? body.month : "";
  if (!shopName || !month) {
    return NextResponse.json({ error: "shopNameとmonthが必要です" }, { status: 400 });
  }

  const shopErr = await requireCtxShopAccess(ctx, shopName);
  if (shopErr) return shopErr;

  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  if (!isCompetitorFetchAllowed(month, jst)) {
    return NextResponse.json(
      { error: `${month} は取得対象外です（${COMPETITOR_FETCH_MONTHS_BACK}か月前まで取得できます）` },
      { status: 400 },
    );
  }

  // 保存済みなら再取得しない（同じ月に何度押しても課金は1回）
  const already = await getStoredCompetitors(shopName, month);
  if (already) {
    ctx.detail = `${shopName} ${month}: 取得済みのため課金なし`;
    return NextResponse.json({ data: already, charged: false });
  }

  const data = await fetchAndStoreCompetitors(shopName, month);
  if (!data) {
    // 座標なし・KWなし・API失敗のいずれか。理由が分からないと対処できない
    return NextResponse.json(
      { error: "取得できませんでした（座標・キーワードの設定、またはPlaces APIの応答をご確認ください）" },
      { status: 502 },
    );
  }

  ctx.detail = `${shopName} ${month}: 競合${data.competitors.length}件を取得（KW「${data.keyword}」）`;
  return NextResponse.json({ data, charged: true });
});
