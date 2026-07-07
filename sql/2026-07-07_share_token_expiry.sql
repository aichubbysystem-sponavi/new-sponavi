-- =====================================================================
-- P-MAX共有トークンに有効期限・失効機構を追加  2026-07-07
-- =====================================================================
-- 背景（監査②の指摘）:
--   共有URLのトークンは推測不可能(UUID)だが、有効期限も失効手段も無く、
--   一度発行したURLは恒久的に有効だった（解約クライアントのURLも生き続ける）。
--
-- 対応:
--   * expires_at … 発行/再発行時に now + 365日 をアプリ側でセット（自動失効）。
--   * revoked_at … 「共有を停止」操作で now をセット（漏洩・解約時の即時失効）。
--   既存トークンは expires_at=NULL のまま = 無期限として扱い、現行の共有URLは壊さない。
--   検証は各 /api/pmax/share・group-share ルートで isShareActive() が行う。
-- =====================================================================

ALTER TABLE pmax_share_tokens ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE pmax_share_tokens ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

ALTER TABLE pmax_group_shares ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE pmax_group_shares ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

-- 有効なトークンの絞り込み用（任意・パフォーマンス目的）
CREATE INDEX IF NOT EXISTS idx_pmax_share_active
  ON pmax_share_tokens(shop_name, year, month) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pmax_group_active
  ON pmax_group_shares(group_name) WHERE revoked_at IS NULL;

-- 参考: 既存トークンにも期限を付けたい場合（任意・既存URLが1年で切れる点に注意）:
--   UPDATE pmax_share_tokens SET expires_at = created_at + INTERVAL '365 days' WHERE expires_at IS NULL;
--   UPDATE pmax_group_shares SET expires_at = created_at + INTERVAL '365 days' WHERE expires_at IS NULL;
