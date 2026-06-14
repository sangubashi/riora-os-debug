-- ================================================================
-- Riora Brain Phase1 - Step1: RLSポリシー
--
-- 店舗系テーブル: store_id = current_setting('app.store_id', true)::uuid
-- (app.store_id未設定セッションでは0件、別storeのデータは不可視)
--
-- brain_* (ブランド横断) テーブル: service_roleのみ書込可
-- (Edge Functionはservice_roleで動作しRLSをバイパスするため、
--  関数内でstore_idを明示フィルタすること)。
-- ================================================================

-- 現在セッションのstore_id (app.store_id GUC) を取得するヘルパー。
-- 未設定 / 空文字の場合はNULLを返す(NULL比較は常にfalseとなり0件になる)。
CREATE OR REPLACE FUNCTION public.app_store_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.store_id', true), '')::uuid
$$;

-- ---------------------------------------------------------------
-- brain_stores (id = app.store_id)
-- ---------------------------------------------------------------
ALTER TABLE public.brain_stores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS brain_stores_self_access ON public.brain_stores;
CREATE POLICY brain_stores_self_access ON public.brain_stores
  FOR ALL
  USING (id = public.app_store_id())
  WITH CHECK (id = public.app_store_id());

-- ---------------------------------------------------------------
-- store_id を直接持つ店舗系テーブル
-- ---------------------------------------------------------------
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'brain_staff',
    'brain_customers',
    'brain_menus',
    'brain_bookings',
    'brain_subscriptions',
    'brain_visits',
    'brain_business_settings',
    'brain_proposal_outcomes',
    'brain_pattern_revisions',
    'brain_dashboard_daily',
    'brain_line_send_queue'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_store_isolation', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL USING (store_id = public.app_store_id()) WITH CHECK (store_id = public.app_store_id())',
      tbl || '_store_isolation', tbl
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------
-- brain_success_patterns (store_id NULL = ブランド標準。全店舗からSELECT可)
-- ---------------------------------------------------------------
ALTER TABLE public.brain_success_patterns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS brain_success_patterns_select ON public.brain_success_patterns;
CREATE POLICY brain_success_patterns_select ON public.brain_success_patterns
  FOR SELECT
  USING (store_id IS NULL OR store_id = public.app_store_id());

DROP POLICY IF EXISTS brain_success_patterns_write ON public.brain_success_patterns;
CREATE POLICY brain_success_patterns_write ON public.brain_success_patterns
  FOR ALL
  USING (store_id = public.app_store_id())
  WITH CHECK (store_id = public.app_store_id());

-- ---------------------------------------------------------------
-- store_idを直接持たないが、親テーブル経由でstore_idを辿れるテーブル
-- ---------------------------------------------------------------
ALTER TABLE public.brain_pattern_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS brain_pattern_steps_isolation ON public.brain_pattern_steps;
CREATE POLICY brain_pattern_steps_isolation ON public.brain_pattern_steps
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.brain_success_patterns sp
      WHERE sp.id = brain_pattern_steps.pattern_id
        AND (sp.store_id IS NULL OR sp.store_id = public.app_store_id())
    )
  );

ALTER TABLE public.brain_pattern_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS brain_pattern_progress_isolation ON public.brain_pattern_progress;
CREATE POLICY brain_pattern_progress_isolation ON public.brain_pattern_progress
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.brain_customers c
      WHERE c.id = brain_pattern_progress.customer_id
        AND c.store_id = public.app_store_id()
    )
  );

ALTER TABLE public.brain_skin_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS brain_skin_records_isolation ON public.brain_skin_records;
CREATE POLICY brain_skin_records_isolation ON public.brain_skin_records
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.brain_customers c
      WHERE c.id = brain_skin_records.customer_id
        AND c.store_id = public.app_store_id()
    )
  );

ALTER TABLE public.brain_staff_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS brain_staff_adjustments_isolation ON public.brain_staff_adjustments;
CREATE POLICY brain_staff_adjustments_isolation ON public.brain_staff_adjustments
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.brain_staff s
      WHERE s.id = brain_staff_adjustments.staff_id
        AND s.store_id = public.app_store_id()
    )
  );

ALTER TABLE public.brain_evaluation_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS brain_evaluation_queue_isolation ON public.brain_evaluation_queue;
CREATE POLICY brain_evaluation_queue_isolation ON public.brain_evaluation_queue
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.brain_visits v
      WHERE v.id = brain_evaluation_queue.visit_id
        AND v.store_id = public.app_store_id()
    )
  );

-- ---------------------------------------------------------------
-- brain_* ブランド横断テーブル
-- brain_events / brain_revisions: ポリシー無し
--   → authenticated/anonからは常に0件。service_role(RLSバイパス)のみ書込可。
-- brain_pattern_library: status='approved'のみ店舗ロールにSELECT許可
-- brain_benchmarks / brain_params: 店舗ロールに全件SELECT許可
-- ---------------------------------------------------------------
ALTER TABLE public.brain_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brain_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brain_pattern_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brain_benchmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brain_params ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS brain_pattern_library_read_approved ON public.brain_pattern_library;
CREATE POLICY brain_pattern_library_read_approved ON public.brain_pattern_library
  FOR SELECT
  USING (status = 'approved');

DROP POLICY IF EXISTS brain_benchmarks_read ON public.brain_benchmarks;
CREATE POLICY brain_benchmarks_read ON public.brain_benchmarks
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS brain_params_read ON public.brain_params;
CREATE POLICY brain_params_read ON public.brain_params
  FOR SELECT
  USING (true);

-- ---------------------------------------------------------------
-- テーブル権限 (RLSポリシーだけでは不十分。GRANTが無いと
-- "permission denied" / "table not found in schema cache" になる)
-- ---------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO authenticated, service_role;

DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename LIKE 'brain_%'
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated, service_role', tbl);
  END LOOP;
END $$;
