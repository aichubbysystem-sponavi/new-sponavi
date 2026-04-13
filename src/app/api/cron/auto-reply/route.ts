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

async function getOAuthToken(): Promise<string | null> {
  const supabase = getSupabase();
  const { data } = await supabase.from("system_oauth_tokens")
    .select("access_token, refresh_token, expiry").limit(1).maybeSingle();
  if (!data) return null;
  if (new Date(data.expiry).getTime() - Date.now() > 5 * 60 * 1000) return data.access_token;
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: GBP_CLIENT_ID, client_secret: GBP_CLIENT_SECRET,
        refresh_token: data.refresh_token, grant_type: "refresh_token" }),
    });
    if (!res.ok) return data.access_token;
    const t = await res.json();
    await getSupabase().from("system_oauth_tokens").update({
      access_token: t.access_token,
      expiry: new Date(Date.now() + (t.expires_in || 3600) * 1000).toISOString(),
    }).not("account_id", "is", null);
    return t.access_token;
  } catch { return data.access_token; }
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
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
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

  const accessToken = await getOAuthToken();
  if (!accessToken) {
    return NextResponse.json({ error: "OAuthトークンなし" }, { status: 500 });
  }

  const shopMap = new Map(shops.map(s => [s.id, s]));
  let replied = 0;
  let errors = 0;

  // ★4以上の口コミのみ自動返信（低評価は手動対応推奨）
  const targets = unreplied.filter(r => starToNum(r.star_rating) >= 4);

  for (const review of targets.slice(0, 10)) {
    const shop = shopMap.get(review.shop_id);
    if (!shop || !shop.gbp_location_name) continue;

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

      // GBPに返信投稿
      const locationName = shop.gbp_location_name.startsWith("accounts/")
        ? shop.gbp_location_name
        : `accounts/111148362910776147900/${shop.gbp_location_name}`;

      const gbpRes = await fetch(`${GBP_API_BASE}/${locationName}/reviews/${review.review_id}/reply`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ comment: replyText }),
      });

      if (gbpRes.ok) {
        // Supabaseのreviewsテーブルも更新
        await supabase.from("reviews").update({ reply_comment: replyText }).eq("id", review.id);
        replied++;
      } else {
        errors++;
      }
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
