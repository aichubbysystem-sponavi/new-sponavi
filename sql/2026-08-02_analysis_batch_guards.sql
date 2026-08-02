-- Batch分析の二重課金・永久スタック対策（2026-08-02 コードレビュー指摘 H-1〜H-4）
-- 1) poll の排他ロック用テーブル（1行だけ持つ）
-- 2) 投入時刻の記録（古いBatch結果が新しい同期分析を上書きしないため）
-- 3) 死にバッチ検知用のポーリング試行回数

CREATE TABLE IF NOT EXISTS analysis_batch_lock (
  id int PRIMARY KEY DEFAULT 1,
  locked_at timestamptz,
  locked_by text,
  CONSTRAINT analysis_batch_lock_single_row CHECK (id = 1)
);
INSERT INTO analysis_batch_lock (id, locked_at, locked_by)
VALUES (1, NULL, NULL) ON CONFLICT (id) DO NOTHING;
ALTER TABLE analysis_batch_lock ENABLE ROW LEVEL SECURITY;

-- 投入時点のスナップショット時刻。取り込み時に report_analysis.analyzed_at がこれより
-- 新しければ「投入後に人手/同期で作り直された」とみなしてBatch結果を捨てる
ALTER TABLE analysis_batch_items
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz NOT NULL DEFAULT now();

-- ステータス取得に失敗し続ける死にバッチを検知して除外するためのカウンタ
ALTER TABLE analysis_batches
  ADD COLUMN IF NOT EXISTS poll_attempts int NOT NULL DEFAULT 0;

-- pending救済クエリ用（processedバッチに取り残されたpendingを拾う）
CREATE INDEX IF NOT EXISTS idx_abi_state_shop ON analysis_batch_items(state, shop_name);
