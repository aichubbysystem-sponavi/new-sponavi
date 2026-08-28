-- 2026-08-28 コードレビュー指摘の対応（2件）。本番 SQL Editor で実行してください。

-- 1. 予約投稿の二重登録をDB側で防ぐ
--    予約登録はクライアントが10店舗ずつAPIを呼ぶが、290秒でタイムアウトした後に同じバッチを再送すると
--    サーバー側では前のリクエストがまだ走っていることがある。API内の「select→insert」の重複チェックは
--    この競合を防げず、同一店舗・同一予約時刻の pending 行が2本できて GBP に二重投稿し得る。
--    実行待ち（pending/on_hold/processing）の行だけを対象にした部分一意インデックスで止める。
--    published / error / skipped 行は対象外なので、投稿後・失敗後の再登録は今までどおりできる。
--    ※ 既に重複がある場合は作成に失敗する。その場合は下の確認クエリで重複を出して片方を削除してから再実行。
--
--    確認: select shop_id, scheduled_at, count(*) from scheduled_posts
--          where status in ('pending','on_hold','processing') group by 1,2 having count(*) > 1;
CREATE UNIQUE INDEX IF NOT EXISTS uq_scheduled_posts_active_shop_time
  ON scheduled_posts (shop_id, scheduled_at)
  WHERE status IN ('pending', 'on_hold', 'processing');

-- 2. auto_post_skips の読み取りをログイン済みユーザーに限定
--    他のクライアント系テーブル（sql/2026-07-07_enable_rls_client_tables.sql）と同じ形にする。
--    初版は TO authenticated が抜けており、JSバンドルに含まれる anon キーだけで読めていた。
DROP POLICY IF EXISTS auto_post_skips_read ON auto_post_skips;
CREATE POLICY auto_post_skips_read ON auto_post_skips FOR SELECT TO authenticated USING (true);
