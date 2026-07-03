-- P-MAX グループ共有トークン
-- クライアントに渡す公開URL用。トークンにはグループ名だけを紐付け、
-- そのグループに属する店舗以外は一切参照できないようにする。
CREATE TABLE IF NOT EXISTS pmax_group_shares (
  token TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  group_name TEXT NOT NULL UNIQUE,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- グループ名で既存トークンを引くためのインデックス（UNIQUE制約で自動作成されるが明示）
CREATE INDEX IF NOT EXISTS idx_pmax_group_shares_group ON pmax_group_shares(group_name);
