/**
 * LINE Messaging API通知ユーティリティ
 * 口コミ通知、アラート、レポート配信に使用
 */

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || "";

/**
 * LINEにプッシュメッセージを送信
 */
export async function sendLinePush(to: string, messages: { type: string; text: string }[]) {
  if (!LINE_CHANNEL_ACCESS_TOKEN) return { ok: false, error: "LINE_CHANNEL_ACCESS_TOKEN未設定" };

  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ to, messages }),
  });

  return { ok: res.ok, status: res.status };
}

/**
 * 口コミ通知を送信
 */
export async function notifyNewReview(groupId: string, shopName: string, rating: number, reviewerName: string, comment: string) {
  const stars = "★".repeat(rating) + "☆".repeat(5 - rating);
  return sendLinePush(groupId, [{
    type: "text",
    text: `【新着口コミ】${shopName}\n${stars}\n${reviewerName}さん\n\n${comment.slice(0, 200)}${comment.length > 200 ? "..." : ""}\n\nhttps://new-spotlight-navigator.com/reviews`,
  }]);
}

/**
 * 緊急アラートを送信
 */
export async function notifyUrgentAlert(groupId: string, keyword: string, shopName: string, message: string) {
  return sendLinePush(groupId, [{
    type: "text",
    text: `⚠【緊急アラート】\n検知ワード: ${keyword}\n店舗: ${shopName}\n\n${message.slice(0, 300)}\n\nhttps://new-spotlight-navigator.com`,
  }]);
}

/**
 * レポート配信通知を送信
 */
export async function notifyReportReady(groupId: string, shopName: string, reportUrl: string) {
  return sendLinePush(groupId, [{
    type: "text",
    text: `【月次レポート】${shopName}\n\n最新のMEOレポートが準備できました。\n\n${reportUrl}`,
  }]);
}
