import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** POST: 共有トークンを発行 */
export async function POST(request: NextRequest) {
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { shopName, year, month, summaryText } = await request.json();
    if (!shopName || !year || !month) {
      return NextResponse.json({ error: "shopName, year, month は必須です" }, { status: 400 });
    }

    const sb = getSupabase();

    // 同じ店舗+月の既存トークンがあれば、summaryTextを更新して返す
    const { data: existing } = await sb
      .from("pmax_share_tokens")
      .select("token")
      .eq("shop_name", shopName)
      .eq("year", year)
      .eq("month", month)
      .limit(1);

    if (existing && existing.length > 0) {
      if (summaryText) {
        await sb.from("pmax_share_tokens").update({ summary_text: summaryText }).eq("token", existing[0].token);
      }
      return NextResponse.json({ token: existing[0].token });
    }

    // 新規発行
    const { data, error } = await sb
      .from("pmax_share_tokens")
      .insert({ shop_name: shopName, year, month, created_by: auth.sub, summary_text: summaryText || "" })
      .select("token")
      .single();

    if (error) {
      console.error("[pmax/share] Insert error:", error);
      return NextResponse.json({ error: "トークン発行に失敗しました" }, { status: 500 });
    }

    return NextResponse.json({ token: data.token });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
