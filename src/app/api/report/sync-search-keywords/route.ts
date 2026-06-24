/**
 * POST /api/report/sync-search-keywords
 * 指定店舗の検索語句をGBP Performance APIから取得してキャッシュに保存
 * v2: shopIdベース + 共有lib使用 + 認証必須
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabase, verifyAuth, requireShopAccessById } from "@/lib/supabase";
import { syncShopSearchKeywords } from "@/lib/gbp-search-keywords";

export const dynamic = "force-dynamic";
export const maxDuration = 300;



async function handleSync(shopId: string) {
  if (!shopId) {
    return NextResponse.json({ error: "shopId required" }, { status: 400 });
  }

  const supabase = getSupabase();

  // 店舗検索（IDベース — maybeSingle安全）
  const { data: shop } = await supabase
    .from("shops")
    .select("id, name, gbp_location_name")
    .eq("id", shopId)
    .maybeSingle();

  if (!shop) {
    return NextResponse.json({ error: `Shop not found: ${shopId}` }, { status: 404 });
  }
  if (!shop.gbp_location_name) {
    return NextResponse.json({ error: `No gbp_location_name: ${shop.name}` }, { status: 404 });
  }

  // 共有lib の統一同期関数を使用
  const result = await syncShopSearchKeywords(shop.id, shop.name, shop.gbp_location_name, 12);

  if (!result.success) {
    // "データなし"は正常応答（200）として返す（500だとブラウザコンソールにエラー表示される）
    return NextResponse.json({ success: false, error: result.error, shopName: shop.name });
  }

  return NextResponse.json({
    success: true,
    shopId: shop.id,
    shopName: shop.name,
    latestMonth: result.latestMonth,
    totalMonths: result.totalMonths,
    topKeywords: result.topKeywords,
  });
}

// POST: 認証付き（検索語句管理ページから呼び出し）
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const shopId = body.shopId || "";

  if (!shopId) return NextResponse.json({ error: "shopId required" }, { status: 400 });

  const access = await requireShopAccessById(request, shopId);
  if (access.error) return access.error;

  return handleSync(shopId);
}

// GET: 後方互換（shopId or name）— 認証付き
export async function GET(request: NextRequest) {
  const shopId = request.nextUrl.searchParams.get("shopId") || "";
  if (shopId) {
    const access = await requireShopAccessById(request, shopId);
    if (access.error) return access.error;
    return handleSync(shopId);
  }

  // 後方互換: name パラメータ → shopId に変換
  const shopName = request.nextUrl.searchParams.get("name") || "";
  if (!shopName) {
    return NextResponse.json({ error: "shopId or name required" }, { status: 400 });
  }
  const supabase = getSupabase();
  const { data: shop } = await supabase
    .from("shops")
    .select("id")
    .eq("name", shopName)
    .limit(1)
    .maybeSingle();
  if (!shop) {
    return NextResponse.json({ error: `Shop not found: ${shopName}` }, { status: 404 });
  }
  return handleSync(shop.id);
}
