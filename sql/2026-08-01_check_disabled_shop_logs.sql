-- C-1の確認: 順位計測の対象外にした店舗に「全地点圏外」のログが入っていないか
--
-- 【背景】
-- 実測API(POST /api/report/grid-ranking)は rank_tracking_disabled を見て拒否するが、
-- 保存API(PUT)には同じ門番が無い。クライアントはPOSTが失敗した地点を rank:0（圏外）
-- として扱い、そのままPUTで保存してしまう。その結果、実測していない店舗に
-- 「全地点圏外」のログが残り、レポートに架空の圏外が出るおそれがある。
--
-- 【型について】
-- shops.id は uuid、grid_ranking_logs.shop_id は text のため ::text でそろえる
-- （このリポジトリの既存SQL sql/2026-06-10_p1_db_cleanup.sql と同じ流儀）。

SELECT
  l.id                                   AS ログID,
  s.name                                 AS 店舗名,
  l.keyword                              AS キーワード,
  l.measured_at                          AS 計測日時,
  jsonb_array_length(l.results::jsonb)   AS 地点数
FROM grid_ranking_logs l
JOIN shops s ON s.id::text = l.shop_id::text
WHERE s.rank_tracking_disabled = true
  AND l.measured_at >= '2026-08-01'
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(l.results::jsonb) r
    WHERE (r->>'rank')::int > 0
  )
ORDER BY l.measured_at DESC;

-- 0件なら汚染なし。
-- 該当行が出た場合は、ログIDを控えたうえで削除する:
--   DELETE FROM grid_ranking_logs WHERE id IN ('...','...');
