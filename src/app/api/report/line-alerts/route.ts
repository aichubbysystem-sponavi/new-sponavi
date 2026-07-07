import { NextRequest, NextResponse } from "next/server";
import { getSupabase, requireRole } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/report/line-alerts
 * LINEアラートを「対応済み(resolved=true)」にする。
 * 以前は anonキーで line_alerts を直接 update できた（誰でもアラートを消せた）。
 * 管理ダッシュボードの操作のため president/manager のみに限定する。
 * body: { id }
 */
export async function PATCH(request: NextRequest) {
  const r = await requireRole(request, ["president", "manager"]);
  if (r.error) return r.error;

  const { id } = await request.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: "idが必要です" }, { status: 400 });

  const supabase = getSupabase();
  const { error } = await supabase.from("line_alerts").update({ resolved: true }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
