-- シート自動投稿（予約登録）で登録できなかった行の理由を永続化する
--
-- 背景: 2026-08-28 の40店舗実行で17店舗が予約されなかったが、スキップ理由は
-- APIレスポンス（画面を閉じると消える）にしか無く、後から原因を追えなかった。
-- 300店舗×3枚規模では画面の結果一覧だけでは追い切れないため、DBに残す。
--
-- 適用: 本番Supabase SQL Editor で実行。
--       テーブルが無い間は auto-post/route.ts が console.error を出すだけで予約登録自体は成立する
--       （画面の「登録時スキップ」一覧が空のままになるだけ）。

CREATE TABLE IF NOT EXISTS auto_post_skips (
  id           uuid PRIMARY KEY,
  scheduled_at timestamptz NOT NULL,          -- 予約登録しようとした投稿時刻（実行回の識別キー）
  target_date  text NOT NULL,                 -- 画面の対象日（写真投稿の月内番号の元）
  topic_type   text NOT NULL DEFAULT 'STANDARD',
  shop_name    text NOT NULL,                 -- シートB列の店舗名（shopsに無い店舗も記録するため文字列）
  reason       text NOT NULL,                 -- 写真なし / 写真URL変換失敗 / 店舗未登録 / DB保存エラー など
  detail       text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auto_post_skips_created ON auto_post_skips (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auto_post_skips_sched   ON auto_post_skips (scheduled_at);

-- 他のクライアント系テーブルと同じく RLS 有効。読み取りは anon 可（画面で一覧表示）／書き込みは service role のみ
ALTER TABLE auto_post_skips ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auto_post_skips_read ON auto_post_skips;
CREATE POLICY auto_post_skips_read ON auto_post_skips FOR SELECT USING (true);
