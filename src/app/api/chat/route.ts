import { NextResponse } from "next/server";
import { withAudit } from "@/lib/audit";
import { featureDetails } from "@/lib/feature-details";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
// 対話型ヘルプ用途なので高速・低コストのHaikuを既定に（既存のAI機能と同じ実績あるモデルID）。
// より高品質にしたい場合は環境変数 CHAT_MODEL で claude-sonnet-5 等に変更可能
const CHAT_MODEL = process.env.CHAT_MODEL || "claude-haiku-4-5-20251001";

// 実装済み機能一覧を使い方ナレッジとして注入（モジュール読み込み時に一度だけ生成）
const FEATURE_KNOWLEDGE = featureDetails
  .filter((f) => f.status === "active" || f.status === "beta")
  .map((f) => `- [${f.category}] ${f.title}：${f.description}`)
  .join("\n");

const NAVIGATION_GUIDE = `【画面の場所（左サイドバー）】
- ダッシュボード：KPIサマリー・未完了タスク・解約予兆スコア
- 店舗診断：店舗のMEO状態を診断
- 口コミ管理：口コミの返信・未返信対応
- 口コミ分析(AI)：AIによる口コミ内容分析・総評
- レポートページ：店舗別のMEOレポート閲覧・出力
- P-MAX広告：Google広告(P-MAX)の実績確認
- 投稿管理・分析：GBP投稿の作成・予約投稿・分析
- AIO対策：AI検索(AIO/LLMO)向けの最適化
- 店舗情報管理 → 店舗一覧／検索語句管理／多地点順位チェック／店舗パフォーマンス／基礎情報管理／差し込み文字列設定／初期整備／NAP整合性
- 多媒体連携 → 写真管理
- システム管理 → ユーザー・権限管理／グループ管理／GBPアカウント管理`;

const SYSTEM_PROMPT = `あなたは「SPOTLIGHT NAVIGATOR」というMEO対策の社内SaaSに組み込まれたAIアシスタント「AI社長」です。株式会社ChubbyのMEO・広告事業の社員（社長・社員）が使います。

【あなたの役割】
- このシステム（SPOTLIGHT NAVIGATOR）の使い方を、社員に分かりやすく案内する
- MEO対策・Googleビジネスプロフィール(GBP)・口コミ運用・店舗集客に関する実務的な質問に答える
- どの画面でその操作ができるかを具体的に案内する

【回答スタイル】
- 丁寧かつ簡潔。結論を先に述べ、必要なら手順を箇条書きで補足する
- 専門用語は噛み砕いて説明する
- 「使い方」を聞かれたら、まずどの画面でできるかを案内する
- 分からないこと・システムに無い機能を、推測で「できます」と断言しない。不確かなら「担当者に確認してください」と案内する
- 個人情報や社外秘の具体的な数値の生成・推測はしない

${NAVIGATION_GUIDE}

【このシステムでできること（機能一覧）】
${FEATURE_KNOWLEDGE}`;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * POST /api/chat
 * AI社長チャット（Claude API直結。以前はDify連携だったが、VPS障害を避けるためClaude APIへ移行）
 */
export const POST = withAudit("AIチャット実行", "PAID_OP", async (request, ctx) => {
  if (!ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEYが設定されていません" }, { status: 500 });
  }

  const body = await request.json();
  const { query, history } = body as {
    query: string;
    history?: ChatMessage[];
  };

  if (!query || !query.trim()) {
    return NextResponse.json({ error: "質問を入力してください" }, { status: 400 });
  }

  ctx.detail = `質問: ${query.trim().slice(0, 100)}`;

  // 会話履歴を組み立て（直近10往復まで。role/contentのみ採用し、user始まり・交互を担保）
  const past: ChatMessage[] = Array.isArray(history)
    ? history
        .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
        .slice(-20)
        .map((m) => ({ role: m.role, content: m.content }))
    : [];

  const messages: ChatMessage[] = [...past, { role: "user", content: query.trim() }];
  // Claude APIはuser始まり必須。先頭がassistantなら落とす
  while (messages.length > 0 && messages[0].role !== "user") messages.shift();

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      cache: "no-store" as const,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CHAT_MODEL,
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages,
      }),
      signal: AbortSignal.timeout(90000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("[chat] Anthropic API error:", res.status, errText.slice(0, 300));
      return NextResponse.json(
        { error: `AI応答エラー (${res.status})。しばらくしてからお試しください。` },
        { status: 502 }
      );
    }

    const data = await res.json();
    const answer = Array.isArray(data.content)
      ? data.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim()
      : "";

    return NextResponse.json({ answer: answer || "回答を生成できませんでした。もう一度お試しください。", conversationId: null });
  } catch (err: any) {
    if (err?.name === "AbortError" || err?.name === "TimeoutError") {
      return NextResponse.json({ error: "タイムアウトしました。もう一度お試しください。" }, { status: 504 });
    }
    console.error("[chat] error:", err?.message);
    return NextResponse.json({ error: err?.message || "チャットエラー" }, { status: 500 });
  }
});
