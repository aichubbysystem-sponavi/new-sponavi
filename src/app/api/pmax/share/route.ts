import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { withAudit } from "@/lib/audit";
import { isShareActive, shareExpiryISO } from "@/lib/share-token";

export const dynamic = "force-dynamic";

/** POST: 共有トークンを発行（有効期限付き。有効な既存トークンがあれば再利用し期限を延長） */
export const POST = withAudit("P-MAX共有リンク発行", "DATA_OP", async (request, ctx) => {
  try {
    const { shopName, year, month, summaryText } = await request.json();
    if (!shopName || !year || !month) {
      return NextResponse.json({ error: "shopName, year, month は必須です" }, { status: 400 });
    }

    ctx.targetShop = shopName;
    const sb = getSupabase();

    // 同じ店舗+月の既存トークンのうち「有効なもの」があれば再利用（期限を延長し、失効解除）
    const { data: existing } = await sb
      .from("pmax_share_tokens")
      .select("token, expires_at, revoked_at")
      .eq("shop_name", shopName)
      .eq("year", year)
      .eq("month", month)
      .order("created_at", { ascending: false });

    const active = (existing || []).find((row) => isShareActive(row));
    if (active) {
      await sb.from("pmax_share_tokens").update({
        expires_at: shareExpiryISO(),
        ...(summaryText ? { summary_text: summaryText } : {}),
      }).eq("token", active.token);
      ctx.detail = `${shopName} ${year}年${month}月: 既存トークンを再利用（期限延長）`;
      return NextResponse.json({ token: active.token });
    }

    // 有効なものが無ければ新規発行（失効/期限切れの旧トークンは残す＝旧URLは死んだまま）
    const { data, error } = await sb
      .from("pmax_share_tokens")
      .insert({
        shop_name: shopName, year, month, created_by: ctx.sub,
        summary_text: summaryText || "", expires_at: shareExpiryISO(),
      })
      .select("token")
      .single();

    if (error) {
      console.error("[pmax/share] Insert error:", error);
      return NextResponse.json({ error: "トークン発行に失敗しました" }, { status: 500 });
    }

    ctx.detail = `${shopName} ${year}年${month}月: 共有トークンを新規発行`;
    return NextResponse.json({ token: data.token });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
});

/**
 * DELETE: 共有を停止（失効）。body: { shopName, year, month }
 * 該当店舗・月の全トークンに revoked_at をセットし、以降そのURLを無効化する。
 */
export const DELETE = withAudit("P-MAX共有リンク削除", "DATA_OP", async (request, ctx) => {
  try {
    const { shopName, year, month } = await request.json();
    if (!shopName || !year || !month) {
      return NextResponse.json({ error: "shopName, year, month は必須です" }, { status: 400 });
    }

    ctx.targetShop = shopName;
    const sb = getSupabase();
    const { error } = await sb
      .from("pmax_share_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("shop_name", shopName).eq("year", year).eq("month", month)
      .is("revoked_at", null);

    if (error) return NextResponse.json({ error: "失効に失敗しました" }, { status: 500 });
    ctx.detail = `${shopName} ${year}年${month}月: 共有トークンを失効`;
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
});
