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
 * GET /api/report/memo?shopName=xxx&month=2026/3
 */
export async function GET(request: NextRequest) {
  const shopName = request.nextUrl.searchParams.get("shopName");
  const month = request.nextUrl.searchParams.get("month");
  if (!shopName) return NextResponse.json({ error: "shopNameが必要です" }, { status: 400 });

  const supabase = getSupabase();

  // テーブルがなければ空を返す
  try {
    let query = supabase
      .from("report_memos")
      .select("shop_name, month, memo, updated_at")
      .eq("shop_name", shopName);

    if (month) query = query.eq("month", month);

    const { data, error } = await query.order("updated_at", { ascending: false }).limit(1).maybeSingle();

    if (error) {
      // テーブルが存在しない場合
      if (error.code === "42P01" || error.message?.includes("does not exist")) {
        return NextResponse.json({ memo: "" });
      }
      return NextResponse.json({ memo: "" });
    }

    return NextResponse.json({ memo: data?.memo || "" });
  } catch {
    return NextResponse.json({ memo: "" });
  }
}

/**
 * POST /api/report/memo
 * { shopName, month, memo }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { shopName, month, memo } = body as { shopName: string; month: string; memo: string };

  if (!shopName || !month) {
    return NextResponse.json({ error: "shopNameとmonthが必要です" }, { status: 400 });
  }

  const supabase = getSupabase();

  try {
    // upsert（shop_name + month でユニーク）
    const { error } = await supabase
      .from("report_memos")
      .upsert({
        shop_name: shopName,
        month,
        memo,
        updated_at: new Date().toISOString(),
      }, { onConflict: "shop_name,month" });

    if (error) {
      console.error("[memo] upsert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
