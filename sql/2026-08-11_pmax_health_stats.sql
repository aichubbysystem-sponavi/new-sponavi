-- P-MAXデータ健全性チェック用の集計関数（週次cron /api/cron/pmax-health から呼ぶ）
-- 2026-08-11: てっぱち札幌大通り店等でGBP月次が1ヶ月分・日次が7/1で凍結していた事故を受けて追加。
-- 「壊れたら気づける」ための異常検知を1回のRPCで返す。
--
-- 返すJSON:
--   gbp_stale        … 配信中なのにGBP最新月がAds最新月より2ヶ月以上遅れている店舗
--                      （GBPが1件も無い店舗はLP系の正常ケースがあるため対象外）
--   gbp_missing_new  … 直近2ヶ月内に配信開始した新店舗でGBPが1件も無い（照合漏れの早期検知）
--   daily_stale_prev … 前月の日次が月末まで揃っていない店舗（行があるのに途中で止まっている）
--   daily_stale_cur  … 当月の日次が一昨日まで追いついていない店舗

create or replace function pmax_health_stats()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with
ads as (
  select shop_name, count(distinct month) as ads_months,
         min(month) as ads_min, max(month) as ads_max
  from pmax_store_data group by 1
),
gbp as (
  select shop_name, count(distinct month) as gbp_months,
         max(replace(month, '/', '-')) as gbp_max
  from pmax_gbp_data group by 1
),
cur as (
  select to_char(now() at time zone 'Asia/Tokyo', 'YYYY-MM') as cur_month,
         to_char((now() at time zone 'Asia/Tokyo')::date - 2, 'YYYY-MM-DD') as daily_cutoff,
         to_char(date_trunc('month', now() at time zone 'Asia/Tokyo') - interval '1 month', 'YYYY-MM') as prev_month,
         to_char(date_trunc('month', now() at time zone 'Asia/Tokyo') - interval '1 day', 'YYYY-MM-DD') as prev_month_end,
         to_char(date_trunc('month', now() at time zone 'Asia/Tokyo') - interval '2 month', 'YYYY-MM') as m2_month
),
gbp_stale as (
  select a.shop_name, a.ads_max, g.gbp_max
  from ads a join gbp g using (shop_name), cur
  where a.ads_max >= cur.prev_month
    and g.gbp_max < to_char(to_date(a.ads_max || '-01', 'YYYY-MM-DD') - interval '1 month', 'YYYY-MM')
),
gbp_missing_new as (
  select a.shop_name, a.ads_min
  from ads a left join gbp g using (shop_name), cur
  where coalesce(g.gbp_months, 0) = 0 and a.ads_min >= cur.m2_month
),
daily_prev as (
  select d.shop_name, max(d.date) as max_date, count(distinct d.date) as days
  from pmax_store_daily d, cur
  where d.date >= cur.prev_month || '-01' and d.date <= cur.prev_month_end
  group by d.shop_name, cur.prev_month_end
  having max(d.date) < cur.prev_month_end
),
daily_cur as (
  select d.shop_name, max(d.date) as max_date, count(distinct d.date) as days
  from pmax_store_daily d, cur
  where d.date >= cur.cur_month || '-01'
  group by d.shop_name, cur.daily_cutoff
  having max(d.date) < cur.daily_cutoff
)
select jsonb_build_object(
  'gbp_stale', (select coalesce(jsonb_agg(jsonb_build_object('shop', shop_name, 'adsMax', ads_max, 'gbpMax', gbp_max) order by shop_name), '[]'::jsonb) from gbp_stale),
  'gbp_missing_new', (select coalesce(jsonb_agg(jsonb_build_object('shop', shop_name, 'since', ads_min) order by shop_name), '[]'::jsonb) from gbp_missing_new),
  'daily_stale_prev', (select coalesce(jsonb_agg(jsonb_build_object('shop', shop_name, 'maxDate', max_date, 'days', days) order by shop_name), '[]'::jsonb) from daily_prev),
  'daily_stale_cur', (select coalesce(jsonb_agg(jsonb_build_object('shop', shop_name, 'maxDate', max_date, 'days', days) order by shop_name), '[]'::jsonb) from daily_cur)
);
$$;

-- service_roleのみ実行可（cron経由のサーバー専用。anon/authenticatedからは呼べない）
revoke execute on function pmax_health_stats() from public;
revoke execute on function pmax_health_stats() from anon;
revoke execute on function pmax_health_stats() from authenticated;
grant execute on function pmax_health_stats() to service_role;
