-- P1-4: 重複店舗データ統合（2026-06-10実行済み）
-- 492件の重複レコードを削除、最古の1件を残す

-- P1-4: UNIQUE制約追加
ALTER TABLE shops ADD CONSTRAINT shops_name_unique UNIQUE (name);

-- P1-3: 孤児レコード削除
DELETE FROM report_analysis WHERE shop_id IS NOT NULL AND shop_id::text NOT IN (SELECT id::text FROM shops);
DELETE FROM shop_keywords WHERE shop_id::text NOT IN (SELECT id::text FROM shops);

-- P1-3: UUID→TEXT型変換（0行テーブル）
ALTER TABLE post_schedule ALTER COLUMN shop_id TYPE text USING shop_id::text;
ALTER TABLE survey_responses ALTER COLUMN shop_id TYPE text USING shop_id::text;

-- P1-3: FK制約追加（5テーブル）
ALTER TABLE report_analysis ADD CONSTRAINT fk_report_analysis_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE SET NULL;
ALTER TABLE report_display_settings ADD CONSTRAINT fk_report_display_settings_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE;
ALTER TABLE scheduled_posts ADD CONSTRAINT fk_scheduled_posts_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE;
ALTER TABLE post_schedule ADD CONSTRAINT fk_post_schedule_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE;
ALTER TABLE survey_responses ADD CONSTRAINT fk_survey_responses_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE;
