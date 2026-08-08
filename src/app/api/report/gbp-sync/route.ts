/**
 * GBP同期（手動実行）
 *
 * GET  /api/report/gbp-sync        … 差分プレビュー（書き込みなし）
 * POST /api/report/gbp-sync        … 実行（新店舗の追加 + gbp_shop_name の同期）
 *   body: { importNew?: boolean }  … false なら店名同期のみ
 *
 * shops.name は結合キーのため一切更新しない。詳細は lib/gbp-shop-sync.ts のコメント参照。
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase";
import { withAudit } from "@/lib/audit";
import { syncShopsFromGbp } from "@/lib/gbp-shop-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const { error } = await requireAuth(request);
  if (error) return error;

  try {
    const result = await syncShopsFromGbp({ dryRun: true, autoLink: true });
    return NextResponse.json(result);
  } catch (e: unknown) {
    return NextResponse.json(
      { error: `GBPスキャンに失敗しました: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }
}

export const POST = withAudit("GBP店舗同期", "DATA_OP", async (request, ctx) => {
  let importNew = true;
  try {
    const body = await request.json();
    if (body && typeof body.importNew === "boolean") importNew = body.importNew;
  } catch {
    // ボディ無しの呼び出しも許容（デフォルト＝新規取り込みあり）
  }

  try {
    // 人が実行した場合のみ、GBP未連携の既存店舗への再紐付けを許可する
    const result = await syncShopsFromGbp({ importNew, autoLink: true });
    ctx.detail =
      `追加${result.added.length}件 / 紐付け修復${result.linked.length}件 / ` +
      `更新${result.updated}件 / 店名変更${result.renamed.length}件 / ` +
      `アカウント${result.accounts}件 / エラー${result.errors.length}件`;
    return NextResponse.json(result);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    ctx.detail = `失敗: ${message}`;
    return NextResponse.json({ error: `GBP同期に失敗しました: ${message}` }, { status: 500 });
  }
});
