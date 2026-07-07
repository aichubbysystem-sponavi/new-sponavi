import { NextRequest, NextResponse } from "next/server";
import { requireRole, getSupabase } from "@/lib/supabase";
import { getGroupStores } from "@/lib/pmax-groups";
import { isShareActive, shareExpiryISO } from "@/lib/share-token";
import crypto from "crypto";

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

    // 既存トークン（group_nameはUNIQUE=最大1件）を確認
    const { data: existing } = await sb
      .from("pmax_group_shares")
      .select("token, expires_at, revoked_at")
      .eq("group_name", group.name)
      .maybeSingle();

    if (existing) {
      if (isShareActive(existing)) {
        // 有効: 再利用しつつ期限を延長（1グループ=1URLで安定）
        await sb.from("pmax_group_shares").update({ expires_at: shareExpiryISO() }).eq("token", existing.token);
        return NextResponse.json({ token: existing.token, groupName: group.name });
      }
      // 失効/期限切れ: UNIQUE制約のため行を作り直せないので、トークンを新しいUUIDに回転（旧URLは死ぬ）
      const newToken = crypto.randomUUID();
      const { error: rotErr } = await sb.from("pmax_group_shares").update({
        token: newToken, expires_at: shareExpiryISO(), revoked_at: null, created_by: r.sub,
      }).eq("group_name", group.name);
      if (rotErr) {
        console.error("[pmax/group-share] Rotate error:", rotErr);
        return NextResponse.json({ error: "共有リンクの再発行に失敗しました" }, { status: 500 });
      }
      return NextResponse.json({ token: newToken, groupName: group.name });
    }

    const { data, error } = await sb
      .from("pmax_group_shares")
      .insert({ group_name: group.name, created_by: r.sub, expires_at: shareExpiryISO() })
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

/**
 * DELETE /api/pmax/group-share  body: { groupName }
 * グループ共有を停止（失効）。revoked_at をセットし、以降そのURLを無効化する。
 */
export async function DELETE(request: NextRequest) {
  const r = await requireRole(request, ["president", "manager"]);
  if (r.error) return r.error;

  try {
    const { groupName } = await request.json();
    if (!groupName || typeof groupName !== "string") {
      return NextResponse.json({ error: "groupName は必須です" }, { status: 400 });
    }
    const sb = getSupabase();
    const { error } = await sb
      .from("pmax_group_shares")
      .update({ revoked_at: new Date().toISOString() })
      .eq("group_name", groupName)
      .is("revoked_at", null);
    if (error) return NextResponse.json({ error: "失効に失敗しました" }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
