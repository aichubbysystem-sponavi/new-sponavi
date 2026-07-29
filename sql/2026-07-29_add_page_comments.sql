-- AI総評を各データページ末尾に配置する機能のためのカラム追加
-- page_comments: { map, search, reactions, keyword, reviews[], actions[] }
ALTER TABLE report_analysis
  ADD COLUMN IF NOT EXISTS page_comments jsonb;
