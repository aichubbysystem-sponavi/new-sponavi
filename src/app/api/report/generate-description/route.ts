import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";

/**
 * POST /api/report/generate-description
 * GBP説明文/カテゴリ提案をAIで生成
 */
export async function POST(request: NextRequest) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  if (!ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEYが設定されていません" }, { status: 500 });

  const body = await request.json();
  const { mode, shopName, category, keywords, currentDescription, address } = body;

  let prompt = "";

  if (mode === "description") {
    prompt = `あなたはMEO対策のプロです。「${shopName}」${category ? `（業種: ${category}）` : ""}のGoogleビジネスプロフィールの「ビジネスの説明」文を3パターン生成してください。

${address ? `【所在地】${address}` : ""}
${keywords ? `【対策キーワード】${keywords}` : ""}
${currentDescription ? `【現在の説明文】${currentDescription}` : ""}

【条件】
- 各750〜1000文字（Googleの推奨文字数）
- MEO対策キーワードを自然に含める
- AIO/LLMO対策を意識（AI検索で引用されやすい具体的な情報）
- 店舗の特徴・強みを明確に
- 地域名を自然に含める
- 絵文字は使わない
- 以下の形式で出力:

1.
(説明文)

2.
(説明文)

3.
(説明文)`;
  } else if (mode === "category") {
    prompt = `あなたはMEO対策のプロです。「${shopName}」${category ? `（現在のメインカテゴリ: ${category}）` : ""}に最適なGoogleビジネスプロフィールのカテゴリを提案してください。

${address ? `【所在地】${address}` : ""}

【条件】
- メインカテゴリ1つ + 追加カテゴリ3〜5つを提案
- Googleビジネスプロフィールで実際に選択可能なカテゴリ名を使用
- 各カテゴリに選定理由を1行で記載
- 以下の形式で出力:

メイン: (カテゴリ名) — (理由)
追加1: (カテゴリ名) — (理由)
追加2: (カテゴリ名) — (理由)
追加3: (カテゴリ名) — (理由)
追加4: (カテゴリ名) — (理由)`;
  } else {
    return NextResponse.json({ error: "mode must be 'description' or 'category'" }, { status: 400 });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 3000,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return NextResponse.json({ error: `Claude API error: ${res.status}` }, { status: 500 });

    const data = await res.json();
    const text = data.content?.[0]?.text?.trim() || "";

    return NextResponse.json({ result: text });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "生成に失敗しました" }, { status: 500 });
  }
}
