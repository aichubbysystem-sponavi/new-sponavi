import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { withAudit, requireCtxShopAccess } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * POST /api/report/photo-views
 * body: { shopId: "<店舗名>", items: [{ source: "post" | "media", key: string, viewCount: number | null }] }
 *
 * 写真ごとの閲覧数を手入力で保存する。
 * Googleは写真ごとの閲覧数をAPIでもPerformance APIでも返さない（2026-08-15に再実測）ため、
 * この列だけが情報源になる。未入力は null＝未計測として扱い、0とは区別する。
 *
 * 保存先:
 *   投稿に添付した写真 → gbp_posts.view_count（キーは post_name）
 *   写真タブの写真     → media.view_count（キーは media_name）
 * どちらも shop_id 条件を必ず付けて更新する（他店舗の行を書き換えられないように）。
 */
const MAX_ITEMS = 200;

type Item = { source: "post" | "media"; key: string; viewCount: number | null };

export const POST = withAudit("写真の閲覧数入力", "MEMO", async (request, ctx) => {
  const body = await request.json().catch(() => ({} as any));
  const shopName = typeof body?.shopId === "string" ? decodeURIComponent(body.shopId).normalize("NFC") : "";
  const rawItems: unknown = body?.items;

  if (!shopName) return NextResponse.json({ error: "shopIdが必要です" }, { status: 400 });
  if (!Array.isArray(rawItems)) return NextResponse.json({ error: "itemsが必要です" }, { status: 400 });

  const shopErr = await requireCtxShopAccess(ctx, shopName);
  if (shopErr) return shopErr;

  const items: Item[] = [];
  for (const raw of rawItems.slice(0, MAX_ITEMS)) {
    const r = raw as any;
    if (!r || typeof r.key !== "string" || (r.source !== "post" && r.source !== "media")) continue;
    let viewCount: number | null = null;
    if (r.viewCount !== null && r.viewCount !== undefined && r.viewCount !== "") {
      const n = Math.floor(Number(r.viewCount));
      // 負数・非数は「未計測」に倒す。閲覧数として意味のない値をレポートに出さない
      if (!Number.isFinite(n) || n < 0) continue;
      viewCount = n;
    }
    items.push({ source: r.source, key: r.key, viewCount });
  }
  if (items.length === 0) return NextResponse.json({ error: "保存できる項目がありません" }, { status: 400 });

  const supabase = getSupabase();
  const { data: shops } = await supabase
    .from("shops").select("id, name").eq("name", shopName).limit(5);
  const shop = (shops || [])[0];
  if (!shop) return NextResponse.json({ error: "店舗が見つかりません" }, { status: 404 });

  let saved = 0;
  const failed: { key: string; error: string }[] = [];

  for (const item of items) {
    const table = item.source === "post" ? "gbp_posts" : "media";
    const keyCol = item.source === "post" ? "post_name" : "media_name";
    const { error, count } = await supabase
      .from(table)
      .update({ view_count: item.viewCount }, { count: "exact" })
      .eq(keyCol, item.key)
      .eq("shop_id", shop.id);
    if (error) failed.push({ key: item.key, error: error.message });
    else if (!count) failed.push({ key: item.key, error: "対象の写真が見つかりません" });
    else saved += count;
  }

  ctx.targetShop = shopName;
  ctx.detail = `${shopName}: 写真の閲覧数を${saved}件保存${failed.length ? `（${failed.length}件失敗）` : ""}`;
  if (failed.length > 0) console.error("[photo-views] 保存失敗:", failed.slice(0, 5));

  return NextResponse.json({ success: true, saved, failed });
});
