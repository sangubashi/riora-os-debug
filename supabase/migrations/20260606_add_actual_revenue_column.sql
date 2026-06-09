-- ================================================================
-- Riora OS Phase 4: improvement_action_logs に実売上カラムを追加
-- 実行: Supabase Dashboard > SQL Editor
-- ================================================================

ALTER TABLE public.improvement_action_logs
  ADD COLUMN IF NOT EXISTS revenue_generated_actual integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS attribution_linked_at    timestamptz DEFAULT NULL;

COMMENT ON COLUMN public.improvement_action_logs.revenue_generated_actual IS
  'RevenueAttributionEngine が紐付けた実発生売上合計（NULL = 未評価）';
COMMENT ON COLUMN public.improvement_action_logs.attribution_linked_at IS
  '自動紐付けを実行した日時';
