-- ================================================================
-- 顧客トップページ「契約書・その他資料」写真枠(4枚)機能: brain_customer_documents新設
-- 設計根拠: 2026-09-24ユーザー承認
--
-- 顧客ごとに最大4枚(スロット1〜4)の資料写真(契約書・その他)を登録・差し替えできる
-- ようにする。brain_customer_photos(body_part×photo_type、ゴースト・比較ロジック)とは
-- 完全に独立した新設テーブルとし、既存の写真カルテ機能には一切影響しない
-- (initial_questionnaire_photo_pathと同じ設計思想だが、4枚という複数スロットを
-- 持つためbrain_customersへの直接カラム追加ではなく専用テーブルとする)。
--
-- 実ファイルはbrain_customer_photosと同じStorage bucket(customer-photos)の
-- 'documents/{customerId}/slot-{slotIndex}.{ext}' プレフィックス配下に保存し、
-- このテーブルにはそのStorage上のパスのみを保持する(署名URLは都度API側で発行)。
--
-- 適用は別途明示的な承認があるまで行わない(本ファイルはレビュー用に作成のみ、
-- 既存のbrain_customer_facial_schemasマイグレーションと同じRLS/GRANT運用)。
-- ================================================================

-- ── 1. テーブル本体 ──────────────────────────────────────────────
CREATE TABLE public.brain_customer_documents (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  uuid        NOT NULL REFERENCES public.brain_customers(id) ON DELETE CASCADE,
  slot_index   smallint    NOT NULL CHECK (slot_index BETWEEN 1 AND 4),
  photo_path   text        NOT NULL,
  uploaded_at  timestamptz NOT NULL DEFAULT now(),
  created_by   uuid                 REFERENCES public.brain_staff(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ── 2. ユニーク制約(1顧客につき1スロット1行) ────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS ux_customer_documents_slot
  ON public.brain_customer_documents (customer_id, slot_index);

-- ── 3. インデックス ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_customer_documents_customer
  ON public.brain_customer_documents (customer_id);

-- ── 4. RLS ───────────────────────────────────────────────────────
-- brain_customer_facial_schemasと同じ「service_role限定」方式。
ALTER TABLE public.brain_customer_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bcd_select" ON public.brain_customer_documents;
CREATE POLICY "bcd_select" ON public.brain_customer_documents
  FOR SELECT TO service_role USING (true);

DROP POLICY IF EXISTS "bcd_insert" ON public.brain_customer_documents;
CREATE POLICY "bcd_insert" ON public.brain_customer_documents
  FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "bcd_update" ON public.brain_customer_documents;
CREATE POLICY "bcd_update" ON public.brain_customer_documents
  FOR UPDATE TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "bcd_delete" ON public.brain_customer_documents;
CREATE POLICY "bcd_delete" ON public.brain_customer_documents
  FOR DELETE TO service_role USING (true);

-- authenticated / anon 向けのポリシーは意図的に作成しない(default deny)。

-- ── 5. GRANT ─────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.brain_customer_documents
  TO service_role;

-- ================================================================
-- 適用後確認用SELECT(実行結果を目視確認してください)
-- ================================================================

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'brain_customer_documents'
ORDER BY ordinal_position;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'brain_customer_documents';
