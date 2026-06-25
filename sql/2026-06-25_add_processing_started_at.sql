-- scheduled_postsにprocessing_started_atカラムを追加（二重投稿防止用）
-- staleリカバリでscheduled_at（予約時刻）ではなくprocessing開始時刻で判定するため
ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;

-- processingが5分以上放置されたレコードを効率的に検索するインデックス
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_processing ON scheduled_posts (status, processing_started_at)
  WHERE status = 'processing';
