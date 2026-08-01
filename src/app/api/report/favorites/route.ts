/**
 * GET  /api/report/favorites            — 共有★の一覧
 * POST /api/report/favorites            — ★の付け外し（全ユーザーに反映される）
 *        body: { shopName: string, favorite: boolean }
 *        body: { shopNames: string[], favorite: true }  … localStorageからの初回移行用
 *
 * ★は「全社で1つ」の共有リスト。以前は localStorage にしか無く、
 * 他ユーザーに共有されず、端末やサブドメインが変わるだけで消えていた。
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabase, verifyAuth, getUserAllowedShops } from "@/lib/supabase";
import { withAudit, requireCtxShopAccess } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** 一度の移行で受け付ける上限（誤爆・巨大リクエスト対策） */
const MAX_MIGRATE = 1000;

export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid || !auth.sub) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("report_favorites")
    .select("shop_name, created_by, created_at");

  if (error) {
    // 握りつぶして空配列を返すと、テーブル未作成に気づけない
    console.error("[favorites] select failed:", error.message);
    return NextResponse.json(
      { error: "お気に入りの取得に失敗しました", _error: error.message },
      { status: 500 },
    );
  }

  // 閲覧権限のある店舗のみ返す（バイトは割当店舗のみ）
  const allowed = await getUserAllowedShops(auth.sub);
  const rows = data || [];
  if (allowed === "all") {
    return NextResponse.json({ favorites: rows.map((r) => r.shop_name) });
  }
  const norm = (s: string) => (s || "").normalize("NFKC").replace(/[\s　]+/g, "").toLowerCase();
  const allowedSet = new Set(allowed.map(norm));
  return NextResponse.json({
    favorites: rows.map((r) => r.shop_name).filter((n) => allowedSet.has(norm(n))),
  });
}

/**
 * ★の付け外し。共有状態を変えるため社員以上（MEMO と同じ権限）に限定する。
 * バイトは閲覧のみ（★は見えるが変更できない）。
 */
export const POST = withAudit("お気に入り変更", "MEMO", async (request, ctx) => {
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "不正なリクエストです" }, { status: 400 });

  const supabase = getSupabase();

  // ── localStorage からの初回移行（複数件をまとめて追加）──
  if (Array.isArray(body.shopNames)) {
    const names: string[] = body.shopNames
      .filter((n: unknown): n is string => typeof n === "string" && n.trim().length > 0)
      .map((n: string) => n.trim());
    if (names.length === 0) return NextResponse.json({ success: true, added: 0 });
    if (names.length > MAX_MIGRATE) {
      return NextResponse.json(
        { error: `一度に登録できるのは${MAX_MIGRATE}件までです` },
        { status: 400 },
      );
    }
    // アクセス権のある店舗だけ通す（他店舗を勝手に共有★へ入れさせない）
    const allowed = await getUserAllowedShops(ctx.sub);
    let target = names;
    if (allowed !== "all") {
      const norm = (s: string) => (s || "").normalize("NFKC").replace(/[\s　]+/g, "").toLowerCase();
      const allowedSet = new Set(allowed.map(norm));
      target = names.filter((n) => allowedSet.has(norm(n)));
    }
    if (target.length === 0) return NextResponse.json({ success: true, added: 0 });

    const { error } = await supabase
      .from("report_favorites")
      .upsert(
        target.map((shop_name) => ({ shop_name, created_by: ctx.userName })),
        { onConflict: "shop_name", ignoreDuplicates: true },
      );
    if (error) {
      console.error("[favorites] migrate failed:", error.message);
      return NextResponse.json({ error: "移行に失敗しました", _error: error.message }, { status: 500 });
    }
    ctx.detail = `localStorageから${target.length}件を共有お気に入りへ移行`;
    return NextResponse.json({ success: true, added: target.length });
  }

  // ── 単体の付け外し ──
  const shopName = typeof body.shopName === "string" ? body.shopName.trim() : "";
  if (!shopName) return NextResponse.json({ error: "shopNameが必要です" }, { status: 400 });

  const shopErr = await requireCtxShopAccess(ctx, shopName);
  if (shopErr) return shopErr;

  const favorite = body.favorite !== false;
  if (favorite) {
    const { error } = await supabase
      .from("report_favorites")
      .upsert({ shop_name: shopName, created_by: ctx.userName }, { onConflict: "shop_name" });
    if (error) {
      console.error("[favorites] insert failed:", error.message);
      return NextResponse.json({ error: "保存に失敗しました", _error: error.message }, { status: 500 });
    }
  } else {
    const { error } = await supabase.from("report_favorites").delete().eq("shop_name", shopName);
    if (error) {
      console.error("[favorites] delete failed:", error.message);
      return NextResponse.json({ error: "削除に失敗しました", _error: error.message }, { status: 500 });
    }
  }

  ctx.detail = `${shopName} の★を${favorite ? "追加" : "解除"}`;
  return NextResponse.json({ success: true, favorite });
});
