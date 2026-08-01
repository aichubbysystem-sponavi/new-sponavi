/**
 * GET /api/report/shop-ratings
 * 全店舗の「Googleマップ掲載値」（評価・口コミ件数）を返す。
 *
 * 口コミ同期のたびにGBP APIの averageRating / totalReviewCount を
 * shops.rating / shops.review_count に保存しているので、その値をそのまま返す。
 * DB内の口コミを平均した値ではない（Googleの表示値は独自の重み付けがされており
 * 単純平均とは一致しないため、レポートもこの掲載値を使っている）。
 *
 * 用途: 口コミ(RPA)シートへの月次書き込み。
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabase, requireRole } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const r = await requireRole(request, ["president", "executive", "manager"]);
  if (r.error) return r.error;

  const sb = getSupabase();
  const shops: { name: string; rating: number | null; review_count: number | null; synced_at: string | null }[] = [];

  // PostgRESTの1000行上限を避けてページングで全件取得
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("shops")
      .select("name, rating, review_count, synced_at")
      .order("name")
      .range(from, from + 999);
    if (error) {
      console.error("[shop-ratings] select failed:", error.message);
      return NextResponse.json(
        { error: "取得に失敗しました", _error: error.message },
        { status: 500 },
      );
    }
    if (!data || data.length === 0) break;
    shops.push(...(data as any[]));
    if (data.length < 1000) break;
  }

  const withRating = shops.filter((s) => s.rating && s.rating > 0);
  return NextResponse.json({
    shops,
    summary: {
      total: shops.length,
      withRating: withRating.length,
      withoutRating: shops.length - withRating.length,
    },
  });
}
