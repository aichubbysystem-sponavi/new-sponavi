-- パフォーマンスメトリクスキャッシュテーブル
-- GBP Performance API から取得した月別パフォーマンスデータを保存
CREATE TABLE IF NOT EXISTS performance_metrics_cache (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  shop_id text NOT NULL,
  shop_name text NOT NULL,
  month text NOT NULL,           -- "2026/5" 形式
  metrics jsonb NOT NULL,        -- { searchMobile, searchPC, mapMobile, mapPC, calls, messages, bookings, routes, websites, foodOrders, foodMenus }
  updated_at timestamptz DEFAULT now(),
  UNIQUE (shop_id, month)
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_perf_cache_shop_id ON performance_metrics_cache (shop_id);
CREATE INDEX IF NOT EXISTS idx_perf_cache_month ON performance_metrics_cache (month);

-- RLS（サービスロールキーで読み書きするのでデフォルトで許可）
ALTER TABLE performance_metrics_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON performance_metrics_cache
  FOR ALL USING (true) WITH CHECK (true);
