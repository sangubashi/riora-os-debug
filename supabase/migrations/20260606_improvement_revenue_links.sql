-- ================================================================
-- Riora OS Phase 4: improvement_revenue_links テーブル作成
-- 実行: Supabase Dashboard > SQL Editor
--
-- 用途: improvement_action_logs の1件に対し
--       実際に発生した売上（customer_visits / reservations）を
--       紐付けるリンクテーブル。
--
--       1件のアクションに対して複数の売上が発生しうるため
--       action_log_id と revenue の N:1 構造にする。
-- ================================================================

CREATE TABLE IF NOT EXISTS public.improvement_revenue_links (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  action_log_id  uuid        NOT NULL
                 REFERENCES public.improvement_action_logs(id) ON DELETE CASCADE,
  customer_id    uuid        REFERENCES public.customers(id) ON DELETE SET NULL,
  visit_id       uuid        REFERENCES public.customer_visits(id) ON DELETE SET NULL,
  revenue        integer     NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_revenue_links_action_log
  ON public.improvement_revenue_links (action_log_id);

CREATE INDEX IF NOT EXISTS idx_revenue_links_customer
  ON public.improvement_revenue_links (customer_id);

ALTER TABLE public.improvement_revenue_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_all" ON public.improvement_revenue_links
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMENT ON TABLE public.improvement_revenue_links IS
  'AI改善アクション → 実発生売上の紐付け。1アクションに複数売上が紐付く場合を許容する。';
