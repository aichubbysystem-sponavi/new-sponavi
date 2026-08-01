-- レポート一覧の★（お気に入り）を全社共有にする
--
-- 【背景】
-- ★は report-list-client.tsx の localStorage("report-favorites") にしか
-- 保存されておらず、他ユーザーに共有されないどころか、
-- 端末・ブラウザ・サブドメイン(report. と メインドメイン)が変わるだけで消えていた。
--
-- 【方針】
-- 「全社で1つの★」にする。誰かが付けたら全員に見える。
-- 店舗の識別子は店舗名（ShopListItem.id が店舗名のため。重要ナレッジ参照）。

CREATE TABLE IF NOT EXISTS report_favorites (
  shop_name   text PRIMARY KEY,
  created_by  text,                                   -- 付けた人（監査・表示用）
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE report_favorites IS 'レポート一覧の★。全ユーザーで共有する重点店舗リスト';
COMMENT ON COLUMN report_favorites.shop_name IS '店舗名（ShopListItem.id と同じ値）';

-- 一覧取得は常に全件なので追加インデックスは不要（PKで足りる）

-- RLS: service_role 経由のAPIからのみ読み書きする。
-- anon/authenticated に直接触らせない（他のクライアント系テーブルと同じ方針）
ALTER TABLE report_favorites ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'report_favorites' AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY service_role_all ON report_favorites
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

REVOKE ALL ON report_favorites FROM anon, authenticated;
