-- P-MAX レポート共有トークン
CREATE TABLE IF NOT EXISTS pmax_share_tokens (
  token TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  shop_name TEXT NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_pmax_share_shop ON pmax_share_tokens(shop_name, year, month);
