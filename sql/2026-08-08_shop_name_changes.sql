-- GBP上の店名変更の履歴
--
-- 目的: GBP側で店名が変わったことを後から追跡できるようにする。
--       shops.name（システム全体の結合キー）は変更しないため、
--       「いつ・どの店が・何から何に変わったか」を残す唯一の記録になる。
--
-- 書き込みは lib/gbp-shop-sync.ts（service_role）からのみ。
-- テーブルが無くても同期処理は失敗しない設計にしてあるが、
-- 履歴が残らないので本番SQL Editorで必ず実行すること。

create table if not exists public.shop_name_changes (
  id            uuid primary key default gen_random_uuid(),
  shop_id       text not null,
  shop_name     text not null,          -- 検知時点の shops.name（結合キー）
  location_id   text,                   -- "locations/XXXX"
  old_gbp_name  text,
  new_gbp_name  text not null,
  detected_at   timestamptz not null default now()
);

create index if not exists idx_shop_name_changes_shop_id
  on public.shop_name_changes (shop_id);
create index if not exists idx_shop_name_changes_detected_at
  on public.shop_name_changes (detected_at desc);

-- RLS: anon からの読み書きを遮断し、ログイン済みユーザーの参照のみ許可する。
-- （service_role は RLS をバイパスするのでサーバー側の書き込みは通る）
-- 参考: 重要ナレッジ「rowsecurity=true だけでは安全ではない。roles={public} を必ず潰す」
alter table public.shop_name_changes enable row level security;

drop policy if exists "shop_name_changes_select_authenticated" on public.shop_name_changes;
create policy "shop_name_changes_select_authenticated"
  on public.shop_name_changes
  for select
  to authenticated
  using (true);
