import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const GBP_API_BASE = "https://mybusiness.googleapis.com/v4";
const GBP_CLIENT_ID = process.env.GBP_CLIENT_ID || "";
const GBP_CLIENT_SECRET = process.env.GBP_CLIENT_SECRET || "";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
}

const GO_API_URL = process.env.NEXT_PUBLIC_API_URL || "";
const DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD || "";
const SUPABASE_PROJECT_ID = (SUPABASE_URL.match(/https:\/\/([^.]+)/) || [])[1] || "";

async function refreshOAuthToken(rt: string): Promise<string | null> {
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
      console.log("[cron/auto-reply] PostgreSQL error:", e?.message);
    }
  }

  // 全トークンをリフレッシュして返す
  const validTokens: string[] = [];
  for (const row of allRows) {
    if (new Date(row.expiry).getTime() - Date.now() > 60000) {
      validTokens.push(row.access_token);
    } else if (row.refresh_token) {
      const refreshed = await refreshOAuthToken(row.refresh_token);
      validTokens.push(refreshed || row.access_token);
    } else {
      validTokens.push(row.access_token);
    }
  }
  return validTokens;
}

// ── ロケーションマッピング ──

interface LocMapping { fullPath: string; title: string; }

async function getLocationMap(token: string): Promise<Map<string, LocMapping>> {
  const map = new Map<string, LocMapping>();
  try {
    const res = await fetch(`${GO_API_URL}/api/gbp/account`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20000),
    });
    if (res.ok) {
      const accounts = await res.json();
      for (const acc of (Array.isArray(accounts) ? accounts : [])) {
        const accName = acc.name || "";
        for (const loc of (acc.locations || [])) {
          const locName = loc.name || "";
          const fullPath = `${accName}/${locName}`;
          const m: LocMapping = { fullPath, title: loc.title || "" };
          map.set(locName, m);
          map.set(fullPath, m);
          if (loc.title) map.set(loc.title, m);
        }
      }
    }
  } catch {}
  return map;
}

const RATING_MAP: Record<string, number> = {
  ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5,
  ONE_STAR: 1, TWO_STARS: 2, THREE_STARS: 3, FOUR_STARS: 4, FIVE_STARS: 5,
};

function starToNum(s: string | null): number {
  if (!s) return 0;
  return RATING_MAP[s.toUpperCase().replace(/_STARS?$/, "")] || 0;
}

/**
 * GET /api/cron/auto-reply
 * 口コミ自動返信: 未返信口コミにAI生成の返信を自動投稿
 * 毎日9:00 JSTに実行
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    console.error("[cron/auto-reply] Unauthorized: CRON_SECRET未設定または不一致");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY未設定" }, { status: 500 });
  }

  const supabase = getSupabase();

  // 自動返信設定がある店舗を取得（Go APIのreview_reply_settingと同等）
  // Supabaseにreview_auto_reply_settingsテーブルがなければ、全店舗の★4-5に自動返信
  const { data: shops } = await supabase
    .from("shops")
    .select("id, name, gbp_location_name")
    .not("gbp_location_name", "is", null);

  if (!shops || shops.length === 0) {
    return NextResponse.json({ success: true, message: "店舗なし", replied: 0 });
  }

  // 未返信口コミを取得（直近7日以内、最大30件）
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: unreplied } = await supabase
    .from("reviews")
    .select("id, shop_id, shop_name, review_id, reviewer_name, star_rating, comment, create_time")
    .is("reply_comment", null)
    .gte("create_time", weekAgo)
    .not("comment", "is", null)
    .order("create_time", { ascending: false })
    .limit(30);

  if (!unreplied || unreplied.length === 0) {
    return NextResponse.json({ success: true, message: "未返信口コミなし", replied: 0 });
  }

  const allTokens = await getAllValidTokens();
  if (allTokens.length === 0) {
    return NextResponse.json({ error: "OAuthトークンなし" }, { status: 500 });
  }
  const accessToken = allTokens[0];

  // ロケーションマッピング（アカウントIDハードコード排除）
  const locMap = await getLocationMap(accessToken);

  const shopMap = new Map(shops.map(s => [s.id, s]));
  let replied = 0;
  let errors = 0;

  // ★4以上の口コミのみ自動返信（低評価は手動対応推奨）
  const targets = unreplied.filter(r => starToNum(r.star_rating) >= 4);

  // maxDuration=300秒: 1件約10秒（Claude API + GBP API） → 最大20件/実行
  const MAX_REPLIES_PER_RUN = 20;
  for (const review of targets.slice(0, MAX_REPLIES_PER_RUN)) {
    const shop = shopMap.get(review.shop_id);
    if (!shop || !shop.gbp_location_name) continue;

    // ロケーションのフルパスを解決
    let locationName = "";
    if (shop.gbp_location_name.startsWith("accounts/")) {
      locationName = shop.gbp_location_name;
    } else {
      const mapped = locMap.get(shop.gbp_location_name) || locMap.get(shop.name);
      if (mapped) locationName = mapped.fullPath;
    }
    if (!locationName) {
      console.warn(`[cron/auto-reply] ロケーション解決失敗: ${shop.name}`);
      continue;
    }

    // AI返信文を生成
    try {
      const stars = starToNum(review.star_rating);
      const prompt = `「${shop.name}」の口コミに対する返信文を1つ生成してください。

口コミ投稿者: ${review.reviewer_name}
評価: ★${stars}
口コミ内容: ${(review.comment || "").slice(0, 300)}

条件:
- 150文字以内
- ${stars >= 4 ? "感謝の気持ちを伝える丁寧な返信" : "お詫びと改善意欲を示す返信"}
- 店舗名は含めない
- 口コミの内容に具体的に言及する
- 返信文のみ出力（余計な説明不要）`;

      const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 300, messages: [{ role: "user", content: prompt }] }),
        signal: AbortSignal.timeout(15000),
      });

      if (!aiRes.ok) { errors++; continue; }
      const aiData = await aiRes.json();
      const replyText = aiData.content?.[0]?.text?.trim();
      if (!replyText) { errors++; continue; }

      // GBPに返信投稿（全トークンを試す）
      let replySuccess = false;
      for (const token of allTokens) {
        const gbpRes = await fetch(`${GBP_API_BASE}/${locationName}/reviews/${review.review_id}/reply`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ comment: replyText }),
        });
        if (gbpRes.ok) {
          await supabase.from("reviews").update({ reply_comment: replyText }).eq("id", review.id);
          replied++;
          replySuccess = true;
          break;
        }
      }
      if (!replySuccess) errors++;
    } catch {
      errors++;
    }
  }

  console.log(`[cron/auto-reply] replied: ${replied}, errors: ${errors}, targets: ${targets.length}`);
  return NextResponse.json({
    success: true,
    replied,
    errors,
    targets: targets.length,
    skipped_low_rating: unreplied.length - targets.length,
  });
}
