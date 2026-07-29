-- レポート「口コミの競合比較（同エリア）」ページ用
-- 月次で同エリア・同KWの上位20店舗（評価・口コミ数）を保存する
-- デプロイ前に本番Supabase (kxxwspavskhhjtiixcep) SQL Editor で手動実行
CREATE TABLE IF NOT EXISTS competitor_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_name text NOT NULL,
  month text NOT NULL,              -- "2026/7"（表示月ラベルと同形式）
  keyword text NOT NULL,            -- 検索に使ったKW
  self jsonb,                       -- { name, rating, reviewCount, rank } rank=リスト内順位(1-20)、リスト外はnull
  competitors jsonb NOT NULL,       -- [{ name, rating, reviewCount }] 上位20（自店含む・API順）
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_name, month)
);

-- RLS: 2026-07-07監査方針に合わせ authenticated SELECT のみ（書き込みはservice_role=サーバーAPI経由）
ALTER TABLE competitor_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS competitor_reviews_select ON competitor_reviews;
CREATE POLICY competitor_reviews_select ON competitor_reviews FOR SELECT TO authenticated USING (true);
