import { NextRequest, NextResponse } from "next/server";
import { getSupabase, verifyAuth } from "@/lib/supabase";

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
export async function PUT(request: NextRequest) {
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = await request.json();
  const { shopId, keywords, source } = body as {
    shopId: string;
    keywords: string[];
    source: string; // "sheet" | "manual"
  };

  if (!shopId || !keywords) {
    return NextResponse.json({ error: "shopIdとkeywordsが必要です" }, { status: 400 });
  }

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

  return NextResponse.json({ success: true });
}
