-- =====================================================================
-- 「RLS有効なのに {public} に全許可」ポリシーの一掃  2026-07-07
-- =====================================================================
-- 実測（pg_policies）で判明した二次的な穴:
--   rowsecurity=true でも、多くのテーブルに roles={public} の
--   ゆるいポリシー（cmd=ALL/SELECT, qual=true）が付いており、
--   {public} は anon を含むため実質「未ログインでも読み書き可能」だった。
--   例: media「誰でも読める」「全書き込み許可」、line_alerts_all、shop_keywords_all、
--       reviews「誰でも読める」、survey_responses_all 等。
--   さらに performance_metrics_cache / pmax_cache / report_memos / sync_progress は
--   ポリシー名が "service role" だが roles が {public} になっている設定ミス。
--
-- 方針（Group A/B と同一）:
--   対象テーブルの既存ポリシーを全削除し、authenticated に SELECT のみ許可し直す。
--   * anon は全遮断（未ログインの読み書きを封じる、これが目的）
--   * 書き込みは全て service_role のサーバーAPI/cron 経由（service_role は RLS を BYPASS）
--   * クライアントからの直接書き込みは存在しない（全数grep確認済み）。
--     アンケート送信も /api/report/survey（service_role）経由なので survey_responses を絞っても壊れない。
--   * 正しく {service_role} に絞られている pmax_store_data 等は対象外（触らない）。
-- =====================================================================

DO $$
DECLARE
  t text;
  p record;
  tables text[] := ARRAY[
    'bad_review_alerts',
    'fixed_messages',
    'grid_ranking_logs',
    'grid_ranking_overrides',
    'hearing_sheets',
    'line_alerts',
    'line_messages',
    'media',
    'performance_metrics_cache',
    'pmax_cache',
    'post_schedule',
    'ranking_search_logs',
    'reply_templates',
    'report_analysis',
    'report_memos',
    'reviews',
    'shop_keywords',
    'survey_responses',
    'sync_progress'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
      -- 既存ポリシーを全削除（{public}のゆるいポリシーを一掃。service_roleはBYPASSするため無影響）
      FOR p IN SELECT policyname FROM pg_policies
               WHERE schemaname='public' AND tablename=t LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', p.policyname, t);
      END LOOP;
      -- authenticated に SELECT のみ許可
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true);',
        'sel_authenticated_'||t, t);
      RAISE NOTICE 'cleaned public policies + authenticated SELECT on %', t;
    ELSE
      RAISE NOTICE 'skip (not found): %', t;
    END IF;
  END LOOP;
END $$;

-- =====================================================================
-- 検証:
--   1) 対象テーブルに {public} ポリシーが残っていないこと:
--      SELECT tablename, policyname, roles FROM pg_policies
--      WHERE schemaname='public' AND 'public' = ANY(roles)
--      ORDER BY tablename;   -- 期待: 上記対象テーブルが消えている（残るのは意図的な公開のみ）
--   2) anon 遮断:
--      SET ROLE anon;
--      SELECT count(*) FROM public.reviews;          -- 期待: permission denied
--      SELECT count(*) FROM public.media;            -- 期待: permission denied
--      RESET ROLE;
--   3) authenticated は読める:
--      SET ROLE authenticated;
--      SELECT count(*) FROM public.reviews;          -- 期待: 件数
--      RESET ROLE;
--   4) アプリ動作: 口コミ一覧/メディア/順位/ヒアリング/レポート/アンケート送信 が今まで通り。
--
-- ロールバックは各テーブルの元ポリシーを再作成する必要があるが、元は{public}全許可=危険なので
-- 通常は不要。問題が出たテーブルだけ個別に authenticated 用ポリシーを足すこと。
-- =====================================================================
