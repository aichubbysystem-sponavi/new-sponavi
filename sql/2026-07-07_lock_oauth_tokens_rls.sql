-- =====================================================================
-- C-1 緊急対応: system_oauth_tokens のトークン露出を塞ぐ
-- =====================================================================
-- 背景:
--   公開 anon キーで /rest/v1/system_oauth_tokens が読め、
--   Google OAuth の access_token / refresh_token が漏洩し得た（アカウント乗っ取り相当）。
--
-- 重要: system_oauth_tokens は「テーブルではなく VIEW」だった。
--   定義: SELECT t.access_token, t.refresh_token, t.expiry
--         FROM system.tokens t JOIN system.accounts a ON a.id = t.account_id
--         WHERE a.type = 1 AND a.deleted_at IS NULL AND t.deleted_at IS NULL LIMIT 1;
--   → RLS はビューには張れない（ERROR 42809）。ビューは既定でオーナー権限で動くため、
--     大元テーブル(system.*)のRLSも素通りする。対策は「ビューへのSELECT権限をanon/authenticatedから剥奪」。
--
--   大元テーブルは system スキーマにあり、PostgREST は public スキーマのみ公開するため
--   anon から system.tokens へ直接到達する経路は無い（露出はこの public ビュー経由のみ）。
--
-- アプリ影響: 無し。
--   サーバー側のトークン取得(gbp-token.ts 等)は全て getSupabase()=service_role を使うため、
--   anon/authenticated からの REVOKE では権限を失わない。
-- =====================================================================

-- 公開ロールからビューのSELECT権限を剥奪（これが露出を止める本体）
REVOKE ALL ON public.system_oauth_tokens FROM anon;
REVOKE ALL ON public.system_oauth_tokens FROM authenticated;

-- 念のため大元テーブルも公開ロールから遮断（多層防御。systemスキーマは元々未公開だが将来の誤公開に備える）
REVOKE ALL ON system.tokens FROM anon, authenticated;
REVOKE ALL ON system.accounts FROM anon, authenticated;
REVOKE USAGE ON SCHEMA system FROM anon, authenticated;

-- =====================================================================
-- 検証（Supabase SQL Editor で anon ロールになりきって確認）:
--   SET ROLE anon;
--   SELECT count(*) FROM public.system_oauth_tokens;  -- 期待: permission denied
--   RESET ROLE;
--
-- 重要: このロックはコード上の露出を止めるだけで、
--   「既に漏れた可能性のあるトークン」は無効化しない。
--   Google Cloud Console で OAuth クライアントの再発行 / refresh_token 失効を別途実施すること。
-- =====================================================================
