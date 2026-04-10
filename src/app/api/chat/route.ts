import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const DIFY_BASE_URL = process.env.DIFY_BASE_URL || "";
const DIFY_API_KEY = process.env.DIFY_API_KEY || "";

/**
 * POST /api/chat
 * Dify AI社長チャットプロキシ
 */
export async function POST(request: NextRequest) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  if (!DIFY_BASE_URL || !DIFY_API_KEY) {
    return NextResponse.json({ error: "Dify APIが設定されていません。DIFY_BASE_URLとDIFY_API_KEYを設定してください。" }, { status: 500 });
  }

  const body = await request.json();
  const { query, conversationId, userId } = body as {
    query: string;
    conversationId?: string;
    userId?: string;
  };

  if (!query || !query.trim()) {
    return NextResponse.json({ error: "質問を入力してください" }, { status: 400 });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);

    const reqBody: any = {
      inputs: {},
      query: query.trim(),
      response_mode: "blocking",
      user: userId || "web-user",
    };

    if (conversationId) {
      reqBody.conversation_id = conversationId;
    }

    const res = await fetch(`${DIFY_BASE_URL}/chat-messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DIFY_API_KEY}`,
      },
      body: JSON.stringify(reqBody),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `Dify API error: ${res.status} ${errText.slice(0, 200)}` },
        { status: 500 }
      );
    }

    const data = await res.json();

    return NextResponse.json({
      answer: data.answer || "",
      conversationId: data.conversation_id || null,
    });
  } catch (err: any) {
    if (err.name === "AbortError") {
      return NextResponse.json({ error: "タイムアウトしました。もう一度お試しください。" }, { status: 504 });
    }
    return NextResponse.json({ error: err?.message || "チャットエラー" }, { status: 500 });
  }
}
