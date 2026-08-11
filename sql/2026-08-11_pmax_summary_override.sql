-- P-MAXレポート「まとめ」ページの手動編集（AI生成文の直接上書き）を永続保存する列
-- 空文字/NULL = 上書きなし（AI生成文をそのまま使う）。数値の手動編集（overrides列）と同じ
-- テーブル（pmax_report_settings）に同居させ、既存の読み込み・保存経路を流用する

ALTER TABLE public.pmax_report_settings
  ADD COLUMN IF NOT EXISTS summary_override TEXT;
