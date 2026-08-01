/**
 * 順位計測の対象外フラグ（shops.rank_tracking_disabled）の取得・設定。
 *
 * GET  /api/report/rank-tracking          — 対象外の店舗一覧
 * POST /api/report/rank-tracking          — フラグの設定
 *    body: { shopIds: string[], disabled: boolean }        個別指定
 *    body: { namePrefix: string, disabled: boolean, apply?: boolean }
 *                                          名前の前方一致で一括（既定はdry-run）
 *
 * 【背景】
 * エミナル系列は122店舗（エミナルクリニック59 + メンズエミナル63）あるが
 * 全店とも順位計測しない。
 * 誤って「いつもの店舗」に追加され一括計測が走ると、
 * 1店舗あたり5地点×キーワード数の課金が122件分発生する。
 * 一覧のフィルタだけでは事故を防げないため、フラグで構造的に止める。
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabase, verifyAuth, getUserAllowedShops } from "@/lib/supabase";
import { withAudit } from "@/lib/audit";
import { normalizeShopName } from "@/lib/shop-status";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid || !auth.sub) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("shops")
    .select("id, name, rank_tracking_reason")
    .eq("rank_tracking_disabled", true)
    .order("name");

  if (error) {
    console.error("[rank-tracking] select failed:", error.message);
    return NextResponse.json(
      { error: "取得に失敗しました", _error: error.message },
      { status: 500 },
    );
  }

  const allowed = await getUserAllowedShops(auth.sub);
  const rows = data || [];
  if (allowed === "all") return NextResponse.json({ shops: rows });

  const allowedSet = new Set(allowed.map(normalizeShopName));
  return NextResponse.json({
    shops: rows.filter((s) => allowedSet.has(normalizeShopName(s.name))),
  });
}

export const POST = withAudit("順位計測対象の変更", "DATA_OP", async (request, ctx) => {
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "不正なリクエストです" }, { status: 400 });

  const disabled = body.disabled === true;
  const supabase = getSupabase();

  // ── 名前に含む文字列で一括設定 ──
  // 前方一致だと系列違いを取りこぼす。実データでは「エミナルクリニック」59件と
  // 「メンズエミナル」63件が別系列で存在し、前方一致では片方しか当たらない。
  // そのため部分一致にし、代わりに3文字以上必須＋dry-run必須で誤爆を防ぐ。
  const nameQuery = typeof body.namePrefix === "string" ? body.namePrefix : body.nameContains;
  if (typeof nameQuery === "string" && nameQuery.trim()) {
    const needle = normalizeShopName(nameQuery);
    if (needle.length < 3) {
      // 短すぎる指定は巻き込み事故になる
      return NextResponse.json(
        { error: "対象の文字列は3文字以上を指定してください" },
        { status: 400 },
      );
    }

    // 正規化して前方一致させるため、DB側のLIKEではなくJS側で絞る
    const all: { id: string; name: string; rank_tracking_disabled: boolean }[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("shops")
        .select("id, name, rank_tracking_disabled")
        .order("id")
        .range(from, from + 999);
      if (error) {
        return NextResponse.json({ error: "店舗の取得に失敗しました", _error: error.message }, { status: 500 });
      }
      if (!data || data.length === 0) break;
      all.push(...(data as any[]));
      if (data.length < 1000) break;
    }

    const targets = all.filter(
      (s) => normalizeShopName(s.name).includes(needle) && s.rank_tracking_disabled !== disabled,
    );

    if (body.apply !== true) {
      ctx.detail = `dry-run: 「${nameQuery}」で${targets.length}件が対象`;
      return NextResponse.json({
        dryRun: true,
        matched: targets.length,
        shops: targets.map((s) => ({ id: s.id, name: s.name })),
      });
    }

    let updated = 0;
    const failed: { name: string; error: string }[] = [];
    // 100件ずつ更新（INのサイズを抑える）
    for (let i = 0; i < targets.length; i += 100) {
      const chunk = targets.slice(i, i + 100);
      const { error } = await supabase
        .from("shops")
        // この画面からの操作は手動指定。同期に上書きされないよう reason を立てる
        .update({ rank_tracking_disabled: disabled, rank_tracking_reason: disabled ? "manual" : null })
        .in("id", chunk.map((s) => s.id));
      if (error) {
        for (const s of chunk) failed.push({ name: s.name, error: error.message });
      } else {
        updated += chunk.length;
      }
    }

    ctx.detail = `「${nameQuery}」の${updated}件を順位計測${disabled ? "対象外" : "対象"}に変更`;
    return NextResponse.json({ dryRun: false, updated, failed });
  }

  // ── 個別指定 ──
  const shopIds: string[] = Array.isArray(body.shopIds)
    ? body.shopIds.filter((v: unknown): v is string => typeof v === "string" && v.length > 0)
    : [];
  if (shopIds.length === 0) {
    return NextResponse.json({ error: "shopIds または namePrefix が必要です" }, { status: 400 });
  }

  const { data: rows, error: selErr } = await supabase
    .from("shops")
    .select("id, name")
    .in("id", shopIds);
  if (selErr) {
    return NextResponse.json({ error: "店舗の取得に失敗しました", _error: selErr.message }, { status: 500 });
  }

  const { error } = await supabase
    .from("shops")
    // この画面からの操作は手動指定。同期に上書きされないよう reason を立てる
    .update({ rank_tracking_disabled: disabled, rank_tracking_reason: disabled ? "manual" : null })
    .in("id", shopIds);
  if (error) {
    return NextResponse.json({ error: "更新に失敗しました", _error: error.message }, { status: 500 });
  }

  const names = (rows || []).map((r) => r.name);
  ctx.detail = `${names.length}件を順位計測${disabled ? "対象外" : "対象"}に変更（${names.slice(0, 5).join("、")}${names.length > 5 ? " 他" : ""}）`;
  return NextResponse.json({ updated: names.length, shops: rows || [] });
});
