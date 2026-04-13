import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export const dynamic = "force-dynamic";

const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || "";
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || "";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_KEY);
}

// LINE署名検証
function verifySignature(body: string, signature: string): boolean {
  if (!LINE_CHANNEL_SECRET) return false;
  const hmac = crypto.createHmac("SHA256", LINE_CHANNEL_SECRET);
  hmac.update(body);
  const digest = hmac.digest("base64");
  return digest === signature;
}

// LINE返信API
async function replyMessage(replyToken: string, messages: { type: string; text: string }[]) {
  if (!LINE_CHANNEL_ACCESS_TOKEN) return;
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  });
}

// 重要キーワード検知
const URGENT_KEYWORDS = ["クレーム", "解約", "怒り", "怒って", "最悪", "詐欺", "訴え", "弁護士", "消費者センター", "炎上"];
const CHANGE_KEYWORDS = ["店名変更", "営業時間変更", "住所変更", "電話番号変更", "休業", "臨時休業", "閉店", "メニュー変更", "定休日変更"];

/**
 * POST /api/webhook/line
 * LINE Messaging API Webhook
 * - グループのメッセージをROM監視
 * - 重要キーワード検知→アラート
 * - 変更指示の自動タスク化
 */
export async function POST(request: NextRequest) {
  const bodyText = await request.text();
  const signature = request.headers.get("x-line-signature") || "";

  // 署名検証
  if (LINE_CHANNEL_SECRET && !verifySignature(bodyText, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  let body: any;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const supabase = getSupabase();
  const events = body.events || [];

  for (const event of events) {
    if (event.type !== "message" || event.message?.type !== "text") continue;

    const text = event.message.text || "";
    const sourceType = event.source?.type; // "user", "group", "room"
    const groupId = event.source?.groupId || event.source?.roomId || "";
    const userId = event.source?.userId || "";

    // メッセージをDBに記録（ROM監視ログ）
    await supabase.from("line_messages").insert({
      id: crypto.randomUUID(),
      group_id: groupId,
      user_id: userId,
      message: text.slice(0, 2000),
      source_type: sourceType,
      event_type: event.type,
      created_at: new Date().toISOString(),
    });

    // 1. 重要キーワード検知→緊急アラート
    const urgentMatch = URGENT_KEYWORDS.find(kw => text.includes(kw));
    if (urgentMatch) {
      await supabase.from("line_alerts").insert({
        id: crypto.randomUUID(),
        group_id: groupId,
        user_id: userId,
        keyword: urgentMatch,
        message: text.slice(0, 500),
        alert_type: "urgent",
        resolved: false,
        created_at: new Date().toISOString(),
      });

      console.log(`[LINE URGENT] keyword="${urgentMatch}" group=${groupId}`);
    }

    // 2. 変更指示の自動タスク化
    const changeMatch = CHANGE_KEYWORDS.find(kw => text.includes(kw));
    if (changeMatch) {
      await supabase.from("line_alerts").insert({
        id: crypto.randomUUID(),
        group_id: groupId,
        user_id: userId,
        keyword: changeMatch,
        message: text.slice(0, 500),
        alert_type: "change_request",
        resolved: false,
        created_at: new Date().toISOString(),
      });

      // 変更指示にはbotから確認返信
      if (event.replyToken) {
        await replyMessage(event.replyToken, [{
          type: "text",
          text: `「${changeMatch}」を検知しました。担当者に自動通知済みです。対応完了までしばらくお待ちください。`,
        }]);
      }
    }

    // 3. ダイレクトメッセージへの自動応答（グループではROM）
    if (sourceType === "user" && event.replyToken) {
      // 個人チャットの場合のみ応答
      if (text.includes("ステータス") || text.includes("状況")) {
        // 店舗状況サマリーを返信
        const { count: totalShops } = await supabase.from("shops").select("id", { count: "exact", head: true });
        const { count: unreplied } = await supabase.from("reviews").select("id", { count: "exact", head: true }).is("reply_comment", null);

        await replyMessage(event.replyToken, [{
          type: "text",
          text: `【SPOTLIGHT NAVIGATOR】\n管理店舗数: ${totalShops || 0}店舗\n未返信口コミ: ${unreplied || 0}件\n\nダッシュボード:\nhttps://new-spotlight-navigator.com`,
        }]);
      } else {
        await replyMessage(event.replyToken, [{
          type: "text",
          text: "SPOTLIGHT NAVIGATORです。\n「ステータス」と送信すると現在の状況を確認できます。\n\n詳細はダッシュボードをご確認ください:\nhttps://new-spotlight-navigator.com",
        }]);
      }
    }
  }

  return NextResponse.json({ ok: true });
}
