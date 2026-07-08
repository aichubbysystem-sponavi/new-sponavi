import { NextRequest, NextResponse } from "next/server";
import { getSupabase, requireShopAccessById } from "@/lib/supabase";
import { withAudit, requireCtxShopAccessById } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * 差し込み文字列（fixed_messages）の取得・保存。
 * 以前は basic-info/fixed-message ページから anonキーで直接 delete/insert しており、
 * 所有チェックが無く他店舗の定型文を改ざん・削除できた（C-1系の穴）。
 * サーバー側で requireShopAccessById による店舗アクセス認可を通す。
 */

/** GET /api/report/fixed-messages?shopId=xxx — 指定店舗の差し込み文字列一覧 */
export async function GET(request: NextRequest) {
  const shopId = request.nextUrl.searchParams.get("shopId");
  if (!shopId) return NextResponse.json({ error: "shopIdが必要です" }, { status: 400 });

  const access = await requireShopAccessById(request, shopId);
  if (access.error) return access.error;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("fixed_messages")
    .select("id, title, message, created_at")
    .eq("shop_id", shopId)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ messages: data || [] });
}

/**
 * PUT /api/report/fixed-messages — 指定店舗の差し込み文字列を全置換（upsert的動作）。
 * body: { shopId, fields: [{ id?, title, message }] }
 */
export const PUT = withAudit("固定メッセージ保存", "DATA_OP", async (request, ctx) => {
  const body = await request.json();
  const { shopId, fields } = body as { shopId?: string; fields?: { id?: string; title?: string; message?: string }[] };
  if (!shopId) return NextResponse.json({ error: "shopIdが必要です" }, { status: 400 });
  if (!Array.isArray(fields)) return NextResponse.json({ error: "fieldsが不正です" }, { status: 400 });

  const shopRes = await requireCtxShopAccessById(ctx, shopId);
  if (shopRes.error) return shopRes.error;

  const supabase = getSupabase();

  // タイトルが空の行は破棄。過剰件数・過大サイズはサーバー側で制限する。
  const rows = fields
    .filter((f) => (f.title || "").trim())
    .slice(0, 50)
    .map((f) => ({
      id: f.id || crypto.randomUUID(),
      shop_id: shopId,
      title: (f.title || "").trim().slice(0, 200),
      message: (f.message || "").slice(0, 5000),
    }));

  // 全削除→再挿入。挿入失敗時に空になるのを避けるため、挿入成功後にだけ削除する順序にはできない
  // （同一shop_idの一意制約が無いため）。ここは既存挙動を踏襲しつつサーバー認可下で実行する。
  const { error: delErr } = await supabase.from("fixed_messages").delete().eq("shop_id", shopId);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  if (rows.length > 0) {
    const { error: insErr } = await supabase.from("fixed_messages").insert(rows);
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  ctx.detail = `${shopRes.shopName}: 差し込み文字列${rows.length}件を全置換保存`;
  return NextResponse.json({ success: true, count: rows.length });
});
