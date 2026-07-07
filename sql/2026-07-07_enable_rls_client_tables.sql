-- =====================================================================
-- クライアント直アクセステーブルへの RLS 有効化（anon 遮断）
-- 2026-07-07  セキュリティ監査フォローアップ
-- =====================================================================
-- 背景:
--   公開 anon キー（ブラウザに露出）で以下15テーブルが直接 select/一部 update/insert/delete
--   できていた。C-1（system_oauth_tokens）と同じ「anon 直読み」構造がアプリ全体に残存。
--   → publicな anon キーだけで全クライアントの口コミ・順位・オーナー情報・監査ログが列挙可能。
--
-- 方針（重要）:
--   * RLS を有効化し、authenticated（ログイン済みユーザー）には SELECT のみ許可する。
--     アプリのクライアント読み取りはログイン後=authenticated ロールで動くため壊れない。
--   * anon（未ログイン）はポリシー無し＝全遮断。これが今回の穴（公開キー流出）を塞ぐ本体。
--   * INSERT/UPDATE/DELETE は authenticated にも許可しない。
--     書き込みは全て service_role のサーバーAPI経由に移行済み（コミット dbc03a3）。
--     service_role は BYPASSRLS のため RLS の影響を受けず、サーバー処理は継続動作する。
--     → 万一 authenticated トークンが漏れても、DBを直接書き換えられない（多層防御）。
--
-- 前提（このSQLを流す前に本番反映済みであること）:
--   * サーバー側の匿名read（survey / report一覧 / actions）を service_role 化（コミット edb7d71）
--   * クライアント直書き5系統をサーバーAPI化（コミット dbc03a3）
--   これらが未反映のままRLSを有効化すると、公開アンケートや一部保存が壊れる。
--
-- 注意:
--   * authenticated への SELECT USING(true) は「ログイン済みなら全店舗を読める」状態のまま。
--     店舗単位のテナント分離（part_time を担当店舗のみに制限）はアプリ層(getUserAllowedShops)で
--     担保している。DB層での行フィルタRLSは次フェーズ（本SQLの対象外）。
--   * 実行は Supabase SQL Editor で行い、下部の検証手順を必ず実施すること。
-- =====================================================================

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'shops',
    'reviews',
    'report_analysis',
    'scheduled_posts',
    'post_logs',
    'fixed_messages',
    'line_alerts',
    'bad_review_alerts',
    'media',
    'ranking_search_logs',
    'owners',
    'shop_keywords',
    'grid_ranking_logs',
    'audit_logs',
    'user_profiles'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- 対象テーブルが存在する場合のみ処理（環境差異に堅牢化）
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
      -- 冪等化: 既存の同名ポリシーを消してから作り直す
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', 'sel_authenticated_' || t, t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true);',
        'sel_authenticated_' || t, t
      );
      RAISE NOTICE 'RLS enabled + SELECT(authenticated) policy on %', t;
    ELSE
      RAISE NOTICE 'skip (table not found): %', t;
    END IF;
  END LOOP;
END $$;

-- =====================================================================
-- 検証（Supabase SQL Editor で実施）
-- =====================================================================
-- 1) RLSが有効になったか:
--   SELECT tablename, rowsecurity FROM pg_tables
--   WHERE schemaname='public'
--     AND tablename = ANY (ARRAY['shops','reviews','report_analysis','scheduled_posts',
--       'post_logs','fixed_messages','line_alerts','bad_review_alerts','media',
--       'ranking_search_logs','owners','shop_keywords','grid_ranking_logs','audit_logs','user_profiles'])
--   ORDER BY tablename;   -- 全て rowsecurity = true を期待
--
-- 2) anon が遮断されたか（未ログイン相当）:
--   SET ROLE anon;
--   SELECT count(*) FROM public.shops;      -- 期待: permission denied / 0行いずれか（RLSで遮断）
--   SELECT count(*) FROM public.audit_logs; -- 期待: 遮断
--   RESET ROLE;
--
-- 3) authenticated は読めるか:
--   SET ROLE authenticated;
--   SELECT count(*) FROM public.shops;      -- 期待: 件数が返る（読み取りは維持）
--   RESET ROLE;
--
-- 4) アプリ動作確認（本番）:
--   - 通常ログイン→ダッシュボード/口コミ/順位/投稿の各画面が表示されること
--   - 公開アンケート report.new-spotlight-navigator.com/report/survey/<shopId> が
--     ログイン無しで店舗名を表示できること（service_role 経由なのでRLSの影響を受けない想定）
--   - 投稿の承認/差戻し、差し込み文字列の保存、LINEアラート対応済みが動くこと（サーバーAPI経由）
-- =====================================================================

-- =====================================================================
-- ロールバック（問題が起きた場合。anon 遮断を解除して元に戻す）
-- =====================================================================
-- DO $$
-- DECLARE t text;
--   tables text[] := ARRAY['shops','reviews','report_analysis','scheduled_posts','post_logs',
--     'fixed_messages','line_alerts','bad_review_alerts','media','ranking_search_logs',
--     'owners','shop_keywords','grid_ranking_logs','audit_logs','user_profiles'];
-- BEGIN
--   FOREACH t IN ARRAY tables LOOP
--     EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', 'sel_authenticated_' || t, t);
--     EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY;', t);
--   END LOOP;
-- END $$;
-- =====================================================================
