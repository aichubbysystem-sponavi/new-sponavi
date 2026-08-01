-- 店舗の「停止中」状態と「順位計測しない」フラグを追加
--
-- 【背景1: 停止中】
-- MEOマスタ（スプレッドシート）のB列は 契約中 / 解約 / 停止中 の3種類だが、
-- システム側には shops.cancelled_at（解約）しか無く、停止中を表現できなかった。
-- 解約と同じ扱いにしてしまうと再開時に区別がつかないため、別列にする。
--
-- 【背景2: 順位計測しない】
-- エミナルクリニックは122店舗あるが全店とも順位計測しない。
-- 誤って「いつもの店舗」に追加され一括計測が走ると、
-- 1店舗あたり5地点×キーワード数の課金が122件分発生する。
-- フラグで構造的に止める。

-- 停止中（再開しうる一時停止）。解約(cancelled_at)とは別管理
ALTER TABLE shops ADD COLUMN IF NOT EXISTS paused_at timestamptz;
COMMENT ON COLUMN shops.paused_at IS '停止中になった日時。NULLなら停止していない。解約(cancelled_at)とは区別する';

-- 順位計測の対象外フラグ
ALTER TABLE shops ADD COLUMN IF NOT EXISTS rank_tracking_disabled boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN shops.rank_tracking_disabled IS 'true の店舗は多地点順位計測の対象外。プリセット追加と実測APIで拒否される';

-- 稼働店舗の抽出（cancelled_at IS NULL AND paused_at IS NULL）が頻出するため
CREATE INDEX IF NOT EXISTS idx_shops_active
  ON shops (cancelled_at, paused_at)
  WHERE cancelled_at IS NULL AND paused_at IS NULL;

-- 計測対象の抽出用
CREATE INDEX IF NOT EXISTS idx_shops_rank_tracking
  ON shops (rank_tracking_disabled)
  WHERE rank_tracking_disabled = true;
