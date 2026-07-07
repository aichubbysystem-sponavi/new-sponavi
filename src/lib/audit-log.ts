import api from "./api";

/**
 * 操作ログを記録する（クライアント側から呼び出し）。
 * 実際の書き込みはサーバー(/api/report/audit-log)で行い、user_name は検証済みJWTから
 * サーバー側が解決する。クライアントからは action/detail のみ送る（偽造・匿名注入の防止）。
 */
export async function logAudit(action: string, detail: string) {
  try {
    await api.post("/api/report/audit-log", { action, detail });
  } catch {
    // ログ記録失敗は無視（メイン処理をブロックしない）
  }
}
