import { NextRequest, NextResponse } from "next/server";
import { requireRole, getSupabase } from "@/lib/supabase";
import { getGroupStores } from "@/lib/pmax-groups";

export const dynamic = "force-dynamic";

/**
 * POST /api/pmax/group-share
 * body: { groupName: string }
 * グループ単位の共有トークンを発行（既存があれば再利用）。
 * トークン自体はグループ名だけを保持し、公開ページでは
 * そのグループの店舗のみ参照できる。
 */
export async function POST(request: NextRequest) {
  const r = await requireRole(request, ["president", "manager"]);
  if (r.error) return r.error;

  try {
    const { groupName } = await request.json();
    if (!groupName || typeof groupName !== "string") {
      return NextResponse.json({ error: "groupName は必須です" }, { status: 400 });
    }

    // シートに実在するグループのみ共有可能にする（正規化名で照合）
    const group = await getGroupStores(groupName);
    if (!group) {
      return NextResponse.json({ error: "指定されたグループが定義シートに存在しません" }, { status: 404 });
    }

    const sb = getSupabase();

    // 既存トークンがあれば再利用（1グループ=1URLで安定させる）
    const { data: existing } = await sb
      .from("pmax_group_shares")
      .select("token")
      .eq("group_name", group.name)
      .limit(1);

    if (existing && existing.length > 0) {
      return NextResponse.json({ token: existing[0].token, groupName: group.name });
    }

    const { data, error } = await sb
      .from("pmax_group_shares")
      .insert({ group_name: group.name, created_by: r.sub })
      .select("token")
      .single();

    if (error) {
      console.error("[pmax/group-share] Insert error:", error);
      return NextResponse.json({ error: "共有リンクの発行に失敗しました" }, { status: 500 });
    }

    return NextResponse.json({ token: data.token, groupName: group.name });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
