-- P-MAX 店舗別・広告ネットワーク（配信チャネル）別の月次データ
-- Google Ads API v23 の segments.ad_network_type によるチャネル別レポート
-- （MAPS / SEARCH / YOUTUBE / GMAIL / DISCOVER / CONTENT / SEARCH_PARTNERS 等）
-- レポート表示時にDBになければAPIから取得して保存（pmax_store_dailyと同方式）。
-- /api/pmax/sync 実行時は対象月分を削除し、次回表示で再取得（鮮度維持）。
-- ※チャネル別データは2025-06-01以降の日付のみGoogle側で集計される

CREATE TABLE IF NOT EXISTS public.pmax_channel_data (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  shop_name TEXT NOT NULL,
  month TEXT NOT NULL,              -- "2026-06" 形式
  network TEXT NOT NULL,            -- segments.ad_network_type の値
  impressions BIGINT DEFAULT 0,
  clicks BIGINT DEFAULT 0,
  cost_micros BIGINT DEFAULT 0,
  synced_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(shop_name, month, network)
);

CREATE INDEX IF NOT EXISTS idx_pmax_channel_data_shop_month ON pmax_channel_data(shop_name, month);

-- サーバー専用テーブル（anonからは読めない）: pmax系の既存方針に合わせる
ALTER TABLE pmax_channel_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON pmax_channel_data FOR ALL TO service_role USING (true) WITH CHECK (true);
