-- 口コミ点数・件数CSV（/api/export?type=review-summary）用の集計関数
-- 店舗×月（JST）ごとの件数と星合計を返す。累計・平均はアプリ側で計算。
-- 全件をアプリに引き抜くと authenticator の statement_timeout=8s に当たるため DB 側で GROUP BY する。
-- API側は関数が無ければ exec_sql 経由で自動作成を試みるが、失敗する場合は本番 SQL Editor でこのファイルを実行する。

CREATE OR REPLACE FUNCTION public.review_monthly_summary(p_end timestamptz)
RETURNS TABLE(shop_id text, ym text, cnt bigint, star_sum bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '100s'
AS $$
  SELECT
    r.shop_id::text AS shop_id,
    to_char(r.create_time AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM') AS ym,
    count(*)::bigint AS cnt,
    sum(CASE upper(coalesce(r.star_rating, ''))
          WHEN 'ONE' THEN 1 WHEN 'ONE_STAR' THEN 1
          WHEN 'TWO' THEN 2 WHEN 'TWO_STARS' THEN 2
          WHEN 'THREE' THEN 3 WHEN 'THREE_STARS' THEN 3
          WHEN 'FOUR' THEN 4 WHEN 'FOUR_STARS' THEN 4
          WHEN 'FIVE' THEN 5 WHEN 'FIVE_STARS' THEN 5
          ELSE 0 END)::bigint AS star_sum
  FROM public.reviews r
  WHERE r.create_time < p_end
  GROUP BY 1, 2;
$$;

REVOKE ALL ON FUNCTION public.review_monthly_summary(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.review_monthly_summary(timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.review_monthly_summary(timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.review_monthly_summary(timestamptz) TO service_role;
