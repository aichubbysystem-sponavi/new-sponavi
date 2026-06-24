import { NextRequest, NextResponse } from "next/server";
import { requireRole, getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** 店舗アクセス権の一覧取得（社長のみ） */
export async function GET(request: NextRequest) {
  const r = await requireRole(request, ["president"]);
  if ("error" in r) return r.error;

  const sb = getSupabase();
  const { data, error } = await sb
    .from("user_shop_access")
    .select("id, auth_uid, shop_name, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data: data || [] });
}

/** 店舗アクセス権の付与（社長のみ） */
export async function POST(request: NextRequest) {
  const r = await requireRole(request, ["president"]);
  if ("error" in r) return r.error;

  const body = await request.json();
  const { auth_uid, shop_names } = body as { auth_uid: string; shop_names: string[] };

  if (!auth_uid || !Array.isArray(shop_names) || shop_names.length === 0) {
    return NextResponse.json({ error: "auth_uid と shop_names（配列）が必要です" }, { status: 400 });
  }

  const sb = getSupabase();
  const rows = shop_names.map((name) => ({ auth_uid, shop_name: name }));
  const { data, error } = await sb
    .from("user_shop_access")
    .upsert(rows, { onConflict: "auth_uid,shop_name" })
    .select();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ added: data?.length || 0 });
}

/** 店舗アクセス権の削除（社長のみ） */
export async function DELETE(request: NextRequest) {
  const r = await requireRole(request, ["president"]);
  if ("error" in r) return r.error;

  const { searchParams } = request.nextUrl;
  const id = searchParams.get("id");
  const auth_uid = searchParams.get("auth_uid");

  const sb = getSupabase();

  if (id) {
    const { error } = await sb.from("user_shop_access").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ deleted: true });
  }

  if (auth_uid) {
    const shop_name = searchParams.get("shop_name");
    let query = sb.from("user_shop_access").delete().eq("auth_uid", auth_uid);
    if (shop_name) query = query.eq("shop_name", shop_name);
    const { error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ deleted: true });
  }

  return NextResponse.json({ error: "id または auth_uid が必要です" }, { status: 400 });
}
