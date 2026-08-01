-- 口コミ競合比較が「取得済みなのにレポートに出ない」原因の確認
--
-- 【確認済み】月キーの表記ゆれは無し（2026/6・2026/7 のみ）。当初の疑いは外れ。
--
-- 【次の疑い】競合が0件だとページごと非表示になる
-- レポート側は「自店以外が1件も無ければ比較として成立しない」として
-- ページを出さない（client.tsx の competitorRivalCount > 0 判定）。
-- 検索KWが絞り込みすぎ（例:「堀江 冷麺」）だと Places の結果が自店のみになり、
-- 保存はされている（＝再取得しても課金0件）のにレポートには出ない、という状態になる。

SELECT
  shop_name                                  AS 店舗名,
  month                                      AS 月,
  keyword                                    AS 検索KW,
  jsonb_array_length(competitors)            AS 取得件数,
  self ->> 'name'                            AS 自店,
  (self ->> 'rank')::int                     AS 自店順位,
  -- レポートに出る条件。false ならページは表示されない
  (jsonb_array_length(competitors) - CASE WHEN self IS NULL THEN 0 ELSE 1 END) > 0 AS レポート表示,
  created_at                                 AS 取得日時
FROM competitor_reviews
ORDER BY month DESC, shop_name;

-- 【読み方】
-- 取得件数が 1 で自店だけ → 競合0件。KWが絞り込みすぎなので、
--   管理画面の「メインKW」をもっと一般的な語（例:「堀江 焼肉」）に変えて再取得する。
-- 取得件数が 20 なのに出ない → 表示条件は満たしているので別原因。月の指定を確認する。
