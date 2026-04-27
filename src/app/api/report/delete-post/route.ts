import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getOAuthToken } from "@/lib/gbp-token";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const GBP_API_BASE = "https://mybusiness.googleapis.com/v4";
const GO_API_URL = process.env.NEXT_PUBLIC_API_URL || "";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
}

/**
 * POST /api/report/delete-post
 * GBP投稿を削除 + post_logsからも削除
 */
export async function POST(request: NextRequest) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const { postName, logId } = await request.json();
  if (!postName) return NextResponse.json({ error: "postNameが必要です" }, { status: 400 });

  const supabase = getSupabase();

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
