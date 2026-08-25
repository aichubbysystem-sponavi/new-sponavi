-- shops に Googleマップ掲載の評価・口コミ件数を保存する列を追加
--
-- 背景: sync-reviews（cron毎時 / 手動同期）は以前から
--   supabase.from("shops").update({ rating, review_count, gbp_full_path, gbp_location_name })
-- を実行しているが、rating / review_count 列が本番に存在せず update 全体が失敗していた
-- （= gbp_full_path の永続化も実は効いていなかった）。
-- この列を追加すると次回同期から自動で埋まる。/api/export?type=review-summary と
-- /api/report/shop-ratings, rpa-sheet-check もこの列を読む。

ALTER TABLE public.shops
  ADD COLUMN IF NOT EXISTS rating       numeric(3,1),
  ADD COLUMN IF NOT EXISTS review_count integer;

COMMENT ON COLUMN public.shops.rating       IS 'Googleマップ掲載の平均評価（GBP API averageRating。同期時に更新）';
COMMENT ON COLUMN public.shops.review_count IS 'Googleマップ掲載の口コミ件数（GBP API totalReviewCount。同期時に更新）';
