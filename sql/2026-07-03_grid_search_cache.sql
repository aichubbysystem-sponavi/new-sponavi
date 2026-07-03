-- 多地点順位計測: 検索結果の月次キャッシュ
-- 目的: 同月内の同一検索(キーワード×地点)のPlaces API再呼び出しをゼロにする
--       + 検索結果リスト全体を保存し、複数店舗で1回の検索を共有する
-- 実行: Supabase SQL Editor で実行

create table if not exists grid_search_cache (
  id uuid primary key default gen_random_uuid(),
  keyword text not null,
  lat_key text not null,        -- 格子スナップ済み緯度 (0.009°格子, toFixed(6))
  lng_key text not null,        -- 格子スナップ済み経度 (0.011°格子, toFixed(6))
  month text not null,          -- 'YYYY-MM' (JST)
  places jsonb not null,        -- 順位順の店名配列 ["店A","店B",...]
  complete boolean not null default false, -- true=全ページ取得済 / false=途中で対象発見し打ち切り
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (keyword, lat_key, lng_key, month)
);

create index if not exists idx_grid_search_cache_month on grid_search_cache (month);

-- サーバー(service role)からのみアクセスするため RLS 有効化・ポリシーなし
alter table grid_search_cache enable row level security;
