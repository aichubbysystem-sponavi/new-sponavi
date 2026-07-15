-- 口コミ分析(AI)が「口コミなし」誤判定 → 真因は reviews クエリの statement timeout。
-- reviews テーブルは shop_name にインデックスが無く、14.7万件を create_time インデックス経由で
-- 約7万行拾ってから shop_name で絞るため単体で約6.2秒。count:"exact" で倍増し8秒制限を超過
-- （authenticator/authenticated ロールの statement_timeout=8s）。
-- 2026-07-07〜08のRLS有効化でロール切替が入り、データ増加と重なって顕在化。
--
-- shop_name + create_time DESC の複合インデックスでクエリを 6244ms → 104ms に短縮。
-- 本番DBには CREATE INDEX CONCURRENTLY で適用済み（ロックなし）。
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reviews_shop_name_time
  ON public.reviews USING btree (shop_name, create_time DESC);

ANALYZE public.reviews;
