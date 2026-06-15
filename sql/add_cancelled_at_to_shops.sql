-- 解約店舗管理: shops テーブルに cancelled_at カラム追加
-- 実行: Supabase SQL Editor (本番: kxxwspavskhhjtiixcep)

ALTER TABLE shops ADD COLUMN IF NOT EXISTS cancelled_at timestamptz DEFAULT NULL;

-- インデックス: 解約フィルタ高速化
CREATE INDEX IF NOT EXISTS idx_shops_cancelled_at ON shops (cancelled_at);

COMMENT ON COLUMN shops.cancelled_at IS '解約日時。NULLなら契約中、値があれば解約済み';
