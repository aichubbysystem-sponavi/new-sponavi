/**
 * POST /api/report/shop-unlink
 * 店舗のGBPロケーション連携を解除する。
 * body: { shopId: string }
 *
 * 【なぜ専用ルートが必要か】
 * 単に gbp_location_name を空にするだけだと、GBP同期（lib/gbp-shop-sync.ts）が
 * 「未連携の店舗が同名のGBPロケーションと一致した」と判断して自動的に張り直してしまう。
 * 担当者が意図して外した連携が翌日復活するのを防ぐため、
 * 外したロケーションIDを previous_gbp_location_name に残して「意図的な解除」を記録する。
 */
import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { withAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const POST = withAudit("GBPロケーション解除", "DATA_OP", async (request, ctx) => {
  let shopId = "";
  try {
    const body = await request.json();
    shopId = typeof body?.shopId === "string" ? body.shopId : "";
  } catch {
    return NextResponse.json({ error: "リクエストの形式が不正です" }, { status: 400 });
  }
  if (!shopId) return NextResponse.json({ error: "shopId is required" }, { status: 400 });

  const sb = getSupabase();
  const { data: shop, error: readErr } = await sb
    .from("shops")
    .select("id, name, gbp_location_name")
    .eq("id", shopId)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!shop) return NextResponse.json({ error: "店舗が見つかりません" }, { status: 404 });

  ctx.targetShop = shop.name;

  if (!shop.gbp_location_name) {
    ctx.detail = `${shop.name}: 既に未連携`;
    return NextResponse.json({ success: true, alreadyUnlinked: true });
  }

  const { data: updated, error } = await sb
    .from("shops")
    .update({
      gbp_location_name: null,
      // 解除したロケーションを残す = 「意図的に外した」印。同期が自動で戻さなくなる
      previous_gbp_location_name: shop.gbp_location_name,
      updated_at: new Date().toISOString(),
    })
    .eq("id", shopId)
    .select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // 0行更新をサイレント成功にしない
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: "対象の店舗が見つかりませんでした（IDが一致しません）", shopId }, { status: 404 });
  }

  ctx.detail = `${shop.name}: ${shop.gbp_location_name} を解除`;
  return NextResponse.json({ success: true, unlinked: shop.gbp_location_name });
});
