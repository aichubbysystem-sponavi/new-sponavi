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
  const { shopId, keywords, source, mainKeyword } = body as {
    shopId: string;
    keywords?: string[];
    source?: string; // "sheet" | "manual"
    mainKeyword?: string | null;
  };

  if (!shopId) {
    return NextResponse.json({ error: "shopIdが必要です" }, { status: 400 });
  }

  // メインキーワードだけの更新（キーワード一覧は触らない）
  if (keywords === undefined && mainKeyword !== undefined) {
    const shopRes0 = await requireCtxShopAccessById(ctx, shopId);
    if (shopRes0.error) return shopRes0.error;

    const sb0 = getSupabase();
    const { data: row } = await sb0
      .from("shop_keywords")
      .select("keywords")
      .eq("shop_id", shopId)
      .maybeSingle();
    const list: string[] = row?.keywords || [];
    // 一覧に無いキーワードをメインにすると、競合比較が存在しない語で検索してしまう
    if (mainKeyword && !list.includes(mainKeyword)) {
      return NextResponse.json(
        { error: "指定されたキーワードがこの店舗の一覧にありません" },
        { status: 400 },
      );
    }
    const { error: mkErr } = await sb0
      .from("shop_keywords")
      .update({ main_keyword: mainKeyword || null, updated_at: new Date().toISOString() })
      .eq("shop_id", shopId);
    if (mkErr) {
      console.error("[shop-keywords] main_keyword update failed:", mkErr.message);
      return NextResponse.json({ error: "保存に失敗しました", _error: mkErr.message }, { status: 500 });
    }
    ctx.detail = `${shopRes0.shopName}: メインKWを「${mainKeyword || "未指定"}」に設定`;
    return NextResponse.json({ success: true, mainKeyword: mainKeyword || null });
  }

  if (!keywords) {
    return NextResponse.json({ error: "keywordsが必要です" }, { status: 400 });
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
