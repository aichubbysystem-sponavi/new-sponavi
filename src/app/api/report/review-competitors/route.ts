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
  fetchAndStoreCompetitorsDetailed,
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

  const outcome = await fetchAndStoreCompetitorsDetailed(shopName, month);

  // 失敗時も「課金されたかどうか」を必ず返す。
  // 以前は課金後にnullを返す経路があり、画面は「¥0・失敗」と報告していた
  const REASON_TEXT: Record<string, string> = {
    no_api_key: "GCP_API_KEYが未設定です",
    no_coords: "店舗の座標が未設定です（座標取得を先に実行してください）",
    no_keyword: "キーワードが未設定です（シートから反映するか、GBPカテゴリをご確認ください）",
    api_error: "Places APIがエラーを返しました",
    no_results: "検索結果が0件でした（キーワードをご確認ください）",
    save_failed: "取得できましたが保存に失敗しました。再実行すると再課金になるため、先に原因をご確認ください",
    exception: "取得中に予期しないエラーが発生しました",
  };

  if (!outcome.data || outcome.reason === "save_failed") {
    const reason = outcome.reason || "exception";
    ctx.detail = `${shopName} ${month}: 失敗(${reason})${outcome.charged ? " ※課金あり" : " ※課金なし"}`;
    return NextResponse.json(
      {
        error: REASON_TEXT[reason] || "取得できませんでした",
        reason,
        charged: outcome.charged, // 課金の事実を隠さない
      },
      { status: 502 },
    );
  }

  const data = outcome.data;
  ctx.detail = `${shopName} ${month}: 競合${data.competitors.length}件を取得（KW「${data.keyword}」）${outcome.charged ? "" : "・課金なし"}`;
  return NextResponse.json({ data, charged: outcome.charged });
});
