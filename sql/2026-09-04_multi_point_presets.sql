-- 2026-09-04 多地点(5地点)計測店舗の入れ替え（シート「Chubbyシートまとめ」K列=契約中 準拠）
begin;

-- A. 5地点プリセット追加（keywordはNULL=初回一括計測のPhase2で順位シートから取得）
insert into grid_ranking_presets (shop_id, shop_name, keyword, grid_size) values ('634d8249-7a8c-4796-a6ed-8380f58643ee', '高宮 とびこ', null, 3) on conflict (shop_id) do nothing; -- シート名: 高宮 とびこ
insert into grid_ranking_presets (shop_id, shop_name, keyword, grid_size) values ('b962a760-09b7-4c0b-ba27-959a1325e636', '創作料理が自慢の宿 会津 喜多方 熱塩温泉 山形屋', null, 3) on conflict (shop_id) do nothing; -- シート名: 熱塩温泉 山形屋
insert into grid_ranking_presets (shop_id, shop_name, keyword, grid_size) values ('076e62c7-ffd8-463c-aa57-2a83f8a8dc76', 'キャバクラMandarin Club（マンダリンクラブ）札幌 すすきの', null, 3) on conflict (shop_id) do nothing; -- シート名: キャバクラMandarin Club（マンダリンクラブ）
insert into grid_ranking_presets (shop_id, shop_name, keyword, grid_size) values ('9c6e7cb3-edcb-4725-959b-5f2d2a98f5b0', 'キャバクラ MONSOON Cafe（モンスーンカフェ）札幌', null, 3) on conflict (shop_id) do nothing; -- シート名: キャバクラ MONSOON Cafe（モンスーンカフェ）札幌 すすきの
insert into grid_ranking_presets (shop_id, shop_name, keyword, grid_size) values ('a6c0c91b-b3cd-4c00-8af3-8c9465b16b09', 'ニュークラブFour Seasons札幌 すすきの キャバクラ', null, 3) on conflict (shop_id) do nothing; -- シート名: ニュークラブFour Seasons
insert into grid_ranking_presets (shop_id, shop_name, keyword, grid_size) values ('10220198-ddf9-42de-87da-256a4267ea35', 'ニュークラブ NOBLE （ノーブル）札幌', null, 3) on conflict (shop_id) do nothing; -- シート名: ニュークラブ NOBLE （ノーブル）
insert into grid_ranking_presets (shop_id, shop_name, keyword, grid_size) values ('049c2a92-e077-49b2-bfce-153ed5431314', 'キラキらふてる石川', null, 3) on conflict (shop_id) do nothing; -- シート名: キラキらふてる石川
insert into grid_ranking_presets (shop_id, shop_name, keyword, grid_size) values ('867a169b-e068-4ac9-b0c7-d51075d5fa41', 'WHITE NAIL 栄店 ホワイトネイル', null, 3) on conflict (shop_id) do nothing; -- シート名: WHITE NAIL 栄店 ホワイトネイル
insert into grid_ranking_presets (shop_id, shop_name, keyword, grid_size) values ('52692a8a-e8ee-44ac-855e-e43fdde6c4c9', '個室シーシャLuxia', null, 3) on conflict (shop_id) do nothing; -- シート名: 個室シーシャLuxia
insert into grid_ranking_presets (shop_id, shop_name, keyword, grid_size) values ('6da67456-93ee-409a-a52b-488881c24812', 'SPICE CURRY CEYLON HOUSE', null, 3) on conflict (shop_id) do nothing; -- シート名: CEYLON HOUSE スリランカ・ロゼカレー
insert into grid_ranking_presets (shop_id, shop_name, keyword, grid_size) values ('89897bec-2e50-494f-b38f-1024262660a1', '歯のホワイトニング専門店WHITE 奈良桜井店', null, 3) on conflict (shop_id) do nothing; -- シート名: 歯のホワイトニング専門店WHITE 奈良桜井店
insert into grid_ranking_presets (shop_id, shop_name, keyword, grid_size) values ('eed0acf0-46e9-4327-b3b8-0d19ccace129', '焼肉 永昌', null, 3) on conflict (shop_id) do nothing; -- シート名: 焼肉 永昌
insert into grid_ranking_presets (shop_id, shop_name, keyword, grid_size) values ('127d8775-2e07-4471-827c-50ef9a6a2698', '701 TARESOBA OKINAWA', null, 3) on conflict (shop_id) do nothing; -- シート名: 701 TARESOBA OKINAWA
insert into grid_ranking_presets (shop_id, shop_name, keyword, grid_size) values ('3d890a10-be61-439b-95ad-7a28e810af2f', '山本のハンバーグ京都河原町店', null, 3) on conflict (shop_id) do nothing; -- シート名: 山本のハンバーグ京都河原町店
insert into grid_ranking_presets (shop_id, shop_name, keyword, grid_size) values ('fe372635-bcbf-425f-aea8-7a9453db8b22', 'とりやき酒場 鶏ん家 札幌麻生店', null, 3) on conflict (shop_id) do nothing; -- シート名: とりやき酒場 鶏ん家 札幌麻生店
insert into grid_ranking_presets (shop_id, shop_name, keyword, grid_size) values ('63ff39f9-5c23-4a01-b553-2c95812af9ef', '唯の焼肉屋。', null, 3) on conflict (shop_id) do nothing; -- シート名: 唯の焼肉屋。
insert into grid_ranking_presets (shop_id, shop_name, keyword, grid_size) values ('335dcd48-f9e6-4882-9f57-576c854ed0f9', 'アイブロウ専門店iBROW.浜松駅前店', null, 3) on conflict (shop_id) do nothing; -- シート名: アイブロウ専門店iBROW.浜松駅前店
insert into grid_ranking_presets (shop_id, shop_name, keyword, grid_size) values ('a691dab3-be67-4b7d-a01d-7eaaac170785', 'カネマス弥平とうふ店 KANEMASU YAHEI TOFU', null, 3) on conflict (shop_id) do nothing; -- シート名: カネマス弥平とうふ店

-- B. 計測対象外フラグ解除（上記のうち rank_tracking_disabled=true の店舗。reason=master はMEOマスタ同期の誤フラグ）
update shops set rank_tracking_disabled=false, rank_tracking_reason=null where id in ('634d8249-7a8c-4796-a6ed-8380f58643ee', 'b962a760-09b7-4c0b-ba27-959a1325e636', '076e62c7-ffd8-463c-aa57-2a83f8a8dc76', '9c6e7cb3-edcb-4725-959b-5f2d2a98f5b0', 'a6c0c91b-b3cd-4c00-8af3-8c9465b16b09', '10220198-ddf9-42de-87da-256a4267ea35', '049c2a92-e077-49b2-bfce-153ed5431314', '867a169b-e068-4ac9-b0c7-d51075d5fa41', '89897bec-2e50-494f-b38f-1024262660a1', 'eed0acf0-46e9-4327-b3b8-0d19ccace129', '127d8775-2e07-4471-827c-50ef9a6a2698', '3d890a10-be61-439b-95ad-7a28e810af2f', 'fe372635-bcbf-425f-aea8-7a9453db8b22', '63ff39f9-5c23-4a01-b553-2c95812af9ef', '335dcd48-f9e6-4882-9f57-576c854ed0f9', 'a691dab3-be67-4b7d-a01d-7eaaac170785');

-- C. 5地点プリセット削除（シートで契約中でない店舗。実測ログ grid_ranking_logs は残る）
-- C-解約: 32件
delete from grid_ranking_presets where grid_size<>1 and shop_id in ('ed8082aa-45dd-4c65-96af-78cc30094b38', '01db57ea-7e94-4d03-b094-68fe60dec429', '1b8c6cd8-4055-4ed9-85a2-62e7718fdcbb', '7a1e07b5-558d-427f-b052-69fce5ea77b4', '9a29efe5-7546-417a-bb79-7a8c39c7eb34', '5da31f74-5f8b-44a1-944c-a7ab26586ed6', 'e96c6f03-1cae-403c-b4c3-d02d20d4e87b', '5cc64906-ca10-4b8d-80a9-717d95a4371b', 'e31858f8-82e8-47c1-a065-80723b82fb4b', '5dc6231c-fb0f-4c0a-b0f2-32ead6070937', '2566e12e-17b1-43c3-8431-2badaccdefd5', 'dd0e089f-7ac1-42ea-b3f9-006c09998335', '24240585-432d-45cd-ae0e-2232924d71c2', '2494ac41-81c4-4f9a-ba3d-da00d4634e65', '5c39acb6-3e8b-45aa-96ac-0f9fa6a1e35c', '8a60c9aa-d69f-4d72-b854-1b14866dc875', 'be1d6c11-0a77-4455-a823-3ba8678d30f7', '3e267d41-ef91-47ce-a423-fa8b00bcb2b5', 'fa8be973-cb02-4245-b9c4-2063151ecfff', '25552c16-339a-418e-80d0-e137576d6e8c', '02746191-3c7c-49ad-937e-eac109c2f7de', '3040cc57-57d3-4389-9c34-4fff7d5cea8a', '0d0c20ee-51dd-4562-b0bd-fda39247639e', '1d83f531-087a-48fd-841a-c1583212b281', '22af901d-a23c-422d-a7b6-e028d74f14eb', '6c795de7-6a5e-4565-a34c-ba3a3e7647a4', '11533a84-abe4-43b7-94e8-7b2d2eeddff9', 'c2059273-34e9-4551-8fc6-6d455e159cd0', '80a895d1-4601-47c1-a863-3117eb57255f', 'd6584c08-cc90-401b-8820-2f617ae5146f', '670de19a-2c35-4b35-b6aa-4698a0312869', 'ca21facb-b271-4cf1-ab56-6e3763718671');
-- C-停止中: 3件
delete from grid_ranking_presets where grid_size<>1 and shop_id in ('d904cf97-2753-4e66-b80d-b2dccb17b04c', '3fce55af-3f2e-44f6-97d9-000cba8dbc6b', '295eb650-f184-4ca2-ba9b-c04aad32002c');
-- C-その他（シートに無い/ステータス空欄）: 8件 → 要判断のためコメントアウト
-- delete from grid_ranking_presets where grid_size<>1 and shop_id = '8a32cf73-2072-48d0-9afc-fbd51d9d18f3'; -- FACES 麻布十番 (シート: 空欄)
-- delete from grid_ranking_presets where grid_size<>1 and shop_id = 'a27098c7-7605-4707-a1fd-0ab395cae992'; -- GYMTY BAR 本町店 (シート: 空欄)
-- delete from grid_ranking_presets where grid_size<>1 and shop_id = 'e7438788-c504-4a6d-b8dc-58ffc376cb0c'; -- Shisha BAR Who's (シート: 空欄)
-- delete from grid_ranking_presets where grid_size<>1 and shop_id = '2e4ad39b-12ff-4f4f-a9e8-564091dfa2b3'; -- Shisha café & bar Power spot 梅田店 (シート: 未掲載)
-- delete from grid_ranking_presets where grid_size<>1 and shop_id = 'a1a5f1c7-944f-47a5-b380-b3dfd8a3f47d'; -- shisha&夜パフェ L-mona (シート: 空欄)
-- delete from grid_ranking_presets where grid_size<>1 and shop_id = '01f03021-ac5d-409b-ace5-d8843f307efd'; -- sucre nail. nailsalon & school (シート: 空欄)
-- delete from grid_ranking_presets where grid_size<>1 and shop_id = '8bf5b63e-cbdd-40aa-8252-065eaf726280'; -- チェルキオ ・レガーメ・コンパーニョ (シート: 空欄)
-- delete from grid_ranking_presets where grid_size<>1 and shop_id = '5b03dff7-760f-404b-953e-9ad36094fd11'; -- 日本料理 矢の (シート: 空欄)

-- 確認
select grid_size, count(*) from grid_ranking_presets group by 1 order by 1;
commit;
