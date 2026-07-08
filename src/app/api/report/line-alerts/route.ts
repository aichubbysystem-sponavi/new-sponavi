import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { withAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/report/line-alerts
 * LINEアラートを「対応済み(resolved=true)」にする。
 * 以前は anonキーで line_alerts を直接 update できた（誰でもアラートを消せた）。
 * 管理ダッシュボードの操作のため withAudit(DATA_OP) で認可 + 監査記録する。
 * body: { id }
 */
export const PATCH = withAudit("順位アラート既読化", "DATA_OP", async (request, ctx) => {
  const { id } = await request.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: "idが必要です" }, { status: 400 });

  const supabase = getSupabase();
  const { error } = await supabase.from("line_alerts").update({ resolved: true }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  ctx.detail = `アラートID ${id} を対応済みに変更`;
  return NextResponse.json({ success: true });
});
