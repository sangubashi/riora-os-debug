-- ================================================================
-- Salon Boardカルテ貼り付け MVP (Phase1)
-- 設計: docs/CALTE_IMPORT_MVP_DESIGN.md §8.3
--
-- 変更内容:
--   1. customer_notes.source の CHECK 制約に 'salonboard' を追加
--   2. karte_imports テーブルを新規作成（カルテ原文の保持のみ・Phase1では
--      note_ids/contraindication_ids等の関連配列は持たない最小構成）
-- ================================================================

-- 1. customer_notes.source: 既存 CHECK (source IN ('voice_note','manual')) を
--    'salonboard' を含む形に置き換える（追加のみ・既存データへの影響なし）。
--    制約名を決め打ちせず、source列に付いている既存のCHECK制約をpg_constraintから
--    動的に検出してDROPする（20260616_customer_notes_ai.sqlは制約名を明示していない
--    ため、Postgresの自動命名に依存せず安全に置き換える）。
DO $$
DECLARE
  existing_check text;
BEGIN
  SELECT con.conname INTO existing_check
  FROM pg_constraint con
  JOIN pg_class rel   ON rel.oid = con.conrelid
  JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(con.conkey)
  WHERE rel.relname = 'customer_notes'
    AND con.contype = 'c'
    AND att.attname = 'source';

  IF existing_check IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.customer_notes DROP CONSTRAINT %I', existing_check);
  END IF;
END $$;

ALTER TABLE public.customer_notes
  ADD CONSTRAINT customer_notes_source_check
  CHECK (source IN ('voice_note', 'manual', 'salonboard'));

-- 2. karte_imports: カルテ原文の保持専用テーブル（Phase1最小構成）
CREATE TABLE IF NOT EXISTS public.karte_imports (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  uuid        NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  staff_id     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  raw_text     text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_karte_imports_customer_created
  ON public.karte_imports (customer_id, created_at DESC);

-- RLS: customer_notes/contraindicationsと同水準（単一サロン設計、全認証ユーザーが
-- 参照・書込可、アクセス制御はAPI層のcanAccessCustomer()に委ねる）
ALTER TABLE public.karte_imports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ki_select" ON public.karte_imports;
CREATE POLICY "ki_select" ON public.karte_imports
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "ki_insert" ON public.karte_imports;
CREATE POLICY "ki_insert" ON public.karte_imports
  FOR INSERT TO authenticated WITH CHECK (true);

-- GRANT: RLSポリシーとは別に、テーブルレベルのGRANTが必要
-- (このプロジェクトでの既知の落とし穴。20260618_fix_grants.sqlで
-- customer_notes/contraindications/booking_prompts/handover_notesにも
-- 同様のGRANT欠落が過去に発生し、RLSポリシーがあってもservice_role/authenticatedの
-- 実行が"permission denied for table"で拒否される原因になっていた)
GRANT SELECT, INSERT
  ON TABLE public.karte_imports
  TO authenticated, service_role;

-- ================================================================
-- 適用後確認用SELECT（実行結果を目視確認してください）
-- ================================================================

-- 3a. customer_notes.source の CHECK 制約に 'salonboard' が含まれているか
SELECT con.conname, pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
WHERE rel.relname = 'customer_notes' AND con.contype = 'c'
  AND pg_get_constraintdef(con.oid) ILIKE '%source%';

-- 3b. karte_imports テーブルの列構成
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'karte_imports'
ORDER BY ordinal_position;

-- 3c. karte_imports の外部キー（customer_id → public.customers.id になっているか）
SELECT
  tc.table_name AS from_table,
  kcu.column_name AS from_column,
  ccu.table_name AS references_table,
  ccu.column_name AS references_column
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
  ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND tc.table_name = 'karte_imports';

-- 3d. karte_imports の RLS ポリシー確認
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'karte_imports';

-- 3e. karte_imports のテーブルレベルGRANT確認（authenticated/service_roleにSELECT・INSERTがあるか）
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'karte_imports'
  AND grantee IN ('authenticated', 'service_role')
ORDER BY grantee, privilege_type;
