-- P-MAX 店舗別月次データ（Google Ads API同期結果を保存）
-- 「反映」ボタンで同期 → 表示時はこのテーブルから読むだけ

CREATE TABLE IF NOT EXISTS public.pmax_store_data (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  shop_name TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'Japanese',
  month TEXT NOT NULL,              -- "2026-06" 形式
  campaign_name TEXT,
  campaign_id TEXT,
  impressions BIGINT DEFAULT 0,
  clicks BIGINT DEFAULT 0,
  ctr DOUBLE PRECISION DEFAULT 0,
  average_cpc DOUBLE PRECISION DEFAULT 0,
  cost_micros BIGINT DEFAULT 0,
  account_id TEXT,
  synced_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(shop_name, language, month, campaign_id)
);

-- P-MAX 店舗別日次データ
CREATE TABLE IF NOT EXISTS public.pmax_store_daily (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  shop_name TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'Japanese',
  date TEXT NOT NULL,                -- "2026-06-15" 形式
  campaign_name TEXT,
  campaign_id TEXT,
  impressions BIGINT DEFAULT 0,
  clicks BIGINT DEFAULT 0,
  ctr DOUBLE PRECISION DEFAULT 0,
  average_cpc DOUBLE PRECISION DEFAULT 0,
  cost_micros BIGINT DEFAULT 0,
  account_id TEXT,
  synced_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(shop_name, language, date, campaign_id)
);

-- 同期履歴（どの店舗のどの月を同期したか）
CREATE TABLE IF NOT EXISTS public.pmax_sync_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  shop_name TEXT NOT NULL,
  month TEXT NOT NULL,
  synced_by TEXT,                    -- user ID
  synced_at TIMESTAMPTZ DEFAULT now(),
  status TEXT DEFAULT 'success',    -- success / error
  message TEXT,
  UNIQUE(shop_name, month)
);

-- P-MAX 店舗別GBPデータ（スプレッドシートから同期）
CREATE TABLE IF NOT EXISTS public.pmax_gbp_data (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  shop_name TEXT NOT NULL,
  month TEXT NOT NULL,              -- "2026/06" 形式（シート準拠）
  total_impressions BIGINT DEFAULT 0,
  total_visits BIGINT DEFAULT 0,
  phone BIGINT DEFAULT 0,
  directions BIGINT DEFAULT 0,
  website BIGINT DEFAULT 0,
  menu_clicks BIGINT DEFAULT 0,
  save_share BIGINT DEFAULT 0,
  synced_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(shop_name, month)
);

-- アカウント→店舗マッピング（P-MAXキャンペーンがあるアカウントだけ記録）
CREATE TABLE IF NOT EXISTS public.pmax_account_mapping (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id TEXT NOT NULL,
  shop_name TEXT NOT NULL,
  UNIQUE(account_id, shop_name)
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_pmax_store_data_shop_month ON pmax_store_data(shop_name, month);
CREATE INDEX IF NOT EXISTS idx_pmax_store_daily_shop_date ON pmax_store_daily(shop_name, date);
CREATE INDEX IF NOT EXISTS idx_pmax_sync_log_month ON pmax_sync_log(month);
CREATE INDEX IF NOT EXISTS idx_pmax_gbp_data_shop_month ON pmax_gbp_data(shop_name, month);

-- RLS
ALTER TABLE pmax_store_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE pmax_store_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE pmax_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON pmax_store_data FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON pmax_store_daily FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON pmax_sync_log FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE pmax_gbp_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE pmax_account_mapping ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON pmax_gbp_data FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON pmax_account_mapping FOR ALL TO service_role USING (true) WITH CHECK (true);
