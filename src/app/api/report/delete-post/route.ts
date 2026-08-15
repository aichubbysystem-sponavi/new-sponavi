import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { withAudit } from "@/lib/audit";
import { getOAuthToken, getAllOAuthTokens } from "@/lib/gbp-token";
import { isValidGbpDeletableName } from "@/lib/gbp-validate";

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
  // 写真投稿は /media/、通常投稿は /localPosts/ のどちらかしか受け付けない
  if (!isValidGbpDeletableName(postName)) {
    return NextResponse.json({ error: "postNameの形式が不正です" }, { status: 400 });
  }

  const supabase = getSupabase();

  // Go APIからトークン取得
  const accessToken = await getOAuthToken();

  let gbpDeleted = false;
  let gbpError = "";

  if (accessToken) {
    // postName解決: locations/... 形式なら accounts/... 付きのフルパスに直す
    let name = postName;
    if (!postName.startsWith("accounts/")) {
      const { resolveLocationName } = await import("@/lib/gbp-location");
      const sep = postName.includes("/localPosts/") ? "/localPosts/" : "/media/";
      const [locPart, idPart] = postName.split(sep);
      const resolved = await resolveLocationName(locPart || "");
      name = resolved && idPart ? `${resolved}${sep}${idPart}` : postName;
    }

    // GBPアカウントは複数あり1本のトークンでは全ロケーションが見えない。
    // 404は「既に削除済み」と「このトークンからは見えない」の区別がつかないため、
    // 他のトークンでも試してから判断する（2026-08-15）
    const tryDelete = async (token: string) => fetch(`${GBP_API_BASE}/${name}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });

    try {
      let res = await tryDelete(accessToken);
      if (!res.ok && [401, 403, 404].includes(res.status)) {
        const others = (await getAllOAuthTokens().catch(() => [] as string[]))
          .filter(t => t && t !== accessToken);
        for (const token of others) {
          const retry = await tryDelete(token);
          if (retry.ok) { res = retry; break; }
          if (![401, 403, 404].includes(retry.status)) { res = retry; break; }
        }
      }
      if (res.ok || res.status === 404) {
        // 全トークンで404 = GBP上に無い（既に削除済み）→ 成功扱い
        gbpDeleted = true;
      } else {
        const err = await res.text().catch(() => "");
        gbpError = `${res.status}: ${err.slice(0, 150)}`;
        // GBP削除失敗でもDB側は削除する
        console.error(`[delete-post] GBP削除失敗 ${gbpError}`);
      }
    } catch (e: any) {
      gbpError = e?.message || "不明なエラー";
      console.error(`[delete-post] GBP削除エラー: ${gbpError}`);
    }
  } else {
    gbpError = "OAuthトークンを取得できませんでした";
  }

  // DB側のpost_logsを削除（GBP削除の成否にかかわらず）
  if (logId) {
    await supabase.from("post_logs").delete().eq("id", logId);
  } else if (postName) {
    await supabase.from("post_logs").delete().eq("gbp_post_name", postName);
  }

  ctx.detail = `${postName}${logId ? `（logId: ${logId}）` : ""} / GBP削除${gbpDeleted ? "成功" : `失敗(${gbpError})`}`;
  // GBPから消せていないのに success:true だけ返すと、画面には「削除しました」と出て
  // 実際はGBPに残る。呼び出し側が判別できるよう理由も返す
  return NextResponse.json({ success: true, gbpDeleted, gbpError: gbpError || undefined });
});
