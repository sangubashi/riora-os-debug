-- Migration: store_patterns RLS 最終化
-- 目的: 将来の store_id 追加に備えた構造を整える
-- 現状: profiles に store_id なし → authenticated ユーザー全員が同一店舗を共有
-- 実行: Supabase Dashboard > SQL Editor

-- ─── RLS ポリシー再確認（v2 migration で作成済みを上書き） ────────────────────

-- 既存ポリシーを安全に削除して再作成
DROP POLICY IF EXISTS "sp_read"  ON public.store_patterns;
DROP POLICY IF EXISTS "sp_write" ON public.store_patterns;

-- SELECT: 認証済みユーザー全員（単一サロン設計）
CREATE POLICY "sp_select" ON public.store_patterns
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- INSERT/UPDATE: owner または admin のみ
CREATE POLICY "sp_insert" ON public.store_patterns
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('owner', 'admin')
    )
  );

CREATE POLICY "sp_update" ON public.store_patterns
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('owner', 'admin')
    )
  );

-- DELETE: owner のみ
CREATE POLICY "sp_delete" ON public.store_patterns
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role = 'owner'
    )
  );

-- ─── サンプルデータ（動作確認用） ────────────────────────────────────────────
-- 実際のデータ挿入時は staff_id を自分の UUID に変更してください。

-- INSERT INTO public.store_patterns (
--   customer_tags, staff_id, action_type, action_content,
--   success_score, effectiveness, sample_size,
--   staff_style, last_updated, created_at
-- ) VALUES (
--   ARRAY['dry', 'aging'],
--   auth.uid(),
--   'ホームケア提案',
--   'セラミド配合ゲルを朝の保湿に推奨',
--   82, 0.78, 12,
--   '共感型',
--   now(), now()
-- );

-- ─── 確認クエリ ─────────────────────────────────────────────────────────────
-- SELECT id, action_type, effectiveness, sample_size
-- FROM public.store_patterns
-- ORDER BY effectiveness DESC LIMIT 10;
