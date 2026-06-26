-- ================================================================
-- Pass K-3: CSV取込未マッチメニュー 安全版補完
--
-- 目的: CustomerTypeEngine を機能させるため、target_types根拠が
--       明確なメニューのみ追加する。
--
-- 追加対象 (CSV元メニュー名 → brain_menus.name):
--   小顔矯正オプション   → 小顔矯正オプション  (lifting / D_aging)
--   フェイシャルエステ 60分 → フェイシャルエステ60分  (entry / all 5types・汎用)
--   保湿パック           → 保湿パック          (sensitive / C_sensitive)
--
-- 保留:
--   美白美容液導入 … target_types候補 E_bridal/A_acne の根拠不足。
--                   length=2は CustomerTypeEngine がスキップするため
--                   分類効果ゼロ。根拠が確定次第 別Migrationで追加する。
--
-- CustomerTypeEngine判定ルール (CustomerTypeEngine.ts:49):
--   targetTypes.length === 1 のメニューのみ分類シグナルになる。
--   → 小顔矯正オプション (D_aging, len=1): ✅ シグナル
--   → 保湿パック (C_sensitive, len=1):    ✅ シグナル
--   → フェイシャルエステ60分 (len=5):      ❌ 汎用扱い (entry設計と整合)
--
-- マッチング方式 (menuResolver.ts):
--   小顔矯正オプション  → exact_match
--   フェイシャルエステ60分 → normalized_match ("フェイシャルエステ 60分" のスペース除去後一致)
--   保湿パック          → exact_match
--
-- price は test CSV 実測平均値を暫定設定。本番価格が判明次第 UPDATE すること。
-- role は brain_menus_role_check 制約内の値のみ使用可
--   (entry / pore / sensitive / peeling / lifting / imported_other)
-- ================================================================

INSERT INTO public.brain_menus (id, store_id, name, price, role, target_types)
VALUES
  (
    '00000000-0000-0000-0000-000000000206',
    '00000000-0000-0000-0000-000000000001',
    '小顔矯正オプション',
    5500,
    'lifting',
    ARRAY['D_aging']
  ),
  (
    '00000000-0000-0000-0000-000000000207',
    '00000000-0000-0000-0000-000000000001',
    'フェイシャルエステ60分',
    5500,
    'entry',
    ARRAY['A_acne', 'B_pore', 'C_sensitive', 'D_aging', 'E_bridal']
  ),
  (
    '00000000-0000-0000-0000-000000000208',
    '00000000-0000-0000-0000-000000000001',
    '保湿パック',
    7000,
    'sensitive',
    ARRAY['C_sensitive']
  )
ON CONFLICT (id) DO NOTHING;
