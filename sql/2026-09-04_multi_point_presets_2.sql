-- 2026-09-04 追記: GBPアカウント同期で新規登録された店舗のうち、シート契約中の2店を5地点プリセットへ追加
begin;
insert into grid_ranking_presets (shop_id, shop_name, keyword, grid_size) values ('8e0c3c8a-9ba3-4b6d-a894-fdc5b8d8c795', '北海道炉端アカオニ', null, 3) on conflict (shop_id) do nothing;
insert into grid_ranking_presets (shop_id, shop_name, keyword, grid_size) values ('605c082b-8c4b-424e-9209-521edadcfde6', 'うまそうなラーメン屋ジャンク店 Guilty pleasure ramen', null, 3) on conflict (shop_id) do nothing;
select grid_size, count(*) from grid_ranking_presets group by 1 order by 1;
commit;
