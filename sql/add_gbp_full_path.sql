-- gbp_full_path: 口コミ同期成功時にフルパスを永続保存
-- OAuthトークンが切れてもGBPロケーション情報が失われなくなる
ALTER TABLE shops ADD COLUMN IF NOT EXISTS gbp_full_path TEXT;

-- 既存のgbp_location_nameからgbp_full_pathを推定（可能な範囲で）
-- これは手動で実行後、sync-reviewsが成功するたびに正確な値に更新される
