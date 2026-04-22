import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveLocationName } from "@/lib/gbp-location";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const GO_API_URL = process.env.NEXT_PUBLIC_API_URL || "";
const GBP_API_BASE = "https://mybusiness.googleapis.com/v4";
const GBP_CLIENT_ID = process.env.GBP_CLIENT_ID || "";
const GBP_CLIENT_SECRET = process.env.GBP_CLIENT_SECRET || "";
const DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD || "";
const SUPABASE_PROJECT_ID = (SUPABASE_URL.match(/https:\/\/([^.]+)/) || [])[1] || "";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
}

async function refreshToken(rt: string): Promise<string | null> {
  if (!rt || !GBP_CLIENT_ID || !GBP_CLIENT_SECRET) return null;
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: GBP_CLIENT_ID, client_secret: GBP_CLIENT_SECRET, refresh_token: rt, grant_type: "refresh_token" }),
    });
    if (res.ok) { const d = await res.json(); return d.access_token || null; }
  } catch {}
  return null;
}

async function getAllValidTokens(): Promise<string[]> {
  // Go APIにGBP APIを叩かせてトークンリフレッシュ発火
  try {
    await fetch(`${GO_API_URL}/api/gbp/account`, { signal: AbortSignal.timeout(15000) });
  } catch {}

  interface TokenRow { access_token: string; refresh_token: string; expiry: string; }
  let allRows: TokenRow[] = [];

  // 1. Supabase client (system_oauth_tokens) — 全トークン取得
  try {
    const supabase = getSupabase();
    const { data } = await supabase.from("system_oauth_tokens")
      .select("access_token, refresh_token, expiry")
      .order("expiry", { ascending: false });
    if (data && data.length > 0) allRows = data as TokenRow[];
  } catch {}

  // 2. フォールバック: PostgreSQL直接接続
  if (allRows.length === 0) {
    try {
      if (DB_PASSWORD && SUPABASE_PROJECT_ID) {
        const { Client } = await import("pg");
        const client = new Client({
          host: `db.${SUPABASE_PROJECT_ID}.supabase.co`, port: 5432,
          database: "postgres", user: "postgres", password: DB_PASSWORD,
          ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000,
        });
        await client.connect();
        const result = await client.query("SELECT access_token, refresh_token, expiry FROM system.tokens ORDER BY expiry DESC");
        await client.end();
        if (result.rows.length > 0) allRows = result.rows;
      }
    } catch (e: any) {
      console.log("[cron/execute-posts] PostgreSQL error:", e?.message);
    }
  }

  // 全トークンをリフレッシュして返す
  const validTokens: string[] = [];
  for (const row of allRows) {
    if (new Date(row.expiry).getTime() - Date.now() > 60000) {
      validTokens.push(row.access_token);
    } else if (row.refresh_token) {
      const refreshed = await refreshToken(row.refresh_token);
      validTokens.push(refreshed || row.access_token);
    } else {
      validTokens.push(row.access_token);
    }
  }
  return validTokens;
}

/**
 * GET /api/cron/execute-posts
 * 予約投稿の自動実行: scheduled_postsテーブルのpending投稿をGBPに投稿
 * 毎時0分に実行
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();
  const now = new Date().toISOString();

  // scheduled_atが現在時刻以前のpending投稿を取得
  const { data: posts, error: fetchErr } = await supabase
    .from("scheduled_posts")
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_at", now)
    .order("scheduled_at", { ascending: true })
    .limit(10); // Vercel Hobby 60秒制限: 1投稿約5秒 → 最大10件/実行

  if (fetchErr || !posts || posts.length === 0) {
    return NextResponse.json({ success: true, message: "実行対象なし", count: 0 });
  }

  const allTokens = await getAllValidTokens();
  if (allTokens.length === 0) {
    return NextResponse.json({ error: "OAuthトークンなし" }, { status: 500 });
  }

  // 店舗情報を取得
  const shopIds = Array.from(new Set(posts.map(p => p.shop_id)));
  const { data: shops } = await supabase
    .from("shops")
    .select("id, name, gbp_location_name")
    .in("id", shopIds);

  const shopMap = new Map((shops || []).map(s => [s.id, s]));
  let posted = 0;
  let errors = 0;

  for (const post of posts) {
    const shop = shopMap.get(post.shop_id);
    if (!shop || !shop.gbp_location_name) {
      await supabase.from("scheduled_posts").update({ status: "error" }).eq("id", post.id);
      errors++;
      continue;
    }

    const locationName = await resolveLocationName(shop.gbp_location_name);
    if (!locationName) {
      await supabase.from("scheduled_posts").update({ status: "error" }).eq("id", post.id);
      errors++;
      continue;
    }

    const postBody: any = {
      summary: (post.summary || "").slice(0, 1500),
      topicType: post.topic_type || "STANDARD",
      languageCode: "ja",
    };
    if (post.media_url) {
      postBody.media = [{ mediaFormat: "PHOTO", sourceUrl: post.media_url }];
    }

    try {
      let res: Response | null = null;
      for (const token of allTokens) {
        res = await fetch(`${GBP_API_BASE}/${locationName}/localPosts`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(postBody),
        });
        if (res.ok || (res.status !== 401 && res.status !== 403)) break;
      }

      if (res && res.ok) {
        const result = await res.json();
        await supabase.from("scheduled_posts").update({
          status: "published",
          posted_at: new Date().toISOString(),
        }).eq("id", post.id);

        // post_logsにも記録
        await supabase.from("post_logs").insert({
          id: crypto.randomUUID(),
          shop_id: post.shop_id,
          shop_name: shop.name,
          summary: post.summary,
          topic_type: post.topic_type || "STANDARD",
          search_url: result.searchUrl || null,
        });
        posted++;
      } else {
        await supabase.from("scheduled_posts").update({ status: "error" }).eq("id", post.id);
        errors++;
      }
    } catch {
      await supabase.from("scheduled_posts").update({ status: "error" }).eq("id", post.id);
      errors++;
    }
  }

  console.log(`[cron/execute-posts] posted: ${posted}, errors: ${errors}`);
  return NextResponse.json({ success: true, posted, errors, total: posts.length });
}
