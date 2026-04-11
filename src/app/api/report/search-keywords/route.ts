import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
}

/**
 * POST /api/report/search-keywords
 * 検索語句をSupabaseに保存
 */
export async function POST(request: NextRequest) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = await request.json();
  const { shopId, keywords, periodStart, periodEnd } = body as {
    shopId: string;
    keywords: { keyword: string; count: number }[];
    periodStart: string;
    periodEnd: string;
  };

  if (!shopId || !keywords || keywords.length === 0) {
    return NextResponse.json({ error: "shopIdとkeywordsが必要です" }, { status: 400 });
  }

  const supabase = getSupabase();
  const periodLabel = new Date(periodStart).toISOString().slice(0, 7); // "2026-04"

  // 同じ店舗・同じ月のデータを削除して再挿入（最新データで上書き）
  await supabase
    .from("search_keyword_logs")
    .delete()
    .eq("shop_id", shopId)
    .eq("period_label", periodLabel);

  const rows = keywords.map((kw) => ({
    id: crypto.randomUUID(),
    shop_id: shopId,
    keyword: kw.keyword,
    count: kw.count,
    period_label: periodLabel,
    period_start: periodStart,
    period_end: periodEnd,
    fetched_at: new Date().toISOString(),
  }));

  // 50件ずつバッチinsert
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    const { error } = await supabase.from("search_keyword_logs").insert(batch);
    if (error) {
      console.error("[search-keywords] insert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true, saved: rows.length, period: periodLabel });
}

/**
 * GET /api/report/search-keywords?shopId=xxx
 * 保存済み検索語句の履歴を取得
 */
export async function GET(request: NextRequest) {
  const shopId = request.nextUrl.searchParams.get("shopId");
  if (!shopId) {
    return NextResponse.json({ error: "shopIdが必要です" }, { status: 400 });
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("search_keyword_logs")
    .select("keyword, count, period_label, fetched_at")
    .eq("shop_id", shopId)
    .order("period_label", { ascending: true })
    .order("count", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 月別にグループ化
  const months = new Map<string, { keyword: string; count: number }[]>();
  for (const row of data || []) {
    if (!months.has(row.period_label)) months.set(row.period_label, []);
    months.get(row.period_label)!.push({ keyword: row.keyword, count: row.count });
  }

  return NextResponse.json({
    months: Array.from(months.entries()).map(([period, keywords]) => ({
      period,
      keywords: keywords.slice(0, 20),
    })),
  });
}
