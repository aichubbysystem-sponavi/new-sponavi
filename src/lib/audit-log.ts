import { supabase } from "./supabase";

/**
 * 操作ログを記録する（クライアント側から呼び出し）
 */
export async function logAudit(action: string, detail: string) {
  try {
    // 現在のユーザー情報を取得
    const { data: session } = await supabase.auth.getSession();
    const email = session?.session?.user?.email || "";
    const userId = session?.session?.user?.id || "";

    // user_profilesから名前を取得
    let userName = "不明";
    if (userId) {
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("name")
        .eq("id", userId)
        .maybeSingle();
      if (profile?.name) {
        userName = profile.name;
      } else {
        // プロフィールがない場合はメールアドレスから推定
        userName = email.split("@")[0] || "不明";
      }
    }

    await supabase.from("audit_logs").insert({
      id: crypto.randomUUID(),
      user_name: userName,
      action,
      detail,
    });
  } catch {
    // ログ記録失敗は無視（メイン処理をブロックしない）
  }
}
