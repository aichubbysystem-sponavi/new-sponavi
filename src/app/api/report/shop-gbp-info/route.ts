/**
 * GET /api/report/shop-gbp-info
 *
 * Supabase の shops から「Go APIの /api/shop が返さない項目」を補うためのエンドポイント。
 * Go API のレスポンスには gbp_shop_name / state / city / phone が含まれないため、
 * 顧客マスタ画面はこのAPIとマージして GBP上の現在の店名を表示・検索できるようにする。
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabase, requireAuth, getUserAllowedShops } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface Row {
  id: string;
  name: string;
  gbp_shop_name: string | null;
  gbp_location_name: string | null;
  gbp_full_path: string | null;
  gbp_main_category: string | null;
  state: string | null;
  city: string | null;
  phone: string | null;
  cancelled_at: string | null;
  paused_at: string | null;
  /** 順位計測の対象外フラグと理由。'master' かつ解約/停止でない = 「MEOマスタ記載なし」 */
  rank_tracking_disabled: boolean | null;
  rank_tracking_reason: string | null;
}

export async function GET(request: NextRequest) {
  const { auth, error } = await requireAuth(request);
  if (error) return error;

  const sb = getSupabase();

  // PostgRESTは1リクエスト最大1000行のため必ずページングする
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error: qErr } = await sb
      .from("shops")
      .select("id, name, gbp_shop_name, gbp_location_name, gbp_full_path, gbp_main_category, state, city, phone, cancelled_at, paused_at, rank_tracking_disabled, rank_tracking_reason")
      .order("id")
      .range(from, from + 999);
    if (qErr) {
      // 握りつぶさない: 空配列を返すと「GBP名が無い」と区別できなくなる
      return NextResponse.json({ error: qErr.message }, { status: 500 });
    }
    const page = (data || []) as Row[];
    rows.push(...page);
    if (page.length < 1000) break;
  }

  const allowed = await getUserAllowedShops(auth.sub);
  if (allowed === "all") return NextResponse.json({ shops: rows });

  const normName = (s: string) => (s || "").normalize("NFKC").replace(/[\s　]+/g, "").toLowerCase();
  const allowedSet = new Set(allowed.map(normName));
  return NextResponse.json({
    shops: rows.filter((r) => allowedSet.has(normName(r.name)) || allowedSet.has(normName(r.gbp_shop_name || ""))),
  });
}
