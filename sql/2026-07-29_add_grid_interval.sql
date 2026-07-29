-- 多地点順位チェック: 店舗ごとの計測距離設定（斜め4地点の半径）
-- NULL = 既定1000m。許可値: 500/1000/2000/3000/4000/5000（アプリ側で制限）
-- デプロイ前に本番Supabase (kxxwspavskhhjtiixcep) SQL Editor で手動実行
ALTER TABLE shops ADD COLUMN IF NOT EXISTS grid_interval_m integer;
