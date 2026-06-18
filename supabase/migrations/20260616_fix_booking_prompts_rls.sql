-- ================================================================
-- booking_prompts RLS ポリシー修正
-- 変更点: deprecated な auth.role() = 'authenticated' を
--          TO authenticated USING (true) パターンへ統一
--
-- 理由:
--   auth.role() は Supabase で deprecated。
--   anonymous sign-in が有効な環境では匿名ユーザーも
--   'authenticated' Postgres ロールを持つため意図せず通過してしまう。
--   TO authenticated 句で Postgres ロールを直接指定するのが正しい方法。
-- ================================================================

-- 既存ポリシーをすべて削除
DROP POLICY IF EXISTS "bp_select" ON public.booking_prompts;
DROP POLICY IF EXISTS "bp_insert" ON public.booking_prompts;
DROP POLICY IF EXISTS "bp_update" ON public.booking_prompts;

-- 再作成（TO authenticated パターン）
CREATE POLICY "bp_select" ON public.booking_prompts
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "bp_insert" ON public.booking_prompts
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "bp_update" ON public.booking_prompts
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);
