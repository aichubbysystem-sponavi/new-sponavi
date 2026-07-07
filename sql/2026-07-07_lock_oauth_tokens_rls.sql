-- =====================================================================
-- C-1 緊急対応: system_oauth_tokens のトークン露出を塞ぐ（RLSロック）
-- =====================================================================
-- 背景:
--   公開 anon キーで /rest/v1/system_oauth_tokens が読め、
--   Google OAuth の access_token / refresh_token が漏洩し得た（アカウント乗っ取り相当）。
--
-- 方針:
--   service_role は RLS をバイパスするため、RLS を有効化して anon/authenticated 向けの
--   ポリシーを一切作らなければ「サーバー(service_role)のみ読み書き可」になる。
--   フロントの直読み（gbp-accounts/page.tsx）は /api/report/oauth-accounts 経由に移行済みで、
--   このロックによる機能影響はない（非機密フィールドのみサーバーが返す）。
--
-- 実行前チェック:
--   既存の anon 許可ポリシーが残っていると素通りするため、先に洗い出す:
--     SELECT policyname, roles, cmd, qual FROM pg_policies WHERE tablename = 'system_oauth_tokens';
-- =====================================================================

-- 既存の緩いポリシーを掃除（存在しなければ無視される）
DROP POLICY IF EXISTS "Enable read access for all users" ON system_oauth_tokens;
DROP POLICY IF EXISTS "public_read" ON system_oauth_tokens;
DROP POLICY IF EXISTS "allow_all" ON system_oauth_tokens;
DROP POLICY IF EXISTS "service_role_full_access" ON system_oauth_tokens;

-- RLS 有効化（ポリシー無し = anon/authenticated は 0 行、service_role のみ通過）
ALTER TABLE system_oauth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_oauth_tokens FORCE ROW LEVEL SECURITY;

-- 明示的に service_role のみ許可（service_role は元々バイパスするが意図を明文化）
DROP POLICY IF EXISTS "service_role_all" ON system_oauth_tokens;
CREATE POLICY "service_role_all" ON system_oauth_tokens
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =====================================================================
-- 実行後の検証（anon キーで叩いて 0 行 or 401 になることを確認）:
--   curl -s "$SUPABASE_URL/rest/v1/system_oauth_tokens?select=*" \
--        -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"
--   → [] （空配列）が返れば成功。トークンが1件でも返ってはならない。
--
-- 重要: このロックはコード上の露出を止めるだけで、
--   「既に漏れた可能性のあるトークン」は無効化しない。
--   Google Cloud Console で OAuth クライアントの再発行 / refresh_token 失効を別途実施すること。
-- =====================================================================
