import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
}

/**
 * POST /api/report/survey
 * アンケート回答からAI口コミ文を生成
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { shopId, shopName, rating, answers } = body as {
    shopId: string;
    shopName: string;
    rating: number;
    answers: { question: string; answer: string }[];
  };

  if (!shopId || !rating || !answers) {
    return NextResponse.json({ error: "必須項目が不足しています" }, { status: 400 });
  }

  // AI口コミ文生成
  let reviewText = "";
  if (ANTHROPIC_API_KEY && answers.length > 0) {
    const answersText = answers.map((a) => `${a.question}: ${a.answer}`).join("\n");
    const prompt = `以下のアンケート回答をもとに、「${shopName}」のGoogle口コミとして投稿できる自然な文章を1つ生成してください。

【評価】★${rating}
【アンケート回答】
${answersText}

【条件】
- 100〜200文字
- 実際のお客様が書いたような自然な口コミ文
- アンケートの回答内容を自然に盛り込む
- ★${rating}の評価に合ったトーン
- 口コミ文のみを出力（説明不要）`;

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 500, messages: [{ role: "user", content: prompt }] }),
      });
      if (res.ok) {
        const data = await res.json();
        reviewText = data.content?.[0]?.text?.trim() || "";
      }
    } catch {}
  }

  const supabase = getSupabase();

  // ★3以下は自社DBに保存
  if (rating <= 3) {
    await supabase.from("survey_responses").insert({
      shop_id: shopId,
      shop_name: shopName,
      rating,
      answers,
      generated_review: reviewText,
      redirected_to_google: false,
    });
    return NextResponse.json({
      action: "internal",
      reviewText,
      message: "ご回答ありがとうございました。貴重なご意見として改善に活用させていただきます。",
    });
  }

  // ★4以上はGoogle Mapsへリダイレクト
  // place_idからGoogleマップ口コミURLを生成
  const { data: shop } = await supabase
    .from("shops")
    .select("gbp_place_id, gbp_location_name")
    .eq("id", shopId)
    .maybeSingle();

  // Google口コミURLを構築
  let googleReviewUrl = `https://search.google.com/local/writereview?placeid=${shop?.gbp_place_id || ""}`;
  if (!shop?.gbp_place_id) {
    // place_idがない場合は店舗名で検索URLにフォールバック
    googleReviewUrl = `https://www.google.com/maps/search/${encodeURIComponent(shopName)}`;
  }

  // 記録も保存
  await supabase.from("survey_responses").insert({
    shop_id: shopId,
    shop_name: shopName,
    rating,
    answers,
    generated_review: reviewText,
    redirected_to_google: true,
  });

  return NextResponse.json({
    action: "google",
    reviewText,
    googleReviewUrl,
    message: "ありがとうございます！Googleマップに口コミを投稿いただけると嬉しいです。",
  });
}
