-- report_display_settings.shop_id は「店舗名」を格納する設計（report_data_cache.shop_name /
-- grid_ranking_overrides.shop_name と同じ）だが、誤って shops(id)=UUID への外部キー制約が
-- 付いていたため、店舗名を入れると必ず violates foreign key で 500 になり、
-- 表示設定が一度も保存できていなかった（テーブル0行）。
-- 他テーブルと同様に店舗名キー・FKなしに揃えるため制約を削除する。
-- ※データ削除は発生しない（制約の除去のみ）。
ALTER TABLE public.report_display_settings
  DROP CONSTRAINT IF EXISTS fk_report_display_settings_shop;
