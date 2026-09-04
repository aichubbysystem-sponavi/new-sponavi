-- シート自動投稿を「ジョブ方式」にする（タイムアウト根本対策）
--
-- 背景: 2026-09-04 の80店舗写真投稿で、ブラウザ→API の1リクエスト（10店舗・上限180秒）が
-- バッチ1でタイムアウトし、残り70店舗が未処理のまま「完了」表示になった。
-- 300店舗×3枚を一気に流す運用では、ブラウザが長い通信を待つ構造そのものが成り立たない。
--
-- 新方式:
--   1. 画面は「ジョブ」を1件登録するだけ（数秒で返る）
--   2. /api/cron/auto-post-worker が店舗名リストを数店舗ずつ処理し、進捗を cursor に保存
--      （関数上限300秒の手前で自分を再起動して続き、毎分のcronが保険で拾う）
--   3. 画面はジョブをポーリングして進捗・結果を表示。タブを閉じても処理は続く
--
-- 適用: 本番Supabase SQL Editor で実行。

CREATE TABLE IF NOT EXISTS auto_post_jobs (
  id            uuid PRIMARY KEY,
  mode          text NOT NULL,                       -- check（事前チェック）/ schedule（予約登録）/ immediate（即時=今すぐの予約として登録し cron が投稿）
  status        text NOT NULL DEFAULT 'queued',      -- queued / running / done / error / cancelled
  sheet_id      text NOT NULL,
  target_date   text NOT NULL,                       -- 画面の対象日 "2026-09-04"
  topic_type    text NOT NULL DEFAULT 'STANDARD',
  schedule_at   timestamptz NOT NULL,                -- 投稿予定時刻（immediate は作成時刻）
  shop_names    jsonb NOT NULL,                      -- 処理対象のシートB列店舗名（プレビュー時点の順序で固定）
  total         integer NOT NULL,                    -- shop_names の件数
  cursor        integer NOT NULL DEFAULT 0,          -- 次に処理する shop_names の位置
  posted        integer NOT NULL DEFAULT 0,          -- 登録成功（check は登録可能）件数
  errors        integer NOT NULL DEFAULT 0,          -- スキップ/エラー件数
  target_label  text,                                -- 画面表示用「選択した80店舗のみ」など
  lease_until   timestamptz,                         -- ワーカーの占有期限。過ぎていれば別のワーカーが引き継ぐ
  last_error    text,
  created_by    text,                                -- 作成者（user_profiles.name）
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_auto_post_jobs_status_created ON auto_post_jobs (status, created_at DESC);

-- 店舗ごとの結果（画面の結果一覧そのもの。data に API レスポンスの1行をそのまま入れる）
CREATE TABLE IF NOT EXISTS auto_post_job_items (
  id          uuid PRIMARY KEY,
  job_id      uuid NOT NULL REFERENCES auto_post_jobs(id) ON DELETE CASCADE,
  seq         integer NOT NULL,                      -- 表示順（処理順）
  shop_name   text NOT NULL,
  status      text NOT NULL,                         -- 予約登録成功 / 保留（要確認） / 写真なし（スキップ） など
  data        jsonb NOT NULL,                        -- warnings / detail / savedSummary / check 等を含む結果行
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auto_post_job_items_job ON auto_post_job_items (job_id, seq);

-- 他のクライアント系テーブルと同じく RLS 有効。書き込みは service role のみ（APIルート経由）
ALTER TABLE auto_post_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE auto_post_job_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auto_post_jobs_read ON auto_post_jobs;
CREATE POLICY auto_post_jobs_read ON auto_post_jobs FOR SELECT USING (true);
DROP POLICY IF EXISTS auto_post_job_items_read ON auto_post_job_items;
CREATE POLICY auto_post_job_items_read ON auto_post_job_items FOR SELECT USING (true);
