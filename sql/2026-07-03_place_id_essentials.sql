-- 多地点順位計測: SKUをPro(¥4.8/回)→Essentials(¥0.75/回)に落とすためのplace_id対応
-- ・shops.gbp_place_id: 店舗のGoogleプレイスID（順位照合を店名→IDに切替、単価▲84%）
-- ・grid_search_cache.place_ids: 検索結果のプレイスID配列（ID照合用キャッシュ）
-- 実行: Supabase SQL Editor で実行（冪等・何度実行してもOK）
-- ※ 2026-07-03_grid_search_cache.sql が未実行でも、このファイルだけで両方作成される

-- キャッシュテーブル（未作成の場合に備えて再掲・冪等）
create table if not exists grid_search_cache (
  id uuid primary key default gen_random_uuid(),
  keyword text not null,
  lat_key text not null,
  lng_key text not null,
  month text not null,
  places jsonb not null,
  complete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (keyword, lat_key, lng_key, month)
);
create index if not exists idx_grid_search_cache_month on grid_search_cache (month);
alter table grid_search_cache enable row level security;

-- 今回の追加分
alter table grid_search_cache add column if not exists place_ids jsonb not null default '[]'::jsonb;
alter table shops add column if not exists gbp_place_id text;
