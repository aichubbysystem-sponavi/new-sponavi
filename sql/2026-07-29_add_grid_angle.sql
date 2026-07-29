-- 多地点順位チェック: 店舗ごとの計測4地点の回転角（15度刻み）
-- NULL = 0度（斜めNE/NW/SE/SW）。許可値: 0/15/30/45/60/75（アプリ側で制限。90度で一周のため75まで）
-- デプロイ前に本番Supabase (kxxwspavskhhjtiixcep) SQL Editor で手動実行
ALTER TABLE shops ADD COLUMN IF NOT EXISTS grid_angle_deg integer;
