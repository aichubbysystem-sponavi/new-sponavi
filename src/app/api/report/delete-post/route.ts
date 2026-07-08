import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { withAudit } from "@/lib/audit";
import { getOAuthToken } from "@/lib/gbp-token";
import { isValidGbpPostName } from "@/lib/gbp-validate";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const GBP_API_BASE = "https://mybusiness.googleapis.com/v4";
const GO_API_URL = process.env.NEXT_PUBLIC_API_URL || "";


/**
 * POST /api/report/delete-post
 * GBP投稿を削除 + post_logsからも削除
 */
export const POST = withAudit("GBP投稿削除", "EXTERNAL_OP", async (request, ctx) => {
  const { postName, logId } = await request.json();
  if (!postName) return NextResponse.json({ error: "postNameが必要です" }, { status: 400 });
  // 無検証で DELETE URL に連結するとパストラバーサル・クエリ混入で他リソースを操作され得る
  if (!isValidGbpPostName(postName)) {
    return NextResponse.json({ error: "postNameの形式が不正です" }, { status: 400 });
  }

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

  ctx.detail = `${postName}${logId ? `（logId: ${logId}）` : ""} / GBP削除${gbpDeleted ? "成功" : "未実施・失敗"}`;
  return NextResponse.json({ success: true, gbpDeleted });
});
