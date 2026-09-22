-- menu_master_hotpepper_sync: brain_menusをHot Pepper Beauty現行掲載(51件相当)に同期する
--
-- 背景: 2026-09-22ユーザー承認。brain_menusは元々CustomerTypeEngine(顧客タイプ分類、
-- target_types.length===1のメニューのみを投票シグナルとして使う)のデモ用に1タイプ=1代表
-- メニューだけ入れた最小データ(20260612000006_seed_master.sql)だった。実際の店舗メニュー
-- (https://beauty.hotpepper.jp/kr/slnH000808958/coupon/)51件相当に整備する。
--
-- 方針(ユーザー承認済み):
--   1. 判断に迷う汎用オプション(マイクロカレント・エアバリ等)は role='entry'
--      + target_types=全5タイプとし、単独タイプ投票のノイズにしない。
--   2. 土日祝限定/平日限定/オーナー指名等のキャンペーン価格バリアントは統合せず、
--      Hot Pepper表示に合わせて独立行として保持する。
--   3. price=0の既存行は削除せず、Hot Pepperの新名称・実売価格でUPDATEする。
--   4. Hot Pepperに対応が見つからなかった既存3行(フェイシャルエステ60分・
--      小顔矯正オプション・保湿パック)は削除・変更せず現状維持する(過去データ整合性優先)。
--
-- 対象外(登録しない): メニュー相談・ブライダル相談・サブスク会員専用・回数券会員専用
--   (いずれも¥0の予約導線用クーポンで、施術メニューの実体を持たないため)。
--
-- role='imported_other'の行(CSV突合エンジンのフォールバック専用、40件弱)には一切触れない。

-- ─────────────────────────────────────────────────────────────
-- 1. 既存10行のUPDATE(リネーム・価格修正のみ。role/target_typesは既存のまま維持)
-- ─────────────────────────────────────────────────────────────

UPDATE public.brain_menus
   SET name = 'ヒト幹細胞ベーシック人気No.1', price = 15000
 WHERE store_id = '00000000-0000-0000-0000-000000000001' AND name = 'ヒト幹15000' AND role = 'entry';

UPDATE public.brain_menus
   SET name = '毛穴洗浄スペシャル', price = 19000
 WHERE store_id = '00000000-0000-0000-0000-000000000001' AND name = '毛穴洗浄+ヒト幹19000' AND role = 'pore';

UPDATE public.brain_menus
   SET name = '砂漠肌改善コース', price = 18000
 WHERE store_id = '00000000-0000-0000-0000-000000000001' AND name = '水素+ヒト幹18000' AND role = 'sensitive';

UPDATE public.brain_menus
   SET name = 'ハーブピーリングお試し', price = 9900
 WHERE store_id = '00000000-0000-0000-0000-000000000001' AND name = 'ハーブピーリング9900' AND role = 'peeling';

UPDATE public.brain_menus
   SET name = '小顔リフトアップ上級', price = 19000
 WHERE store_id = '00000000-0000-0000-0000-000000000001' AND name = 'EMS+小顔19000' AND role = 'lifting';

UPDATE public.brain_menus
   SET price = 3300
 WHERE store_id = '00000000-0000-0000-0000-000000000001' AND name = 'EMS' AND role = 'lifting';

UPDATE public.brain_menus
   SET name = 'ハイドラフェイシャル全顔', price = 5500
 WHERE store_id = '00000000-0000-0000-0000-000000000001' AND name = '毛穴ごっそり' AND role = 'pore';

UPDATE public.brain_menus
   SET name = 'ハイドラフェイシャル1部位', price = 3300
 WHERE store_id = '00000000-0000-0000-0000-000000000001' AND name = 'ハイドラフェイシャル' AND role = 'pore';

UPDATE public.brain_menus
   SET name = '炭酸パック(オールスキン)', price = 4400
 WHERE store_id = '00000000-0000-0000-0000-000000000001' AND name = '炭酸パック' AND role = 'pore';

UPDATE public.brain_menus
   SET price = 3600
 WHERE store_id = '00000000-0000-0000-0000-000000000001' AND name = '水素パック' AND role = 'sensitive';

-- ─────────────────────────────────────────────────────────────
-- 2. 新規36行のINSERT(idはgen_random_uuid()既定値に委ねる)
-- ─────────────────────────────────────────────────────────────

INSERT INTO public.brain_menus (store_id, name, price, role, target_types) VALUES
  -- クーポン(16件、キャンペーン価格バリアント含む)
  ('00000000-0000-0000-0000-000000000001', 'ヒト幹細胞ベーシック土日祝限定', 12000, 'entry',   ARRAY['A_acne','B_pore','C_sensitive','D_aging','E_bridal']),
  ('00000000-0000-0000-0000-000000000001', '毛穴洗浄コース土日祝限定',       16000, 'pore',    ARRAY['B_pore']),
  ('00000000-0000-0000-0000-000000000001', 'オーナー指名ベーシックコース',   15000, 'entry',   ARRAY['A_acne','B_pore','C_sensitive','D_aging','E_bridal']),
  ('00000000-0000-0000-0000-000000000001', 'オーナー指名毛穴洗浄コース',     19000, 'pore',    ARRAY['B_pore']),
  ('00000000-0000-0000-0000-000000000001', '砂漠肌乾燥改善コース',           14000, 'sensitive', ARRAY['C_sensitive']),
  ('00000000-0000-0000-0000-000000000001', 'メンズ限定毛穴洗浄',             14000, 'pore',    ARRAY['B_pore']),
  ('00000000-0000-0000-0000-000000000001', 'ハーブピーリング&幹細胞導入',    16000, 'peeling', ARRAY['A_acne']),
  ('00000000-0000-0000-0000-000000000001', '小顔リフトアップコース',         15000, 'lifting', ARRAY['D_aging']),
  ('00000000-0000-0000-0000-000000000001', 'モニター3回コース',              39000, 'entry',   ARRAY['A_acne','B_pore','C_sensitive','D_aging','E_bridal']),
  ('00000000-0000-0000-0000-000000000001', 'ヒト幹細胞ベーシック平日限定',   11000, 'entry',   ARRAY['A_acne','B_pore','C_sensitive','D_aging','E_bridal']),
  ('00000000-0000-0000-0000-000000000001', '毛穴洗浄コース平日限定',         15000, 'pore',    ARRAY['B_pore']),
  ('00000000-0000-0000-0000-000000000001', '国際顧客向けトリートメント',     24000, 'entry',   ARRAY['A_acne','B_pore','C_sensitive','D_aging','E_bridal']),
  ('00000000-0000-0000-0000-000000000001', '背中ケア夏限定',                 15000, 'entry',   ARRAY['A_acne','B_pore','C_sensitive','D_aging','E_bridal']),
  ('00000000-0000-0000-0000-000000000001', 'ハーブピーリング&幹細胞導入上級', 19800, 'peeling', ARRAY['A_acne']),
  ('00000000-0000-0000-0000-000000000001', '肌リセットコース',               21000, 'pore',    ARRAY['B_pore']),
  ('00000000-0000-0000-0000-000000000001', 'ヒト幹細胞贅沢コース',           21000, 'entry',   ARRAY['A_acne','B_pore','C_sensitive','D_aging','E_bridal']),

  -- メニュー(オプション、20件)
  ('00000000-0000-0000-0000-000000000001', 'スクライバー',                   2200, 'entry',   ARRAY['A_acne','B_pore','C_sensitive','D_aging','E_bridal']),
  ('00000000-0000-0000-0000-000000000001', 'ハーブピーリング全顔',           6600, 'peeling', ARRAY['A_acne']),
  ('00000000-0000-0000-0000-000000000001', 'ハーブピーリング+肌別パック',    8800, 'peeling', ARRAY['A_acne']),
  ('00000000-0000-0000-0000-000000000001', 'ヒト幹細胞導入(乳歯髄)',         5500, 'entry',   ARRAY['A_acne','B_pore','C_sensitive','D_aging','E_bridal']),
  ('00000000-0000-0000-0000-000000000001', 'ヒト幹細胞導入(臍帯血)',         3300, 'entry',   ARRAY['A_acne','B_pore','C_sensitive','D_aging','E_bridal']),
  ('00000000-0000-0000-0000-000000000001', 'マイクロカレント',               3300, 'entry',   ARRAY['A_acne','B_pore','C_sensitive','D_aging','E_bridal']),
  ('00000000-0000-0000-0000-000000000001', '高濃度ヒト幹細胞パック',         3300, 'entry',   ARRAY['A_acne','B_pore','C_sensitive','D_aging','E_bridal']),
  ('00000000-0000-0000-0000-000000000001', 'モデリングパック各種',           3300, 'entry',   ARRAY['A_acne','B_pore','C_sensitive','D_aging','E_bridal']),
  ('00000000-0000-0000-0000-000000000001', '炭酸パック(プレミアム)',         4700, 'pore',    ARRAY['B_pore']),
  ('00000000-0000-0000-0000-000000000001', '導入パック各種',                 3300, 'entry',   ARRAY['A_acne','B_pore','C_sensitive','D_aging','E_bridal']),
  ('00000000-0000-0000-0000-000000000001', '毛穴スチーム',                   2200, 'pore',    ARRAY['B_pore']),
  ('00000000-0000-0000-0000-000000000001', '生コラーゲン塗布',               1100, 'sensitive', ARRAY['C_sensitive']),
  ('00000000-0000-0000-0000-000000000001', 'ビタミンC導入',                  2200, 'peeling', ARRAY['A_acne']),
  ('00000000-0000-0000-0000-000000000001', '生コラーゲンエアバリ導入',       3300, 'sensitive', ARRAY['C_sensitive']),
  ('00000000-0000-0000-0000-000000000001', 'エアバリ',                       3300, 'entry',   ARRAY['A_acne','B_pore','C_sensitive','D_aging','E_bridal']),
  ('00000000-0000-0000-0000-000000000001', 'フェイスマッサージ',             3300, 'lifting', ARRAY['D_aging']),
  ('00000000-0000-0000-0000-000000000001', 'デコルテマッサージ',             3300, 'entry',   ARRAY['A_acne','B_pore','C_sensitive','D_aging','E_bridal']),
  ('00000000-0000-0000-0000-000000000001', '造顔マッサージ',                 5500, 'lifting', ARRAY['D_aging']),
  ('00000000-0000-0000-0000-000000000001', 'ラジオ波(顔)',                   3300, 'lifting', ARRAY['D_aging']),
  ('00000000-0000-0000-0000-000000000001', '首ケア',                         6600, 'entry',   ARRAY['A_acne','B_pore','C_sensitive','D_aging','E_bridal']);
