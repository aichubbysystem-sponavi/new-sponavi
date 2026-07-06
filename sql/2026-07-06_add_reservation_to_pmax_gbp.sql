-- P-MAXレポートの「予約」指標（数値はGBPシートM列「注文」由来、ラベルは予約）
-- 実行タイミング: デプロイ後、本番SupabaseのSQL Editorで実行 → /api/pmax/sync 再実行で値が入る
-- （未実行でもアプリは動作する。カラムが無い間はsyncのGBP書込が失敗し予約=0表示のまま）

ALTER TABLE public.pmax_gbp_data
  ADD COLUMN IF NOT EXISTS reservation BIGINT DEFAULT 0;
