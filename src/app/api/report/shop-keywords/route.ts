import { NextRequest, NextResponse } from "next/server";
import { getSupabase, requireShopAccessById } from "@/lib/supabase";
import { withAudit, requireCtxShopAccessById } from "@/lib/audit";

export const dynamic = "force-dynamic";



/**
 * GET /api/report/shop-keywords?shopId=xxx
 * 店舗に紐づく保存済みキーワードを取得
 */
export async function GET(request: NextRequest) {
  const shopId = request.nextUrl.searchParams.get("shopId");
  if (!shopId) {
    return NextResponse.json({ error: "shopIdが必要です" }, { status: 400 });
  }

  const access = await requireShopAccessById(request, shopId);
  if (access.error) return access.error;

  const supabase = getSupabase();
  const { data } = await supabase
    .from("shop_keywords")
    .select("*")
    .eq("shop_id", shopId)
    .single();

  return NextResponse.json(data || { keywords: [], source: null });
}

/**
 * PUT /api/report/shop-keywords
 * キーワードを保存（upsert）
 */
export const PUT = withAudit("店舗キーワード保存", "DATA_OP", async (request, ctx) => {
  const body = await request.json();
  const { shopId, keywords, source } = body as {
    shopId: string;
    keywords: string[];
    source: string; // "sheet" | "manual"
  };

  if (!shopId || !keywords) {
    return NextResponse.json({ error: "shopIdとkeywordsが必要です" }, { status: 400 });
  }

  const shopRes = await requireCtxShopAccessById(ctx, shopId);
  if (shopRes.error) return shopRes.error;

  const supabase = getSupabase();

  // upsert: shop_idが既にあれば更新、なければ挿入
  const { error } = await supabase.from("shop_keywords").upsert(
    {
      shop_id: shopId,
      keywords,
      source: source || "manual",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "shop_id" }
  );

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  ctx.detail = `${shopRes.shopName}: キーワード${keywords.length}件を保存（source: ${source || "manual"}）`;
  return NextResponse.json({ success: true });
});
