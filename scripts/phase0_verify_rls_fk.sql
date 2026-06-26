-- ================================================================
-- Phase 0 検証用(読み取り専用・データ変更なし)
-- ④RLS適用状態 / ⑤FK制約 を確認する
-- 3つのSELECTを順に実行し、結果をそれぞれ貼ってください。
-- ================================================================

-- ④-1: RLS有効化状態(全brain_*テーブル)
SELECT
  relname AS table_name,
  relrowsecurity AS rls_enabled
FROM pg_class
WHERE relname LIKE 'brain_%'
  AND relkind = 'r'
ORDER BY relname;

-- ④-2: ポリシー一覧(テーブルごとの件数・名前)
SELECT
  tablename AS table_name,
  count(*) AS policy_count,
  array_agg(policyname ORDER BY policyname) AS policies
FROM pg_policies
WHERE tablename LIKE 'brain_%'
GROUP BY tablename
ORDER BY tablename;

-- ⑤: FK制約一覧(brain_*テーブルの全FK)
SELECT
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS references_table,
  ccu.column_name AS references_column,
  rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
  ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
JOIN information_schema.referential_constraints rc
  ON tc.constraint_name = rc.constraint_name AND tc.table_schema = rc.constraint_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_name LIKE 'brain_%'
ORDER BY tc.table_name, kcu.column_name;
