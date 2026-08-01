-- 順位計測の対象外に「理由」を持たせる
--
-- 【背景】
-- 「MEOマスタに契約中として載っている店舗だけ順位計測する」方針になった。
-- マスタに無い店舗（DB608件に対しマスタ398行なので約220件）や、
-- 解約・停止中の店舗も計測対象から外れる。
--
-- ここで理由を持たせないと、手動で外したエミナル(124件)と
-- マスタ由来の除外が混ざり、「なぜこの店舗が対象外なのか」が分からなくなる。
-- さらに、同期のたびに手動指定が上書きされる事故も起きる。
--
--   'manual' … 人が明示的に対象外にした（エミナル等）。同期では触らない
--   'master' … MEOマスタが契約中でない（解約/停止中/マスタ未掲載）。同期が自動管理
--   NULL     … 対象外ではない

ALTER TABLE shops ADD COLUMN IF NOT EXISTS rank_tracking_reason text;

COMMENT ON COLUMN shops.rank_tracking_reason IS
  '順位計測を対象外にした理由。manual=手動指定（同期で変更しない） / master=MEOマスタが契約中でない（同期が自動管理） / NULL=対象外ではない';

-- 既に対象外になっている店舗（エミナル124件）は手動指定として扱う。
-- これをやらないと、次回の同期で「マスタは契約中なので対象に戻す」と判断され、
-- せっかく外したエミナルが計測対象に戻ってしまう
UPDATE shops
   SET rank_tracking_reason = 'manual'
 WHERE rank_tracking_disabled = true
   AND rank_tracking_reason IS NULL;

CREATE INDEX IF NOT EXISTS idx_shops_rank_reason
  ON shops (rank_tracking_reason)
  WHERE rank_tracking_reason IS NOT NULL;
