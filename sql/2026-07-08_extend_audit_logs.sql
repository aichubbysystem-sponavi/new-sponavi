-- =============================================================
-- 2026-07-08 監査ログ拡張（4段階役職権限 + 全操作記録 対応）
-- 適用先: 本番Supabase (kxxwspavskhhjtiixcep) SQL Editor で手動実行
-- 後方互換: 列追加のみ。既存の insert (id, user_name, action, detail) はそのまま動く
-- =============================================================

-- 1) 監査用の列を追加
ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS user_id uuid,          -- 操作者の auth.users.id（JWT sub）
  ADD COLUMN IF NOT EXISTS role text,             -- 操作時のロール president/executive/manager/part_time
  ADD COLUMN IF NOT EXISTS action_type text,      -- PAID_OP/EXTERNAL_OP/DATA_OP/MEMO/ADMIN
  ADD COLUMN IF NOT EXISTS target_shop text,      -- 対象店舗名（あれば）
  ADD COLUMN IF NOT EXISTS method text,           -- HTTPメソッド
  ADD COLUMN IF NOT EXISTS path text,             -- リクエストパス
  ADD COLUMN IF NOT EXISTS ip text,               -- 送信元IP
  ADD COLUMN IF NOT EXISTS status int,            -- レスポンスステータス
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'api';  -- api / middleware / client

-- 2) 操作ログページの検索用インデックス
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at  ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_name   ON audit_logs (user_name);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_type ON audit_logs (action_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target_shop ON audit_logs (target_shop);

-- 3) 閲覧を「サーバーAPI経由=社長のみ」に限定する
--    authenticated SELECT ポリシーが残っていると社員・バイトも
--    anon/authenticatedキーで直接ログを読めてしまうため剥がす。
--    （書き込みは元々サーバー(service_role)経由のみ）
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'audit_logs'
  LOOP
    EXECUTE format('DROP POLICY %I ON audit_logs', pol.policyname);
  END LOOP;
END $$;

-- RLS有効を確認（既に有効なら no-op）
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- ポリシーを一切付けない = anon/authenticated は読み書き不可、service_role のみ可

-- 4) 確認クエリ（実行後に目視確認）
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name='audit_logs';
-- SELECT * FROM pg_policies WHERE tablename='audit_logs';  -- 0行になっていること
