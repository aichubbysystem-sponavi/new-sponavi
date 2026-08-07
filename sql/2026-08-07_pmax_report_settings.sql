-- P-MAXレポートの店舗別 表示設定＋数値上書き（手動編集の永続保存）
-- overrides: { "<キー>": 数値 } 形式。キーは src/lib/pmax-overrides.ts 参照
--   m|<言語>|<YYYY-MM>|<field>   … 言語別月次（impressions/clicks/costYen/ctrPct/cpcYen）
--   d|<言語>|<YYYY-MM-DD>|<field> … 言語別日次（同上）
--   g|<YYYY/MM>|<field>          … GBPコンバージョン（totalVisits/phone/directions/website/menuClicks/saveShare/reservation）
--   c|<YYYY-MM>|<network>|impressions … 媒体別配信比率
--   k|<YYYY-MM>|<field>          … KPIサマリー集計値の上書き（impressions/clicks/costYen）
-- section_visibility: { "conversion"|"lang|<言語>"|"daily"|"channels"|"advice"|"summary": false } で該当ページ非表示
-- 同期（全店舗を更新）ではこのテーブルは触らないため、手動編集は再同期後も保持される

CREATE TABLE IF NOT EXISTS public.pmax_report_settings (
  shop_name TEXT PRIMARY KEY,
  overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
  section_visibility JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pmax_report_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON pmax_report_settings FOR ALL TO service_role USING (true) WITH CHECK (true);
