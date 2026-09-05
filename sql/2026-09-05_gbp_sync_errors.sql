-- 2026-09-05: GBP同期（検索語句／パフォーマンス指標）の失敗理由を保持
-- 背景: 主トークンから見えない4アカウント349店舗が 403/404 → 「0ヶ月」として無音失敗していた。
-- 成功時は行を削除する（行がある＝直近の同期が失敗）。
-- 本番 Supabase SQL Editor で実行してからデプロイすること。
CREATE TABLE IF NOT EXISTS gbp_sync_errors (
  shop_id     text NOT NULL,
  shop_name   text NOT NULL,
  kind        text NOT NULL,            -- 'search_keywords' | 'performance'
  http_status integer NOT NULL DEFAULT 0,
  message     text NOT NULL DEFAULT '',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_gbp_sync_errors_kind ON gbp_sync_errors (kind);

ALTER TABLE gbp_sync_errors ENABLE ROW LEVEL SECURITY;
-- service_role のみ読み書き（anon/authenticated からは触れない）
DROP POLICY IF EXISTS "service_role_only" ON gbp_sync_errors;
CREATE POLICY "service_role_only" ON gbp_sync_errors
  FOR ALL TO service_role USING (true) WITH CHECK (true);
