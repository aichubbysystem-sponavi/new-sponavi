-- レポート表示設定（店舗ごと、ブラウザ横断で共有）
CREATE TABLE IF NOT EXISTS report_display_settings (
  shop_id TEXT PRIMARY KEY,
  section_visibility JSONB NOT NULL DEFAULT '{}',
  kw_visibility JSONB NOT NULL DEFAULT '{}',
  rw_visibility JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
