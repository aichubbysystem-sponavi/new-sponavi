import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";

/**
 * POST /api/report/reply-suggest
 * 口コミに対するAI返信案を生成
 */
export async function POST(request: NextRequest) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  if (!ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEYが設定されていません" }, { status: 500 });
  }

  const body = await request.json();
  const { comment, starRating, shopName, reviewerName } = body as {
    comment: string;
    starRating: number;
    shopName: string;
    reviewerName?: string;
  };

  if (!comment && starRating === 0) {
    return NextResponse.json({ error: "口コミ内容が必要です" }, { status: 400 });
  }

  const tone = starRating >= 4
    ? "感謝の気持ちを伝え、またのご来店を促す温かいトーン"
    : starRating >= 3
    ? "感謝しつつ、改善への意欲を示す丁寧なトーン"
    : "真摯にお詫びし、具体的な改善策を示す誠実なトーン";

  const prompt = `あなたは「${shopName}」の店舗オーナーです。以下のGoogleの口コミに対する返信文を1つ生成してください。

【口コミ】
評価: ★${starRating}
${reviewerName ? `投稿者: ${reviewerName}` : ""}
内容: ${comment || "（テキストなし、評価のみ）"}

【トーン】${tone}

【条件】
- 150文字以内で簡潔に
- 敬語を使用
- 店名や個人情報は含めない
- 自然な日本語で
- 返信文のみを出力（説明や前置きは不要）`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      return NextResponse.json({ error: `Claude API error: ${res.status}` }, { status: 500 });
    }

    const data = await res.json();
    const reply = data.content?.[0]?.text?.trim() || "";

    return NextResponse.json({ reply });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "返信生成に失敗しました" }, { status: 500 });
  }
}
