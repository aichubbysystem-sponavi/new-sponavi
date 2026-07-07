-- =====================================================================
-- 本番RLS一括有効化（anon 全遮断）  2026-07-07 セキュリティ監査フォローアップ
-- =====================================================================
-- 実測で判明した事実（本番Supabaseの grants/RLS を確認）:
--   * public の全テーブルで anon / authenticated に
--     SELECT/INSERT/UPDATE/DELETE/TRUNCATE のフル権限が付与されている（Supabase既定）。
--   * よって「RLSが唯一の防御」であり、rowsecurity=false のテーブルは
--     未ログインの anon から読み書き・全削除が可能な状態だった。
--
-- 方針:
--   * このアプリのDBアクセスは2経路のみ:
--       - クライアント(anonキー) … ただし常にログイン後 = authenticated ロールで動く（読み取り）
--       - サーバー(service_role) … RLSをBYPASSする（全書き込み・cron・集計）
--   * したがって各対象テーブルは「authenticated に SELECT のみ許可、anon は全遮断」で
--     アプリを壊さずに穴を塞げる。書き込みは service_role 経由に一本化済み（コミット dbc03a3）。
--   * 事前に匿名read（公開アンケート等）は service_role 化済み（コミット edb7d71）。
--
-- 対象の選定（本番の rowsecurity=false かつ本アプリのコードが参照するテーブル）:
--   grep でコード参照を確認し、参照ありのものだけを対象にした（未使用/別システム табл は Group C で別管理）。
-- =====================================================================

-- ---------------------------------------------------------------------
-- Group A: アプリが読むテーブル → RLS有効化 + authenticated に SELECT のみ許可
-- ---------------------------------------------------------------------
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'shops',                    -- クライアント多数read（shop-provider等）
    'scheduled_posts',          -- 予約投稿。read=client / write=server済
    'post_logs',                -- 投稿履歴。read=client / write=server
    'audit_logs',               -- 監査ログ。read=user-management / write=server済
    'owners',                   -- オーナー情報(PII)。read=gbp-accounts
    'user_profiles',            -- ★権限(role)・氏名。read=role-provider / 権限判定=service_role
    'user_shop_access',         -- ★店舗割当。判定=service_role
    'nap_check_results',        -- NAPチェック結果
    'grid_ranking_presets',     -- グリッド計測プリセット
    'report_display_settings',  -- レポート表示設定
    'report_data_cache',        -- レポートキャッシュ（主にserver）
    'report_shop_list',         -- 店舗一覧キャッシュ（主にserver）
    'business_groups',          -- 店舗グループ
    'settings'                  -- 各種設定
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', 'sel_authenticated_'||t, t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true);',
        'sel_authenticated_'||t, t);
      RAISE NOTICE 'Group A: RLS+SELECT(authenticated) on %', t;
    ELSE
      RAISE NOTICE 'Group A skip (not found): %', t;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- Group B: 共有トークン表 → RLS有効化のみ（ポリシー無し=anon/authenticated全遮断）
--   共有ページはサーバーAPI(service_role)経由でのみトークンを解決するため、
--   クライアントから直接読む必要がない。anonでの token 列挙（全レポート覗き見）を封じる。
-- ---------------------------------------------------------------------
DO $$
DECLARE
  t text;
  tables text[] := ARRAY['pmax_share_tokens', 'pmax_group_shares'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
      -- 既存のゆるいポリシーがあれば削除（service_roleはRLSをBYPASSするので影響なし）
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', 'sel_authenticated_'||t, t);
      RAISE NOTICE 'Group B: RLS only (deny anon/authenticated) on %', t;
    ELSE
      RAISE NOTICE 'Group B skip (not found): %', t;
    END IF;
  END LOOP;
END $$;

-- =====================================================================
-- 検証（SQL Editor）
-- =====================================================================
-- 1) RLSが有効か:
--   SELECT tablename, rowsecurity FROM pg_tables
--   WHERE schemaname='public'
--     AND tablename = ANY(ARRAY['shops','scheduled_posts','post_logs','audit_logs','owners',
--       'user_profiles','user_shop_access','nap_check_results','grid_ranking_presets',
--       'report_display_settings','report_data_cache','report_shop_list','business_groups',
--       'settings','pmax_share_tokens','pmax_group_shares'])
--   ORDER BY tablename;   -- 全て true を期待
--
-- 2) anon 遮断:
--   SET ROLE anon;
--   SELECT count(*) FROM public.user_profiles;   -- 期待: permission denied
--   SELECT count(*) FROM public.pmax_share_tokens;-- 期待: permission denied
--   RESET ROLE;
--
-- 3) authenticated は Group A を読める / Group B は読めない:
--   SET ROLE authenticated;
--   SELECT count(*) FROM public.shops;            -- 期待: 件数が返る
--   SELECT count(*) FROM public.pmax_share_tokens;-- 期待: 0件 or denied（トークンは読ませない）
--   RESET ROLE;
--
-- 4) アプリ動作: ログイン→ダッシュボード/口コミ/順位/投稿/レポート表示、
--    投稿の承認・差戻し、差し込み文字列保存、P-MAX共有URLの表示、公開アンケート表示。

-- =====================================================================
-- ロールバック
-- =====================================================================
-- DO $$ DECLARE t text;
--   tables text[] := ARRAY['shops','scheduled_posts','post_logs','audit_logs','owners',
--     'user_profiles','user_shop_access','nap_check_results','grid_ranking_presets',
--     'report_display_settings','report_data_cache','report_shop_list','business_groups','settings',
--     'pmax_share_tokens','pmax_group_shares'];
-- BEGIN FOREACH t IN ARRAY tables LOOP
--   EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', 'sel_authenticated_'||t, t);
--   EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY;', t);
-- END LOOP; END $$;

-- =====================================================================
-- Group C（別管理・要判断）: 本アプリのコードが参照しない rowsecurity=false テーブル
--   admin_setting, admins, agent_setting, agent_user, agents, batch_control, batch_log,
--   facebook_accounts, gbp_categories, groups, owner_setting, owner_user, performance_logs,
--   post_files, post_resavations, ranking_search_settings, review_reply_settings, setting_msts,
--   shop_group, shop_setting, shop_user, user_setting, users
--   → これらも anon フル権限のまま。特に admins / facebook_accounts / users は要注意。
--   本アプリは未使用のためRLS有効化しても本アプリは壊れないが、同一Supabaseを使う
--   「別システム」がある場合は影響し得る。別システムの有無を確認してから
--   sql/2026-07-07_enable_rls_group_c.sql（別ファイル）で対応する。
-- =====================================================================
