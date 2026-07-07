import { NextRequest, NextResponse } from "next/server";
import { getSupabase, requireRole } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * GET /api/report/oauth-accounts
 * system_oauth_tokens の「非機密フィールドのみ」を返すサーバー専用フォールバック。
 * access_token / refresh_token は絶対にクライアントへ返さない（C-1対策）。
 * gbp-accounts 画面のアカウント一覧表示専用。president/manager のみ。
 */
export async function GET(request: NextRequest) {
  const r = await requireRole(request, ["president", "manager"]);
  if (r.error) return r.error;

  try {
    const supabase = getSupabase();
    // 列名の差異に堅牢にするため * で取得し、返却時に機密フィールドを除外する。
    // access_token / refresh_token / expiry などは決してレスポンスに載せない。
    const { data, error } = await supabase
      .from("system_oauth_tokens")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[oauth-accounts] Supabase error:", error.message);
      return NextResponse.json({ error: "アカウント一覧の取得に失敗しました" }, { status: 500 });
    }

    const accounts = (data || []).map((d: Record<string, unknown>, i: number) => ({
      id: String(i),
      account_id: (d.account_id as string) || "",
      email: (d.email as string) || (d.google_email as string) || `接続済みアカウント${i + 1}`,
      type: (d.type as number) || 1,
      created_at: (d.created_at as string) || "",
    }));

    return NextResponse.json({ accounts });
  } catch (e: unknown) {
    console.error("[oauth-accounts] error:", e);
    return NextResponse.json({ error: "アカウント一覧の取得に失敗しました" }, { status: 500 });
  }
}
