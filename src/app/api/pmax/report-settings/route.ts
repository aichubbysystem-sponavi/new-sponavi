import { NextRequest, NextResponse } from "next/server";
import { getSupabase, requireRole } from "@/lib/supabase";
import { withAudit } from "@/lib/audit";
import { parseReportSettings } from "@/lib/pmax-overrides";

export const dynamic = "force-dynamic";

/**
 * GET /api/pmax/report-settings?shopName=X
 * 店舗のレポート表示設定＋数値上書きを返す（管理画面用）
 */
export async function GET(request: NextRequest) {
  const r = await requireRole(request, ["president", "executive", "manager"]);
  if (r.error) return r.error;

  const shopName = request.nextUrl.searchParams.get("shopName");
  if (!shopName) return NextResponse.json({ error: "shopName は必須です" }, { status: 400 });

  const sb = getSupabase();
  const { data, error } = await sb
    .from("pmax_report_settings")
    .select("overrides, section_visibility")
    .eq("shop_name", shopName)
    .maybeSingle();

  if (error) {
    console.error("[pmax/report-settings] select error:", error.message);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
  return NextResponse.json(parseReportSettings(data));
}

/**
 * PUT /api/pmax/report-settings
 * body: { shopName, overrides?, sectionVisibility? }
 * 渡されたフィールドだけ上書き保存（省略したフィールドは既存値を維持）
 */
export const PUT = withAudit("P-MAXレポート表示設定保存", "DATA_OP", async (request, ctx) => {
  const body = await request.json().catch(() => null);
  const shopName = body?.shopName;
  if (!shopName || typeof shopName !== "string") {
    return NextResponse.json({ error: "shopName は必須です" }, { status: 400 });
  }
  ctx.targetShop = shopName;

  // 送られてきた値を数値/真偽だけに絞って保存（不正型の混入防止）
  const clean = parseReportSettings({
    overrides: body?.overrides,
    section_visibility: body?.sectionVisibility,
  });

  const row: Record<string, unknown> = { shop_name: shopName, updated_at: new Date().toISOString() };
  if (body?.overrides !== undefined) row.overrides = clean.overrides;
  if (body?.sectionVisibility !== undefined) row.section_visibility = clean.sectionVisibility;

  const sb = getSupabase();

  // upsertだとdefault '{}'で未送信フィールドまで初期化されるため、既存行はUPDATEで部分更新
  const { data: existing } = await sb
    .from("pmax_report_settings")
    .select("shop_name")
    .eq("shop_name", shopName)
    .maybeSingle();

  const { error } = existing
    ? await sb.from("pmax_report_settings").update(row).eq("shop_name", shopName)
    : await sb.from("pmax_report_settings").insert(row);

  if (error) {
    console.error("[pmax/report-settings] save error:", error.message);
    return NextResponse.json({ error: "保存に失敗しました" }, { status: 500 });
  }

  const parts = [
    body?.overrides !== undefined ? `数値上書き${Object.keys(clean.overrides).length}件` : null,
    body?.sectionVisibility !== undefined ? "表示設定" : null,
  ].filter(Boolean).join("・");
  ctx.detail = `${shopName}: ${parts || "変更なし"}を保存`;
  return NextResponse.json({ success: true });
});
