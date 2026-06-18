-- ================================================================
-- customer_notes: AI自動生成ノート対応
-- 目的: Voice Memo → AI解析 → カテゴリ分類保存
--
-- 変更内容:
--   1. category カラム追加 (Family/Work/Health/Preference/Event)
--   2. source カラム追加 (voice_note / manual)
--   3. voice_note_id カラム追加 (FK → voice_notes)
-- ================================================================

-- 1. category カラム
ALTER TABLE public.customer_notes
  ADD COLUMN IF NOT EXISTS category text
    CHECK (category IS NULL OR category IN ('Family','Work','Health','Preference','Event'));

-- 2. source カラム（既存レコードは 'manual' 扱い）
ALTER TABLE public.customer_notes
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('voice_note','manual'));

-- 3. voice_note_id カラム（AI生成ノートの出所追跡）
ALTER TABLE public.customer_notes
  ADD COLUMN IF NOT EXISTS voice_note_id uuid
    REFERENCES public.voice_notes(id) ON DELETE SET NULL;

-- 検索用インデックス
CREATE INDEX IF NOT EXISTS idx_customer_notes_category
  ON public.customer_notes (customer_id, category)
  WHERE category IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customer_notes_voice_note_id
  ON public.customer_notes (voice_note_id)
  WHERE voice_note_id IS NOT NULL;

-- RLS: UPDATE は自分のノートのみ（既存ポリシーを更新）
DROP POLICY IF EXISTS "cn_update" ON public.customer_notes;
CREATE POLICY "cn_update" ON public.customer_notes
  FOR UPDATE USING (
    staff_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('owner','admin')
    )
  );

-- DELETE ポリシー追加
DROP POLICY IF EXISTS "cn_delete" ON public.customer_notes;
CREATE POLICY "cn_delete" ON public.customer_notes
  FOR DELETE USING (
    staff_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('owner','admin')
    )
  );
