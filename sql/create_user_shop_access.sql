-- user_shop_access: ユーザーごとのアクセス可能店舗を管理
-- president ロールは全店舗アクセス可（コード側でバイパス）
-- それ以外のロールはこのテーブルに明示的にエントリが必要

CREATE TABLE IF NOT EXISTS user_shop_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_uid UUID NOT NULL,
  shop_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(auth_uid, shop_name)
);

CREATE INDEX IF NOT EXISTS idx_user_shop_access_auth_uid ON user_shop_access(auth_uid);
CREATE INDEX IF NOT EXISTS idx_user_shop_access_shop_name ON user_shop_access(shop_name);
