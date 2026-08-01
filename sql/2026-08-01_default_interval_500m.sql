-- 計測地点の距離を全店舗500mに揃える
--
-- 【前提】
-- コード側の既定値は 1000m → 500m に変更済み。
-- ただし既定値が効くのは shops.grid_interval_m が NULL の店舗だけで、
-- 過去に画面で距離を保存した店舗には明示値（多くは1000）が入っている。
-- そのため、既存の保存値もリセットする必要がある。
--
-- 【実行前に確認】
-- 現状の分布を見てから実行すること。意図的に3km等へ広げた店舗があれば、
-- この UPDATE でその設定も失われる。
--
--   SELECT COALESCE(grid_interval_m, 0) AS interval_m, COUNT(*)
--     FROM shops GROUP BY 1 ORDER BY 1;
--   （interval_m = 0 の行は「未設定＝既定値を使用」）

-- 保存済みの値を消して既定値(500m)に委ねる。
-- 明示的に500を入れるのではなくNULLにすることで、
-- 今後さらに既定値を変えたときに全店舗へ自動追随できる
UPDATE shops
   SET grid_interval_m = NULL
 WHERE grid_interval_m IS NOT NULL;

-- 確認: 全て NULL（＝既定500m）になっていること
-- SELECT COUNT(*) FILTER (WHERE grid_interval_m IS NOT NULL) AS 明示設定が残る店舗数 FROM shops;
