import { NextRequest, NextResponse } from "next/server";
import { getSupabase, verifyCron } from "@/lib/supabase";
import { getValidTokens } from "@/lib/gbp-token";
import { getLocationMap } from "@/lib/gbp-location";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const GBP_API_BASE = "https://mybusiness.googleapis.com/v4";

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
export async function GET(_request: NextRequest) {
  // 一時無効化: 構造改善完了まで外部GBP操作を停止
  return NextResponse.json({ success: true, message: "auto-reply は一時無効化中です", replied: 0 });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function _GET_disabled(request: NextRequest) {
  const cronErr = verifyCron(request); if (cronErr) return cronErr;

  if (!ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY未設定" }, { status: 500 });
  }

  const supabase = getSupabase();

  // 自動返信設定がある店舗を取得（解約店舗を除外）
  const { data: shops } = await supabase
    .from("shops")
    .select("id, name, gbp_location_name")
    .not("gbp_location_name", "is", null)
    .is("cancelled_at", null);

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

  const allTokens = await getValidTokens();
  if (allTokens.length === 0) {
    return NextResponse.json({ error: "OAuthトークンなし" }, { status: 500 });
  }
  const accessToken = allTokens[0];

  // ロケーションマッピング（共通モジュール使用）
  const locMap = await getLocationMap();

  const shopMap = new Map(shops.map(s => [s.id, s]));
  let replied = 0;
  let errors = 0;

  // ★4以上の口コミのみ自動返信（低評価は手動対応推奨）
  const targets = unreplied.filter(r => starToNum(r.star_rating) >= 4);

  // 1件約10秒（Claude API + GBP API） → 最大20件/実行
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
        cache: "no-store" as const,
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
          cache: "no-store" as const,
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
    } catch (e: unknown) {
      console.error(`[cron/auto-reply] reply error:`, e instanceof Error ? e.message : e);
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
