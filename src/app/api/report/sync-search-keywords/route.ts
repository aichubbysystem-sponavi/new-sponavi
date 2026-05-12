/**
 * POST /api/report/sync-search-keywords
 * 指定店舗の検索語句をGBP Performance APIから取得してキャッシュに保存
 * syncShopDataフローとは独立して動作する
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const GBP_CLIENT_ID = process.env.GBP_CLIENT_ID || "";
const GBP_CLIENT_SECRET = process.env.GBP_CLIENT_SECRET || "";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
}

async function getDbToken(): Promise<string | null> {
  if (!GBP_CLIENT_ID || !GBP_CLIENT_SECRET) return null;
  const supabase = getSupabase();
  const { data } = await supabase.from("system_oauth_tokens").select("refresh_token").limit(1).maybeSingle();
  if (!data?.refresh_token) return null;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GBP_CLIENT_ID, client_secret: GBP_CLIENT_SECRET,
      refresh_token: data.refresh_token, grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return null;
  const tokenData = await res.json();
  return tokenData.access_token || null;
}

async function fetchMonth(locPart: string, year: number, month: number, token: string) {
  const url = `https://businessprofileperformance.googleapis.com/v1/${locPart}/searchkeywords/impressions/monthly?monthlyRange.startMonth.year=${year}&monthlyRange.startMonth.month=${month}&monthlyRange.endMonth.year=${year}&monthlyRange.endMonth.month=${month}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) return null;
  const data = await res.json();
  const keywords: { word: string; count: number }[] = [];
  for (const item of data.searchKeywordsCounts || []) {
    const word = item.searchKeyword || "";
    const raw = item.insightsValue?.value;
    const count = typeof raw === "string" ? parseInt(raw, 10) || 0 : raw || 0;
    if (word && count > 0) keywords.push({ word, count });
  }
  if (keywords.length === 0) return null;
  return { month: `${year}/${month}`, keywords: keywords.sort((a, b) => b.count - a.count) };
}

async function handleSync(shopName: string, months: number) {

  if (!shopName) {
    return NextResponse.json({ error: "shopName required" }, { status: 400 });
  }

  const supabase = getSupabase();
  const log: string[] = [];

  // 1. 店舗検索
  const { data: shop } = await supabase
    .from("shops")
    .select("id, gbp_location_name")
    .eq("name", shopName)
    .maybeSingle();

  if (!shop?.gbp_location_name) {
    return NextResponse.json({ error: `Shop not found or no gbp_location_name: ${shopName}`, shop }, { status: 404 });
  }
  log.push(`Shop found: ${shop.id} / ${shop.gbp_location_name}`);

  // 2. トークン取得
  const token = await getDbToken();
  if (!token) {
    return NextResponse.json({ error: "Failed to get OAuth token" }, { status: 500 });
  }
  log.push("Token obtained");

  // 3. 検索語句取得（4並列バッチ）
  const locPart = shop.gbp_location_name;
  const now = new Date();
  const targets: { year: number; month: number }[] = [];
  for (let i = 1; i <= months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    targets.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }

  const results: { month: string; keywords: { word: string; count: number }[] }[] = [];
  for (let i = 0; i < targets.length; i += 4) {
    const batch = targets.slice(i, i + 4);
    const batchResults = await Promise.all(
      batch.map(t => fetchMonth(locPart, t.year, t.month, token))
    );
    for (const r of batchResults) {
      if (r) results.push(r);
    }
  }
  results.sort((a, b) => a.month.localeCompare(b.month));
  log.push(`Fetched ${results.length}/${months} months`);

  if (results.length === 0) {
    return NextResponse.json({ error: "API returned 0 months of data", log }, { status: 500 });
  }

  // 4. search_query_cache に保存
  const cacheRows = results.map(m => ({
    shop_id: shop.id,
    shop_name: shopName,
    month: m.month,
    keywords: m.keywords,
    source: "api",
    updated_at: new Date().toISOString(),
  }));
  const { error: cacheErr } = await supabase
    .from("search_query_cache")
    .upsert(cacheRows, { onConflict: "shop_id,month" });
  if (cacheErr) log.push(`Cache write error: ${cacheErr.message}`);
  else log.push(`Saved to search_query_cache: ${results.length} months`);

  // 5. report_data_cache のsearchQueriesを更新
  const latest = results[results.length - 1];
  const { data: reportCache } = await supabase
    .from("report_data_cache")
    .select("report_json")
    .eq("shop_name", shopName)
    .maybeSingle();

  if (reportCache?.report_json) {
    const reportJson = reportCache.report_json as any;
    reportJson.searchQueries = {
      latest: latest.keywords.slice(0, 30),
      latestMonth: latest.month,
      history: results,
    };
    const { error: updateErr } = await supabase
      .from("report_data_cache")
      .update({ report_json: reportJson, synced_at: new Date().toISOString() })
      .eq("shop_name", shopName);
    if (updateErr) log.push(`Report cache update error: ${updateErr.message}`);
    else log.push(`Updated report_data_cache searchQueries → ${latest.month}`);
  } else {
    log.push("No report_data_cache entry found, skipping update");
  }

  return NextResponse.json({
    success: true,
    shopName,
    latestMonth: latest.month,
    totalMonths: results.length,
    topKeywords: latest.keywords.slice(0, 5),
    log,
  });
}

// GET: ブラウザから直接アクセス用
export async function GET(request: NextRequest) {
  const shopName = request.nextUrl.searchParams.get("name") || "";
  const months = parseInt(request.nextUrl.searchParams.get("months") || "12") || 12;
  return handleSync(shopName, months);
}

// POST: プログラムから呼び出し用
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const shopName = body.shopName || "";
  const months = body.months || 12;
  return handleSync(shopName, months);
}
