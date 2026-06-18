-- ================================================================
-- 2026-06-18 Production Migration
-- Supabase Dashboard > SQL Editor に貼り付けて Run
--
-- 修正内容:
--   1. customer_notes: category/source/voice_note_id カラム追加
--   2. customer_notes: service_role GRANT 追加
--   3. booking_prompts:    authenticated + service_role GRANT 追加
--   4. contraindications:  authenticated + service_role GRANT 追加
--   5. handover_notes:     authenticated + service_role GRANT 追加
-- ================================================================

-- 1. customer_notes: AI解析用カラム追加

ALTER TABLE public.customer_notes
  ADD COLUMN IF NOT EXISTS category text
    CHECK (category IS NULL OR category IN ('Family','Work','Health','Preference','Event'));

ALTER TABLE public.customer_notes
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('voice_note','manual'));

ALTER TABLE public.customer_notes
  ADD COLUMN IF NOT EXISTS voice_note_id uuid
    REFERENCES public.voice_notes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_customer_notes_category
  ON public.customer_notes (customer_id, category)
  WHERE category IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customer_notes_voice_note_id
  ON public.customer_notes (voice_note_id)
  WHERE voice_note_id IS NOT NULL;

-- 2. customer_notes: RLS ポリシー更新 + GRANT

DROP POLICY IF EXISTS "cn_update" ON public.customer_notes;
CREATE POLICY "cn_update" ON public.customer_notes
  FOR UPDATE USING (
    staff_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('owner','admin')
    )
  );

DROP POLICY IF EXISTS "cn_delete" ON public.customer_notes;
CREATE POLICY "cn_delete" ON public.customer_notes
  FOR DELETE USING (
    staff_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('owner','admin')
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.customer_notes
  TO authenticated, service_role;

-- 3. booking_prompts: GRANT

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.booking_prompts
  TO authenticated, service_role;

-- 4. contraindications: GRANT

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.contraindications
  TO authenticated, service_role;

-- 5. handover_notes: GRANT

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.handover_notes
  TO authenticated, service_role;
