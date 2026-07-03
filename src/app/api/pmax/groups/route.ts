import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/supabase";
import { getPmaxGroups } from "@/lib/pmax-groups";

export const dynamic = "force-dynamic";

/**
 * GET /api/pmax/groups?refresh=1
 * グループ定義シートからグループ→店舗マッピングを返す
 * refresh=1 でシートを再読込（「グループを更新」ボタン用）
 */
export async function GET(request: NextRequest) {
  const r = await requireRole(request, ["president", "manager"]);
  if (r.error) return r.error;

  const refresh = request.nextUrl.searchParams.get("refresh") === "1";

  try {
    const groups = await getPmaxGroups(refresh);
    return NextResponse.json({
      groups: groups.map((g) => ({ name: g.name, stores: g.stores })),
      refreshedAt: refresh ? new Date().toISOString() : null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "グループ取得に失敗しました";
    console.error("[pmax/groups]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
