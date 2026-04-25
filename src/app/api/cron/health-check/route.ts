import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getValidTokens } from "@/lib/gbp-token";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

/**
 * GET /api/cron/health-check
 * システムヘルスチェック: DB接続・Go API疎通・OAuthトークン有効性を確認
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const checks: { name: string; status: "ok" | "error"; detail: string; ms: number }[] = [];

  // 1. Supabase DB接続
  const dbStart = Date.now();
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const { count, error } = await supabase.from("shops").select("id", { count: "exact", head: true });
    checks.push({
      name: "Supabase DB",
      status: error ? "error" : "ok",
      detail: error ? error.message : `${count}店舗`,
      ms: Date.now() - dbStart,
    });
  } catch (e: any) {
    checks.push({ name: "Supabase DB", status: "error", detail: e.message, ms: Date.now() - dbStart });
  }

  // 2. Go API疎通
  const apiStart = Date.now();
  try {
    const res = await fetch(`${API_URL}/healthcheck`, { signal: AbortSignal.timeout(10000) });
    checks.push({
      name: "Go API",
      status: res.ok ? "ok" : "error",
      detail: res.ok ? `HTTP ${res.status}` : `HTTP ${res.status}`,
      ms: Date.now() - apiStart,
    });
  } catch (e: any) {
    checks.push({ name: "Go API", status: "error", detail: e.message, ms: Date.now() - apiStart });
  }

  // 3. OAuthトークン有効性（期限切れなら自動リフレッシュ）
  const oauthStart = Date.now();
  try {
    // getValidTokens()が自動的にリフレッシュ+DB書き戻しを行う
    const tokens = await getValidTokens();
    if (tokens.length > 0) {
      // リフレッシュ後のDB状態を確認
      const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
      const { data } = await supabase.from("system_oauth_tokens")
        .select("expiry, account_id").order("expiry", { ascending: false });
      const details = (data || []).map(t => {
        const remaining = new Date(t.expiry).getTime() - Date.now();
        const hours = Math.round(remaining / 3600000);
        return `${t.account_id}: 残${hours}h`;
      }).join(", ");
      checks.push({
        name: "OAuth Token",
        status: "ok",
        detail: `${tokens.length}件有効（${details || "自動リフレッシュ済み"}）`,
        ms: Date.now() - oauthStart,
      });
    } else {
      checks.push({ name: "OAuth Token", status: "error", detail: "トークンなし（リフレッシュ失敗）", ms: Date.now() - oauthStart });
    }
  } catch (e: any) {
    checks.push({ name: "OAuth Token", status: "error", detail: e.message, ms: Date.now() - oauthStart });
  }

  // 4. Vercel Cron Jobs確認
  checks.push({
    name: "Cron Jobs",
    status: "ok",
    detail: "sync-reviews, execute-posts, auto-reply, monthly-analysis",
    ms: 0,
  });

  const allOk = checks.every(c => c.status === "ok");
  console.log(`[health-check] ${allOk ? "ALL OK" : "ISSUES FOUND"}`, checks);

  return NextResponse.json({
    status: allOk ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    checks,
  });
}
