-- AI総評のBatch API（半額）パイプライン用テーブル
-- analysis_batches: Anthropic Message Batches 1件 = 1行
-- analysis_batch_items: 店舗ごとの投入アイテム（プロンプト材料・照合コンテキスト・状態）
-- 2026-08-02 適用済み（psycopg2経由）

CREATE TABLE IF NOT EXISTS analysis_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anthropic_batch_id text,
  round int NOT NULL DEFAULT 0,          -- 0=初回, 1〜=修正/縮小リトライのラウンド
  status text NOT NULL DEFAULT 'creating', -- creating / submitted / processed / submit_failed
  item_total int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS analysis_batch_items (
  id uuid PRIMARY KEY,                    -- クライアント発行（Anthropicのcustom_idと同一）
  batch_id uuid NOT NULL REFERENCES analysis_batches(id),
  shop_id text,
  shop_name text NOT NULL,
  target_month text,
  round int NOT NULL DEFAULT 0,
  corrections int NOT NULL DEFAULT 0,     -- 照合違反による再生成回数（最大2）
  review_limit text NOT NULL DEFAULT 'all', -- all / 50（生成失敗時の縮小リトライ）
  correction text,                        -- 再生成時の修正指示
  payload jsonb NOT NULL,                 -- 口コミ・KPIテキスト・verifyCtx等のプロンプト材料
  state text NOT NULL DEFAULT 'pending',  -- pending / succeeded / blanked / failed
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_abi_batch ON analysis_batch_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_abi_state ON analysis_batch_items(state);
CREATE INDEX IF NOT EXISTS idx_ab_status ON analysis_batches(status);

-- サーバー（service role）のみが読み書きする。anonからの直接アクセスを遮断
-- （publicテーブルはanonフルGRANTが既定のため、RLS有効化＋ポリシー無し=遮断が本プロジェクトの慣例）
ALTER TABLE analysis_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_batch_items ENABLE ROW LEVEL SECURITY;
