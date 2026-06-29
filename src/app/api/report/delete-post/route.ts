import { NextRequest, NextResponse } from "next/server";
import { getSupabase, verifyAuth, verifyShopAccess } from "@/lib/supabase";
import { getOAuthToken } from "@/lib/gbp-token";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const GBP_API_BASE = "https://mybusiness.googleapis.com/v4";
const GO_API_URL = process.env.NEXT_PUBLIC_API_URL || "";


/**
 * POST /api/report/delete-post
 * GBP投稿を削除 + post_logsからも削除
 */
export async function POST(_request: NextRequest) {
  // 一時無効化: 構造改善完了まで外部GBP操作を停止
  return NextResponse.json({ error: "投稿削除機能は一時停止中です" }, { status: 503 });
}

async function _POST_disabled(request: NextRequest) {
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid || !auth.sub) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const { postName, logId } = await request.json();
  if (!postName) return NextResponse.json({ error: "postNameが必要です" }, { status: 400 });

  const supabase = getSupabase();

  // 認可チェック: post_logsからshop_nameを取得して店舗アクセス権を検証
  let shopName: string | null = null;
  if (logId) {
    const { data: log } = await supabase.from("post_logs").select("shop_name").eq("id", logId).maybeSingle();
    shopName = log?.shop_name || null;
  }
  if (!shopName && postName) {
    const { data: log } = await supabase.from("post_logs").select("shop_name").eq("gbp_post_name", postName).maybeSingle();
    shopName = log?.shop_name || null;
  }
  if (shopName) {
    const hasAccess = await verifyShopAccess(auth.sub, shopName);
    if (!hasAccess) return NextResponse.json({ error: "この店舗へのアクセス権がありません" }, { status: 403 });
  }

  // Go APIからトークン取得
  const accessToken = await getOAuthToken();

  let gbpDeleted = false;

  if (accessToken) {
    // postName解決
    let name = postName;
    if (!postName.startsWith("accounts/")) {
      const { resolveLocationName } = await import("@/lib/gbp-location");
      const locPart = postName.split("/localPosts/")[0] || "";
      const postPart = postName.includes("/localPosts/") ? "/localPosts/" + postName.split("/localPosts/")[1] : "";
      const resolved = await resolveLocationName(locPart);
      name = resolved ? `${resolved}${postPart}` : postName;
    }

    try {
      const res = await fetch(`${GBP_API_BASE}/${name}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok || res.status === 404) {
        // 404 = GBP上で既に削除済み → 成功扱い
        gbpDeleted = true;
      } else {
        const err = await res.text().catch(() => "");
        // GBP削除失敗でもDB側は削除する
        console.error(`[delete-post] GBP削除失敗 ${res.status}: ${err.slice(0, 100)}`);
      }
    } catch (e: any) {
      console.error(`[delete-post] GBP削除エラー: ${e?.message}`);
    }
  }

  // DB側のpost_logsを削除（GBP削除の成否にかかわらず）
  if (logId) {
    await supabase.from("post_logs").delete().eq("id", logId);
  } else if (postName) {
    await supabase.from("post_logs").delete().eq("gbp_post_name", postName);
  }

  return NextResponse.json({ success: true, gbpDeleted });
}
