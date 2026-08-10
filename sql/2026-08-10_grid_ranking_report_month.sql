-- grid_ranking_logs に帰属月カラム report_month を追加
--
-- 背景: 月初（毎月1日）に計測する順位は「前月分レポート」の値だが、
-- 従来は measured_at の月をそのままレポート月として表示していたため、
-- 7/1計測が「7月分」に載っていた。手動データ(grid_ranking_overrides)は
-- 運用者が既に前月として入力しており、コード解釈だけがズレていた。
--
-- 帰属ルール: JSTで計測日が1〜3日 → 前月 / 4日以降 → 当月
-- （月中の臨時計測を誤って前月に入れないため。運用は毎月1〜2日計測）
--
-- measured_at（計測時刻＝事実）は一切変更しない。読み取り側は
-- report_month があればそれを使い、無ければ従来通り measured_at から導出。
-- 2026-08-10 実行済み（backfill 5,064件 / うち前月へ移動 4,705件）

alter table grid_ranking_logs add column if not exists report_month text;

update grid_ranking_logs
set report_month =
  case when extract(day from measured_at at time zone 'Asia/Tokyo') <= 3
    then to_char((date_trunc('month', measured_at at time zone 'Asia/Tokyo') - interval '1 month'), 'YYYY/FMMM')
    else to_char(measured_at at time zone 'Asia/Tokyo', 'YYYY/FMMM')
  end
where report_month is null;

-- 検証: ルール導出と全件一致すること（0件であること）
-- select count(*) from grid_ranking_logs
-- where report_month is distinct from
--   case when extract(day from measured_at at time zone 'Asia/Tokyo') <= 3
--     then to_char((date_trunc('month', measured_at at time zone 'Asia/Tokyo') - interval '1 month'), 'YYYY/FMMM')
--     else to_char(measured_at at time zone 'Asia/Tokyo', 'YYYY/FMMM')
--   end;
