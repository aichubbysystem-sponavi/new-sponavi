import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_KEY);
}

/**
 * GET /api/internal/fixed-messages/[shopId]
 *
 * 同名店舗のfixed_messagesを検索して返す
 * 新システムの店舗IDにfixed_messagesがない場合、
 * 旧システムの同名店舗からデータを取得する
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ shopId: string }> }
) {
  const { shopId } = await params;
  if (!shopId) {
    return NextResponse.json({ error: "shopId is required" }, { status: 400 });
  }

  const supabase = getSupabase();

  try {
    // 1. まず指定shopIdのfixed_messagesを直接検索
    const { data: directMessages } = await supabase
      .from("fixed_messages")
      .select("id, title, message")
      .eq("shop_id", shopId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true });

    if (directMessages && directMessages.length > 0) {
      return NextResponse.json(directMessages);
    }

    // 2. 指定shopIdの店舗名を取得
    const { data: currentShop } = await supabase
      .from("shops")
      .select("name")
      .eq("id", shopId)
      .maybeSingle();

    if (!currentShop?.name) {
      return NextResponse.json([]);
    }

    // 3. 同名の全店舗IDを取得
    const { data: sameNameShops } = await supabase
      .from("shops")
      .select("id")
      .eq("name", currentShop.name);

    if (!sameNameShops || sameNameShops.length === 0) {
      return NextResponse.json([]);
    }

    const allShopIds = sameNameShops.map(s => s.id);

    // 4. 同名店舗のfixed_messagesを検索
    const { data: messages } = await supabase
      .from("fixed_messages")
      .select("id, title, message")
      .in("shop_id", allShopIds)
      .is("deleted_at", null)
      .order("created_at", { ascending: true });

    return NextResponse.json(messages || []);
  } catch (e: any) {
    console.error("[internal/fixed-messages] error:", e?.message);
    return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500 });
  }
}
