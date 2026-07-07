-- =====================================================================
-- Group C: 未使用テーブルのRLS有効化（anon 遮断）  2026-07-07
-- =====================================================================
-- 判断根拠（pg_stat_user_tables 実測）:
--   本アプリのコードが参照しない rowsecurity=false の23テーブルのうち、
--   22テーブルが「行数0・INSERT/UPDATE/DELETE すべて0」＝一度も使われていない死んだテーブル。
--   （admins / facebook_accounts / users / agents / owner_user 等。別SaaSの名残と思われる）
--   → anon にフル権限が付いたまま放置されていたため、将来の悪用に備えてRLSで遮断する。
--
--   除外: ranking_search_settings のみ 行1・更新5回で「何かが使用中」。
--         使用元(anon書き込みの可能性)が不明なため、このSQLでは触らない（別途調査）。
--
-- 方針: RLS有効化 + authenticated に SELECT のみ（Group A と同一）。
--   空テーブルなので authenticated が読んでも0件。anon は全遮断。
--   万一 grep が拾えない動的参照があっても authenticated read は通り、壊れにくい。
--   書き込みは（もし将来使うなら）service_role のサーバー経由に統一すること。
-- =====================================================================

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'admin_setting','admins','agent_setting','agent_user','agents',
    'batch_control','batch_log','facebook_accounts','gbp_categories','groups',
    'owner_setting','owner_user','performance_logs','post_files','post_resavations',
    'review_reply_settings','setting_msts','shop_group','shop_setting','shop_user',
    'user_setting','users'
    -- ranking_search_settings は使用中のため意図的に除外
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
      -- 既存ポリシー（あれば）を一掃してから authenticated SELECT を付与
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', 'sel_authenticated_'||t, t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true);',
        'sel_authenticated_'||t, t);
      RAISE NOTICE 'Group C: RLS+SELECT(authenticated) on %', t;
    ELSE
      RAISE NOTICE 'Group C skip (not found): %', t;
    END IF;
  END LOOP;
END $$;

-- =====================================================================
-- 検証:
--   SET ROLE anon;
--   SELECT count(*) FROM public.admins;           -- 期待: permission denied
--   SELECT count(*) FROM public.facebook_accounts; -- 期待: permission denied
--   RESET ROLE;
--
-- 残課題: ranking_search_settings の使用元を特定する（誰がanonで書いているか）。
--   本アプリのコードには参照なし（grep 0件）。Go API か手動処理の可能性。
--   使用元がservice_role経由と確認できたら、同様にRLS+authenticated SELECTでロックする。
-- =====================================================================
