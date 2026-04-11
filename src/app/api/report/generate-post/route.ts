import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";

/**
 * POST /api/report/generate-post
 * 投稿文章をAIで自動生成
 */
export async function POST(request: NextRequest) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  if (!ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEYが設定されていません" }, { status: 500 });

  const body = await request.json();
  const { shopName, category, topicType, keywords, tone, count } = body as {
    shopName: string;
    category?: string;
    topicType: string;
    keywords?: string;
    tone?: string;
    count?: number;
  };

  if (!shopName) return NextResponse.json({ error: "shopNameが必要です" }, { status: 400 });

  const topicLabel: Record<string, string> = {
    STANDARD: "通常投稿（お店の魅力・日常の発信）",
    EVENT: "イベント投稿（期間限定・特別企画）",
    OFFER: "特典投稿（割引・クーポン・お得情報）",
    ALERT: "お知らせ投稿（営業時間変更・臨時休業等）",
  };

  // 校正モード
  if (topicType === "PROOF") {
    const proofPrompt = `以下の投稿文章の誤字脱字・文法ミス・不自然な表現を修正してください。

【原文】
${keywords}

【条件】
- 修正箇所がなければ「修正なし」とだけ出力
- 修正がある場合は修正後の全文のみを出力（説明不要）
- 意味や意図は変えない
- 自然な日本語に`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1000, messages: [{ role: "user", content: proofPrompt }] }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) return NextResponse.json({ error: `Claude API error: ${res.status}` }, { status: 500 });
      const data = await res.json();
      const result = data.content?.[0]?.text?.trim() || "修正なし";
      return NextResponse.json({ posts: [result] });
    } catch (err: any) {
      return NextResponse.json({ error: err?.message }, { status: 500 });
    }
  }

  const n = Math.min(count || 3, 5);

  const prompt = `あなたはMEO対策のプロです。「${shopName}」${category ? `（業種: ${category}）` : ""}のGoogleビジネスプロフィールに投稿する文章を${n}パターン生成してください。

【投稿タイプ】${topicLabel[topicType] || topicType}
${keywords ? `【含めたいキーワード】${keywords}` : ""}
${tone ? `【トーン】${tone}` : ""}

【条件】
- 各200〜400文字
- MEO・AIO対策を意識（キーワードを自然に含める）
- 絵文字は控えめ（1〜2個まで）
- CTA（来店促進）を末尾に入れる
- ${n}パターンはそれぞれ切り口・表現を変える
- 以下の形式で出力（番号と本文のみ）:

1.
(投稿文)

2.
(投稿文)
${n >= 3 ? "\n3.\n(投稿文)" : ""}
${n >= 4 ? "\n4.\n(投稿文)" : ""}
${n >= 5 ? "\n5.\n(投稿文)" : ""}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return NextResponse.json({ error: `Claude API error: ${res.status}` }, { status: 500 });

    const data = await res.json();
    const text = data.content?.[0]?.text?.trim() || "";

    // パース: 番号区切りで分割
    const posts: string[] = [];
    const parts = text.split(/\n\d+\.\s*\n/);
    for (const part of parts) {
      const cleaned = part.trim();
      if (cleaned && cleaned.length > 30) posts.push(cleaned);
    }

    // フォールバック: 番号付き行で分割
    if (posts.length === 0) {
      const lines = text.split(/\n(?=\d+\.)/);
      for (const line of lines) {
        const cleaned = line.replace(/^\d+\.\s*/, "").trim();
        if (cleaned && cleaned.length > 30) posts.push(cleaned);
      }
    }

    return NextResponse.json({ posts: posts.length > 0 ? posts : [text] });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "生成に失敗しました" }, { status: 500 });
  }
}
