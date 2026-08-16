-- =====================================================================
-- レポート「先月の実施内容」用: GBP投稿の実績テーブル  2026-08-15
-- =====================================================================
-- なぜ post_logs では駄目か（実測）:
--   post_logs はこのシステム経由の投稿しか記録していない。
--   2026-07 実績: post_logs = 48件 / 10店舗 に対し、口コミ返信は 279店舗で発生。
--   実際にGBPを見ると post_logs に無い投稿が毎月入っている
--   （例: 不用品回収のキラキらっこ 栃木店は 2026-07 に8投稿あるが post_logs は0件）。
--   → 投稿数はGBP側を正とする必要があるため、localPosts一覧を同期して保存する。
--
-- URLを信用しない設計:
--   GBPの googleUrl は永続URLではなく数日で403になる（2026-08-09の調査参照）。
--   さらにメディアのリソース名自体もGoogle側で付け替えられることがある。
--   → このテーブルには「件数と本文などの実績」だけを保存し、
--     レポートに出す画像URLは表示時にGBPから取り直す（保存したURLは参考値）。
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.gbp_posts (
  post_name    TEXT PRIMARY KEY,          -- accounts/{a}/locations/{l}/localPosts/{p}
  shop_id      TEXT NOT NULL,
  shop_name    TEXT NOT NULL,
  create_time  TIMESTAMPTZ NOT NULL,
  update_time  TIMESTAMPTZ,
  topic_type   TEXT,                      -- STANDARD / EVENT / OFFER / ALERT
  state        TEXT,                      -- LIVE / REJECTED など
  summary      TEXT,
  search_url   TEXT,
  media_name   TEXT,                      -- 代表写真のリソース名（accounts/.../media/localPosts/{id}）
  media_format TEXT,                      -- PHOTO / VIDEO
  media_url    TEXT,                      -- 取得時点のgoogleUrl。失効前提の参考値
  synced_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gbp_posts_shop_time
  ON public.gbp_posts (shop_id, create_time DESC);
CREATE INDEX IF NOT EXISTS idx_gbp_posts_shop_name_time
  ON public.gbp_posts (shop_name, create_time DESC);

-- RLS: クライアントから直接読ませない（レポートはサーバーAPI=service_role経由で読む）。
-- ポリシーを作らない = anon / authenticated は全遮断。service_role はRLSをBYPASSする。
ALTER TABLE public.gbp_posts ENABLE ROW LEVEL SECURITY;

-- 口コミ返信件数の集計用（shop_id + reply_time の範囲検索）。
-- reviews は16万件あり、shop_name にインデックスが無かった時に statement timeout で
-- 「口コミなし」になった前例がある（2026-07-15）。返信集計でも同じ轍を踏まないよう先に張る。
-- ※ CONCURRENTLY はトランザクション内で実行できないため、SQL Editorでは
--    この文だけを単独で実行すること。
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reviews_shop_id_reply_time
  ON public.reviews (shop_id, reply_time DESC)
  WHERE reply_time IS NOT NULL;

-- =====================================================================
-- 写真ごとの閲覧数（手入力）  2026-08-15 追加
-- =====================================================================
-- Googleは写真ごとの閲覧数をAPIでも管理画面でも返さない（2026-04の調査を2026-08-15に再実測）。
-- レポートの写真一覧では閲覧数を手入力で埋める運用にするため、その置き場を用意する。
--   投稿に添付した写真 → gbp_posts.view_count
--   写真タブの写真     → media.view_count（既存列を流用）
-- 初期値は 0 ではなく NULL（＝未計測）。0件と「まだ数えていない」を区別する。
ALTER TABLE public.gbp_posts ADD COLUMN IF NOT EXISTS view_count INTEGER;

-- media.view_count は既定値0だった。同期で0が入ると手入力値と区別できないため既定値を外し、
-- 既存の0（GBPのinsightsが空で入っただけの値・意味なし）は未計測に戻す。
ALTER TABLE public.media ALTER COLUMN view_count DROP DEFAULT;
UPDATE public.media SET view_count = NULL WHERE view_count = 0;

-- 閲覧数の多い順に並べる（未計測は末尾）
CREATE INDEX IF NOT EXISTS idx_gbp_posts_shop_views
  ON public.gbp_posts (shop_id, view_count DESC NULLS LAST);

-- =====================================================================
-- 写真の実体を自前ストレージに保存する  2026-08-16 追加
-- =====================================================================
-- GBPの画像URLは数日で403になり、リソース名すら付け替えられる（2026-08-09の調査）。
-- URLを保存しても意味がないので、サムネイルの実体を Supabase Storage に取り込み、
-- レポートはそちらを見る。これで表示時にGoogleを叩かなくなり、PDFからも写真が消えない。
-- 容量: サムネイル約25KB × 全759店舗 × 月20枚 = 月375MB / 年4.5GB（Proの100GB内）
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('report-photos', 'report-photos', true, 5242880)
ON CONFLICT (id) DO UPDATE SET public = true;

ALTER TABLE public.gbp_posts ADD COLUMN IF NOT EXISTS photo_path TEXT;
ALTER TABLE public.media     ADD COLUMN IF NOT EXISTS photo_path TEXT;

-- =====================================================================
-- 検証
-- =====================================================================
-- SELECT tablename, rowsecurity FROM pg_tables
--   WHERE schemaname='public' AND tablename='gbp_posts';        -- 期待: true
-- SET ROLE anon;   SELECT count(*) FROM public.gbp_posts;       -- 期待: permission denied
-- RESET ROLE;
