/**
 * Slack Incoming Webhook への通知（server-only）
 * 環境変数 SLACK_WEBHOOK_URL が未設定なら何もしない（失敗してもメイン処理を止めない）。
 */
import type { AppRole } from "./permissions";
import { ROLE_LABELS } from "./roles";

export async function notifySlackPaidOp(params: {
  action: string;
  userName: string;
  role: AppRole;
  detail?: string;
  targetShop?: string | null;
  ip?: string;
}): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return; // 未設定時は通知しない

  const roleLabel = ROLE_LABELS[params.role] || params.role;
  const jst = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  const lines = [
    `:moneybag: *課金APIが実行されました*`,
    `• 操作: *${params.action}*`,
    `• 実行者: ${params.userName}（${roleLabel}）`,
    params.targetShop ? `• 対象店舗: ${params.targetShop}` : null,
    params.detail ? `• 詳細: ${params.detail}` : null,
    `• 日時: ${jst}`,
    params.ip ? `• IP: ${params.ip}` : null,
  ].filter(Boolean);

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: lines.join("\n") }),
    });
  } catch (e) {
    console.error("[notifySlackPaidOp] failed:", e);
  }
}
