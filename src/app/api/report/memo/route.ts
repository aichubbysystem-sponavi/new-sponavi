import { NextRequest, NextResponse } from "next/server";
import { getSupabase, verifyAuth } from "@/lib/supabase";
import { validateBody, memoSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";



/**
 * GET /api/report/memo?shopName=xxx&month=2026/3
 */
export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

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
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const { data: body, error: valErr } = await validateBody(request, memoSchema);
  if (valErr) return valErr;
  const { shopName, month, memo } = body;

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
