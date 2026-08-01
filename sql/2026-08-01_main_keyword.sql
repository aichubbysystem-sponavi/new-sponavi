-- メインキーワードを明示的に設定できるようにする
--
-- 【背景】
-- 口コミの競合比較（レポートP14）は1キーワードだけで検索するが、
-- competitor-fetch.ts:93 が keywords[0]（配列の先頭）を無条件で使っていた。
--   keyword = (kwRow?.keywords || [])[0] || "";
-- つまり「選ばれている」のではなく「並び順で決まっている」状態で、
-- シート側の並びが変わると競合比較の対象キーワードも黙って変わる。
--
-- main_keyword に指定があればそれを使い、無ければ従来どおり先頭を使う。
-- 既存店舗は NULL なので動作は変わらない。

ALTER TABLE shop_keywords ADD COLUMN IF NOT EXISTS main_keyword text;

COMMENT ON COLUMN shop_keywords.main_keyword IS
  '競合比較などで使うメインキーワード。NULLなら keywords[0] を使う（従来動作）';
