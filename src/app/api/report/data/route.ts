import { NextRequest, NextResponse } from "next/server";
import { getReportData } from "@/lib/report-api";
import { verifyAuth, verifyShopAccess, getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/report/data?shopId=<店舗名>&month=YYYY/M
 * レポートデータを認証付きで返す。
 * 以前は report/[shopId]/page.tsx（サーバーコンポーネント）が未認証でHTMLに
 * 実データを埋め込んでいたため、未ログインでも取得できてしまっていた。
 * データ取得を必ずこの認証付きルート経由にすることで漏洩を防ぐ。
 */
async function getGoogleReviewUrl(shopName: string): Promise<string> {
  try {
    const supabase = getSupabase();
    const { data } = await supabase
      .from("shops")
      .select("gbp_place_id")
      .eq("name", shopName)
      .maybeSingle();
    if (data?.gbp_place_id) {
      return `https://search.google.com/local/reviews?placeid=${data.gbp_place_id}`;
    }
  } catch {}
  return `https://www.google.com/maps/search/${encodeURIComponent(shopName + " 口コミ")}`;
}

export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid || !auth.sub) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const shopId = request.nextUrl.searchParams.get("shopId");
  if (!shopId) {
    return NextResponse.json({ error: "shopIdが必要です" }, { status: 400 });
  }
  const targetMonth = request.nextUrl.searchParams.get("month") || undefined;
  // fast=1: シートへのリアルタイム順位取得を省略して即返す（初期表示用。最新値は後続の通常リクエストで差し替え）
  const fast = request.nextUrl.searchParams.get("fast") === "1";
  const shopName = decodeURIComponent(shopId);

  // 店舗アクセス権チェック（president以外は許可店舗のみ）
  if (!(await verifyShopAccess(auth.sub, shopName))) {
    return NextResponse.json({ error: "この店舗へのアクセス権がありません" }, { status: 403 });
  }

  const [{ data, source }, googleReviewUrl] = await Promise.all([
    getReportData(shopId, targetMonth, { skipSheets: fast }),
    getGoogleReviewUrl(shopName),
  ]);

  return NextResponse.json({ data, source, googleReviewUrl });
}
