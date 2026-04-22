import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_KEY);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ shopId: string }> }
) {
  const { shopId } = await params;
  const debug: string[] = [];
  debug.push(`shopId: ${shopId}`);
  debug.push(`supabase_url: ${SUPABASE_URL ? "set" : "MISSING"}`);
  debug.push(`supabase_key: ${SUPABASE_KEY ? SUPABASE_KEY.slice(0, 10) + "..." : "MISSING"}`);

  if (!shopId) {
    return NextResponse.json({ error: "shopId is required", debug }, { status: 400 });
  }

  const supabase = getSupabase();

  try {
    // 1. まず指定shopIdのfixed_messagesを直接検索
    const { data: directMessages, error: directError } = await supabase
      .from("fixed_messages")
      .select("id, title, message")
      .eq("shop_id", shopId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true });

    debug.push(`step1_direct: count=${directMessages?.length ?? "null"}, error=${directError?.message ?? "none"}`);

    if (directMessages && directMessages.length > 0) {
      return NextResponse.json(directMessages);
    }

    // 2. 指定shopIdの店舗名を取得
    const { data: currentShop, error: shopError } = await supabase
      .from("shops")
      .select("name")
      .eq("id", shopId)
      .maybeSingle();

    debug.push(`step2_shop: name=${currentShop?.name ?? "null"}, error=${shopError?.message ?? "none"}`);

    if (!currentShop?.name) {
      return NextResponse.json({ messages: [], debug });
    }

    // 3. 同名の全店舗IDを取得
    const { data: sameNameShops, error: nameError } = await supabase
      .from("shops")
      .select("id")
      .eq("name", currentShop.name);

    debug.push(`step3_sameName: count=${sameNameShops?.length ?? "null"}, ids=${JSON.stringify(sameNameShops?.map(s => s.id))}, error=${nameError?.message ?? "none"}`);

    if (!sameNameShops || sameNameShops.length === 0) {
      return NextResponse.json({ messages: [], debug });
    }

    const allShopIds = sameNameShops.map(s => s.id);

    // 4. 同名店舗のfixed_messagesを検索
    const { data: messages, error: msgError } = await supabase
      .from("fixed_messages")
      .select("id, title, message, shop_id")
      .in("shop_id", allShopIds)
      .is("deleted_at", null)
      .order("created_at", { ascending: true });

    debug.push(`step4_messages: count=${messages?.length ?? "null"}, error=${msgError?.message ?? "none"}`);

    if (messages && messages.length > 0) {
      return NextResponse.json(messages.map(m => ({ id: m.id, title: m.title, message: m.message })));
    }

    // 5. deleted_atフィルタなしでも試す
    const { data: allMessages, error: allError } = await supabase
      .from("fixed_messages")
      .select("id, title, message, shop_id, deleted_at")
      .in("shop_id", allShopIds);

    debug.push(`step5_noFilter: count=${allMessages?.length ?? "null"}, error=${allError?.message ?? "none"}`);

    if (allMessages && allMessages.length > 0) {
      const active = allMessages.filter(m => !m.deleted_at);
      debug.push(`step5_active: ${active.length}, deleted: ${allMessages.length - active.length}`);
      return NextResponse.json(active.map(m => ({ id: m.id, title: m.title, message: m.message })));
    }

    return NextResponse.json({ messages: [], debug });
  } catch (e: any) {
    debug.push(`exception: ${e?.message}`);
    return NextResponse.json({ error: e?.message, debug }, { status: 500 });
  }
}
