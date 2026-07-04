-- P-MAXレポート「まとめ」AI文章のキャッシュ
-- 目的: 同じ店舗×同じ月×同じKPIデータなら再生成しない（Claude API費用¥0 + 文面が固定される）
--       KPIハッシュが変わったら（データ再同期等）自動で作り直す
-- 実行: Supabase SQL Editor で実行（冪等）

create table if not exists pmax_summary_cache (
  id uuid primary key default gen_random_uuid(),
  shop_key text not null,          -- 店舗名
  month text not null,             -- 'YYYY-MM'
  kpi_hash text not null,          -- KPIデータ+プロンプト版のSHA-256（変更検知用）
  summary_text text not null,      -- 生成済みの「まとめ」文章
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_key, month)
);

-- サーバー(service role)からのみアクセスするため RLS 有効化・ポリシーなし
alter table pmax_summary_cache enable row level security;
