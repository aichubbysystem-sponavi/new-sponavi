/**
 * GET /api/report/grid-shop-status
 * 計測対象店舗ごとの「今月計測したか / していないなら何が足りないか」を返す。
 *
 * 【背景】
 * 画面には「今月計測済み 181/223」という数字しか無く、
 * どの店舗が計測できていないのか、なぜできていないのかが分からなかった。
 * 未計測の理由（座標なし・KW未設定）まで出さないと対応のしようがない。
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabase, requireRole } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  name: string;
  measured: boolean;
  lastMeasuredAt: string | null;
  keywordCount: number;
  hasCoord: boolean;
  /** 未計測の理由。計測済みなら空 */
  reasons: string[];
};

export async function GET(request: NextRequest) {
  const r = await requireRole(request, ["president", "executive", "manager"]);
  if (r.error) return r.error;

  const sb = getSupabase();

  // 計測対象の店舗（対象外フラグが立っていないもの）
  const shops: { id: string; name: string; lat: number | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("shops")
      .select("id, name, gbp_latitude")
      .eq("rank_tracking_disabled", false)
      .order("name")
      .range(from, from + 999);
    if (error) {
      console.error("[grid-shop-status] shops select failed:", error.message);
      return NextResponse.json({ error: "店舗の取得に失敗しました", _error: error.message }, { status: 500 });
    }
    if (!data || data.length === 0) break;
    for (const s of data as any[]) shops.push({ id: s.id, name: s.name, lat: s.gbp_latitude });
    if (data.length < 1000) break;
  }

  // キーワード数
  const kwCount = new Map<string, number>();
  for (let from = 0; ; from += 1000) {
    const { data } = await sb
      .from("shop_keywords")
      .select("shop_id, keywords")
      .order("shop_id")
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const k of data as { shop_id: string; keywords: string[] | null }[]) {
      kwCount.set(k.shop_id, Array.isArray(k.keywords) ? k.keywords.length : 0);
    }
    if (data.length < 1000) break;
  }

  // 今月の計測ログ（店舗ごとの最終計測日時）
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01T00:00:00`;
  const lastMeasured = new Map<string, string>();
  for (let from = 0; ; from += 1000) {
    const { data } = await sb
      .from("grid_ranking_logs")
      .select("shop_id, measured_at")
      .gte("measured_at", monthStart)
      .order("shop_id")
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const l of data as { shop_id: string; measured_at: string }[]) {
      const prev = lastMeasured.get(l.shop_id);
      if (!prev || l.measured_at > prev) lastMeasured.set(l.shop_id, l.measured_at);
    }
    if (data.length < 1000) break;
  }

  const rows: Row[] = shops.map((s) => {
    const kw = kwCount.get(s.id) ?? 0;
    const hasCoord = !!s.lat && s.lat !== 0;
    const at = lastMeasured.get(s.id) || null;
    const reasons: string[] = [];
    if (!at) {
      if (!hasCoord) reasons.push("座標なし");
      if (kw === 0) reasons.push("KW未設定");
      if (reasons.length === 0) reasons.push("未実行");
    }
    return { id: s.id, name: s.name, measured: !!at, lastMeasuredAt: at, keywordCount: kw, hasCoord, reasons };
  });

  return NextResponse.json({
    shops: rows,
    summary: {
      total: rows.length,
      measured: rows.filter((x) => x.measured).length,
      unmeasured: rows.filter((x) => !x.measured).length,
      noCoord: rows.filter((x) => !x.measured && !x.hasCoord).length,
      noKw: rows.filter((x) => !x.measured && x.keywordCount === 0).length,
    },
  });
}
