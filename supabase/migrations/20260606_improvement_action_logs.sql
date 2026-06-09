-- ================================================================
-- Riora OS Phase 4: improvement_action_logs テーブル作成
-- 実行: Supabase Dashboard > SQL Editor
--
-- 用途: ActionCoachPanel の「完了」ボタンで記録。
--       AI提案の実績・成功率・発生売上を蓄積する。
-- ================================================================

CREATE TABLE IF NOT EXISTS public.improvement_action_logs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_name       text        NOT NULL DEFAULT '',
  action_type      text        NOT NULL
                   CHECK (action_type IN (
                     'rebook_proposal', 'product_suggest',
                     'vip_upgrade', 'line_follow', 'other'
                   )),
  customer_id      uuid        REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name    text        NOT NULL DEFAULT '',
  metric           text        NOT NULL DEFAULT '',   -- nextReserveRate / vipRate 等
  created_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  result_type      text        CHECK (result_type IN ('success', 'fail', 'pending')),
  revenue_generated integer    DEFAULT 0,
  success          boolean     DEFAULT false,
  notes            text
);

CREATE INDEX IF NOT EXISTS idx_improvement_logs_staff
  ON public.improvement_action_logs (staff_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_improvement_logs_action_type
  ON public.improvement_action_logs (action_type, created_at DESC);

ALTER TABLE public.improvement_action_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_all" ON public.improvement_action_logs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMENT ON TABLE public.improvement_action_logs IS
  'AI改善提案の実行ログ。成功率・発生売上を蓄積してフィードバックループに使う。';
