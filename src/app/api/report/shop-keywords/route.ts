import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
}

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
  const { verifyAuth } = await import("@/lib/auth-verify");
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
