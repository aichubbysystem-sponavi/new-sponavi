/**
 * 【廃止】クライアントからの操作ログ記録。
 *
 * 2026-08-02のレビューで、この経路（POST /api/report/audit-log）が
 * 「ログインできる誰でも任意のaction/detailを監査ログに書ける」偽造経路になっていたため
 * サーバー側で410を返すようにし、呼び出し側も無効化した（元々どこからも呼ばれていなかった）。
 *
 * 監査ログはサーバー側の withAudit / writeAudit（source='server'）が自動で記録する。
 * クライアント発の記録が必要になった場合は、記録できるactionを固定の許可リストにしたうえで
 * APIを作り直すこと。
 */
export async function logAudit(_action: string, _detail: string): Promise<void> {
  // no-op（互換のため関数だけ残す）
}
