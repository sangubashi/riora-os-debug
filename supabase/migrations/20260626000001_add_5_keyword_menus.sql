-- ================================================================
-- Pass L-3: keyword_match 用 5 メニュー追加
--
-- 目的: SalonBoard 長文メニュー名の keyword_match 解決率を向上させるため、
--       CSV に頻出するが既存 brain_menus に存在しなかったメニューを追加する。
--
-- 追加対象 (CSV元メニュー名 → brain_menus.name / keyword):
--   水素パック           → 水素パック    (sensitive / C_sensitive)
--   炭酸パック           → 炭酸パック    (pore     / B_pore)
--   ハイドラフェイシャル → ハイドラフェイシャル (pore / B_pore)
--   毛穴ごっそり         → 毛穴ごっそり  (pore     / B_pore)
--   EMS                  → EMS           (lifting  / D_aging)
--
-- keyword_match アルゴリズム (extractBrainMenuKeywords):
--   末尾価格数字を除去し + 区切りで分割。
--   SalonBoard 正規化名に全キーワードが含まれるか照合。
--
-- CustomerTypeEngine 整合:
--   全5件 target_types.length = 1 → CTシグナルとして機能する。
--
-- price = 0 は仮値。本番価格確定後に UPDATE すること。
-- role は brain_menus_role_check 制約内の値のみ使用可
--   (entry / pore / sensitive / peeling / lifting / imported_other)
-- ================================================================

INSERT INTO brain_menus (id, store_id, name, price, role, target_types)
VALUES
  (
    '00000000-0000-0000-0000-000000000210',
    '00000000-0000-0000-0000-000000000001',
    '水素パック',
    0,
    'sensitive',
    ARRAY['C_sensitive']
  ),
  (
    '00000000-0000-0000-0000-000000000211',
    '00000000-0000-0000-0000-000000000001',
    '炭酸パック',
    0,
    'pore',
    ARRAY['B_pore']
  ),
  (
    '00000000-0000-0000-0000-000000000212',
    '00000000-0000-0000-0000-000000000001',
    'ハイドラフェイシャル',
    0,
    'pore',
    ARRAY['B_pore']
  ),
  (
    '00000000-0000-0000-0000-000000000213',
    '00000000-0000-0000-0000-000000000001',
    '毛穴ごっそり',
    0,
    'pore',
    ARRAY['B_pore']
  ),
  (
    '00000000-0000-0000-0000-000000000214',
    '00000000-0000-0000-0000-000000000001',
    'EMS',
    0,
    'lifting',
    ARRAY['D_aging']
  )
ON CONFLICT (id) DO NOTHING;
