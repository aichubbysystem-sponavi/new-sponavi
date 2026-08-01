-- 口コミ競合比較が「取得済みなのにレポートに出ない」原因の確認
--
-- 【疑い】
-- competitor_reviews の UNIQUE は (shop_name, month)。
-- レポート側は "2026/06" → "2026/6" に正規化してから読むのに、
-- 取得側は画面から来た値をそのまま保存していた。
-- 月キーの表記が違うと別行になり、取得済みでもレポートには出ない。

-- 1) 保存されている月キーの一覧（表記ゆれがあれば複数の形が並ぶ）
SELECT month, COUNT(*) AS 件数
FROM competitor_reviews
GROUP BY month
ORDER BY month;

-- 2) CHILLRI 堀江店の保存状況（店舗名は適宜変更）
SELECT shop_name, month, keyword, created_at
FROM competitor_reviews
WHERE shop_name LIKE '%CHILLRI%'
ORDER BY created_at DESC;

-- 【読み方】
-- 1) に "2026/6" と "2026/06" が両方あれば、表記ゆれが原因。
-- 2) で month が "2026/06" になっていれば、レポート（"2026/6" で読む）には出ない。
--
-- 【修正後の移行】
-- ゼロ埋めの行を正規化した形に寄せる（重複があれば新しい方を残す）:
--   UPDATE competitor_reviews
--      SET month = regexp_replace(month, '/0+(\d)$', '/\1')
--    WHERE month ~ '/0\d$'
--      AND NOT EXISTS (
--        SELECT 1 FROM competitor_reviews c2
--        WHERE c2.shop_name = competitor_reviews.shop_name
--          AND c2.month = regexp_replace(competitor_reviews.month, '/0+(\d)$', '/\1')
--      );
