/**
 * P-MAX共有トークンの有効期限・失効判定。
 * pmax_share_tokens / pmax_group_shares で共通利用する純粋ロジック。
 *
 * 方針:
 *  - 発行/再発行時に expires_at = now + SHARE_TTL_DAYS を付与（自動失効）。
 *  - 手動失効は revoked_at をセット（漏洩・解約クライアント対応）。
 *  - 既存トークン（expires_at=NULL）は無期限として扱い、既存URLを壊さない（grandfather）。
 */

export const SHARE_TTL_DAYS = 365;

export interface ShareLifecycle {
  expires_at?: string | null;
  revoked_at?: string | null;
}

/** 発行時に付与する有効期限（ISO文字列）。now はテスト注入用（省略時は現在時刻）。 */
export function shareExpiryISO(now: number = Date.now()): string {
  return new Date(now + SHARE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * トークンが現在有効か。
 *  - revoked_at があれば無効（手動失効）
 *  - expires_at があり、かつ過去なら無効（期限切れ）
 *  - expires_at が無ければ無期限（既存トークン）とみなし有効
 */
export function isShareActive(row: ShareLifecycle | null | undefined, now: number = Date.now()): boolean {
  if (!row) return false;
  if (row.revoked_at) return false;
  if (row.expires_at && new Date(row.expires_at).getTime() < now) return false;
  return true;
}
