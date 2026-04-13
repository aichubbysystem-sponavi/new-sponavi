import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";

/**
 * POST /api/report/send-report
 * レポートをメールで送信（Resend API）
 */
export async function POST(request: NextRequest) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const body = await request.json();
  const { to, shopName, reportUrl, subject } = body as {
    to: string;
    shopName: string;
    reportUrl: string;
    subject?: string;
  };

  if (!to || !shopName) {
    return NextResponse.json({ error: "宛先とショップ名が必要です" }, { status: 400 });
  }

  if (!RESEND_API_KEY) {
    return NextResponse.json({
      error: "メール送信が設定されていません（RESEND_API_KEY未設定）",
      hint: "Vercel環境変数にRESEND_API_KEYを追加してください",
    }, { status: 501 });
  }

  const emailSubject = subject || `【MEOレポート】${shopName} — ${new Date().toLocaleDateString("ja-JP")}`;
  const html = `
    <div style="font-family: 'Segoe UI', 'Hiragino Sans', sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #003D6B, #0f3460); color: white; padding: 24px; border-radius: 12px 12px 0 0;">
        <h1 style="font-size: 20px; margin: 0;">SPOTLIGHT NAVIGATOR</h1>
        <p style="font-size: 12px; opacity: 0.7; margin: 4px 0 0;">MEOレポート自動配信</p>
      </div>
      <div style="background: white; padding: 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
        <h2 style="font-size: 16px; color: #1e293b; margin: 0 0 12px;">${shopName} のMEOレポート</h2>
        <p style="font-size: 14px; color: #64748b; line-height: 1.6;">
          ${new Date().toLocaleDateString("ja-JP")}時点のMEOパフォーマンスレポートをお届けします。
        </p>
        <a href="${reportUrl}" style="display: inline-block; background: #003D6B; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 16px 0;">
          レポートを確認する
        </a>
        <p style="font-size: 11px; color: #94a3b8; margin-top: 24px;">
          このメールは SPOTLIGHT NAVIGATOR から自動送信されています。<br>
          株式会社Chubby — MEO Management Platform
        </p>
      </div>
    </div>
  `;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: "SPOTLIGHT NAVIGATOR <noreply@new-spotlight-navigator.com>",
        to: [to],
        subject: emailSubject,
        html,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: `メール送信失敗: ${err}` }, { status: 500 });
    }

    const data = await res.json();
    return NextResponse.json({ success: true, messageId: data.id });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
