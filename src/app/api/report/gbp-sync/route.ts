/**
 * GBP同期（手動実行）
 *
 * GET  /api/report/gbp-sync        … 差分プレビュー（書き込みなし）
 * POST /api/report/gbp-sync        … 実行（新店舗の追加 + gbp_shop_name の同期）
 *   body: {
 *     importNew?: boolean          … false なら店名同期のみ
 *     confirmBulkImport?: boolean  … 一度に BULK_INSERT_THRESHOLD 件を超える
 *                                     新規登録を承認する。既定は false で、
 *                                     超えた場合は登録せず pendingInserts に一覧を返す
 *   }
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
    const result = await syncShopsFromGbp({ dryRun: true, autoLink: true, allowInsert: true });
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
  let confirmBulkImport = false;
  try {
    const body = await request.json();
    if (body && typeof body.importNew === "boolean") importNew = body.importNew;
    // 一括登録ガードに引っかかった一覧を見たうえで、もう一度押されたときだけ true
    if (body && typeof body.confirmBulkImport === "boolean") confirmBulkImport = body.confirmBulkImport;
  } catch {
    // ボディ無しの呼び出しも許容（デフォルト＝新規取り込みあり・一括登録は確認待ち）
  }

  try {
    // 人が実行した場合のみ、GBP未連携の既存店舗への再紐付けと新規登録を許可する
    const result = await syncShopsFromGbp({ importNew, autoLink: true, allowInsert: true, confirmBulkImport });
    ctx.detail =
      `追加${result.added.length}件 / 登録保留${result.pendingInserts.length}件 / ` +
      `紐付け修復${result.linked.length}件 / 更新${result.updated}件 / ` +
      `店名変更${result.renamed.length}件 / アカウント${result.accounts}件 / エラー${result.errors.length}件` +
      (confirmBulkImport ? " ※一括登録を承認して実行" : "");
    return NextResponse.json(result);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    ctx.detail = `失敗: ${message}`;
    return NextResponse.json({ error: `GBP同期に失敗しました: ${message}` }, { status: 500 });
  }
});
