-- scheduled_posts.approval_status を追加する
--
-- 【経緯】
-- コードは approval_status を前提に書かれていたが、本番DBにカラムが存在しなかった。
-- そのため PostgREST が
--   Could not find the 'approval_status' column of 'scheduled_posts' in the schema cache
-- を返し、以下がすべて失敗していた（画面には「変更失敗」と出る）:
--   - 予約投稿の「承認」  （approval_status='approved'）
--   - 予約投稿の「差戻し」（approval_status='rejected'）
--   - 保留中の投稿の解除 / エラー投稿の再実行
--     （scheduled-posts/route.ts:140-143 が status='pending' のとき
--       approval_status='pending' も必ず一緒に更新するため）
--
-- さらに cron/execute-posts:215 の
--   posts.filter(p => p.approval_status !== "rejected")
-- はカラムが無いと常に undefined !== "rejected" = true になり、
-- 「差戻したのに公開される」状態だった（差戻し自体が失敗するので実際には設定できない）。
--
-- 【実行場所】Supabase SQL Editor（本番）。実行後、承認・差戻し・保留解除が動くようになる。

ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS approval_status text;

COMMENT ON COLUMN scheduled_posts.approval_status IS
  'NULL=未設定 / pending=承認待ち / approved=承認済 / rejected=差戻し（cronは実行しない）';

-- 確認用
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'scheduled_posts' ORDER BY ordinal_position;
