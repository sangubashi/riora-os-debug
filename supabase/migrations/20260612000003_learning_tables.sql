-- ================================================================
-- Riora Brain Phase1 - Step1: 学習・運用キューテーブル
-- ================================================================

-- ---------------------------------------------------------------
-- brain_proposal_outcomes (仕様書2-6)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.brain_proposal_outcomes (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        uuid        NOT NULL REFERENCES public.brain_stores(id) ON DELETE CASCADE,
  customer_id     uuid        NOT NULL REFERENCES public.brain_customers(id) ON DELETE CASCADE,
  visit_id        uuid        NOT NULL REFERENCES public.brain_visits(id) ON DELETE CASCADE,
  staff_id        uuid        NOT NULL REFERENCES public.brain_staff(id) ON DELETE RESTRICT,
  pattern_id      text        NOT NULL REFERENCES public.brain_success_patterns(id) ON DELETE RESTRICT,
  step_no         integer     NOT NULL,
  proposal_kind   text        NOT NULL CHECK (proposal_kind IN ('homecare', 'rebooking', 'subscription', 'upsell', 'pack', 'none')),
  visit_count_at  integer     NOT NULL,
  was_briefed     boolean     NOT NULL DEFAULT false,
  was_executed    boolean     NOT NULL DEFAULT false,
  was_accepted    boolean     NOT NULL DEFAULT false,
  amount          integer     NOT NULL DEFAULT 0,
  customer_type   text        NOT NULL CHECK (customer_type IN ('A_acne', 'B_pore', 'C_sensitive', 'D_aging', 'E_bridal')),
  staff_style     text        NOT NULL CHECK (staff_style IN ('evidence', 'theory', 'empathy')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brain_proposal_outcomes_lookup
  ON public.brain_proposal_outcomes (store_id, customer_type, proposal_kind, visit_count_at);

COMMENT ON TABLE public.brain_proposal_outcomes IS
  'monthly-learningのセル集計(type×kind×visit_count_at×staff_style)の元データ。ProposalSuccessRate.rate()のn(=executed数)もここから算出。';

-- ---------------------------------------------------------------
-- brain_pattern_revisions (店舗ごとのLv2自己学習による改訂提案)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.brain_pattern_revisions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      uuid        NOT NULL REFERENCES public.brain_stores(id) ON DELETE CASCADE,
  pattern_id    text        NOT NULL REFERENCES public.brain_success_patterns(id) ON DELETE CASCADE,
  change_type   text        NOT NULL CHECK (change_type IN ('timing', 'condition', 'script', 'new_pattern', 'churn_weights', 'staff_adjustment')),
  before        jsonb       NOT NULL,
  after         jsonb       NOT NULL,
  evidence      jsonb       NOT NULL,
  status        text        NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'rejected', 'auto_applied')),
  decided_by    uuid,
  decided_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brain_pattern_revisions_pattern ON public.brain_pattern_revisions (pattern_id, status);

COMMENT ON TABLE public.brain_pattern_revisions IS
  '店舗単位のLv2改訂提案。起票前にLv4Validator.validateRevision()を必ず通過させること(DB制約では強制しない)。';
COMMENT ON COLUMN public.brain_pattern_revisions.evidence IS
  '{cells, n, rates}等、monthly-learningが算出した根拠数値一式。';

-- ---------------------------------------------------------------
-- brain_dashboard_daily
-- ---------------------------------------------------------------
-- 仕様書2-7のカラム詳細が未提供のため、3-A nightly-dashboard の出力項目
-- (月売上集計/着地予測/損益分岐点/各種率/segment_matrix/funnel/staff_matrix/
--  ai_insights) に基づき定義する。Step3でJSON形状の調整が必要な場合は
--  本マイグレーションを変更せず、ALTER TABLEで追記すること。
CREATE TABLE IF NOT EXISTS public.brain_dashboard_daily (
  store_id          uuid        NOT NULL REFERENCES public.brain_stores(id) ON DELETE CASCADE,
  snapshot_date     date        NOT NULL,
  monthly_sales     integer     NOT NULL DEFAULT 0,
  forecast_sales    integer     NOT NULL DEFAULT 0,
  breakeven_point   integer,
  repeat_rate_90d   numeric,
  rebooking_rate    numeric,
  homecare_rate     numeric,
  segment_matrix    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  funnel            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  staff_matrix      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  ai_insights       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, snapshot_date)
);

COMMENT ON COLUMN public.brain_dashboard_daily.breakeven_point IS
  'fixed_costs / (1 - variable_cost_rate)。business_settings.fixed_costsがNULLの場合はNULL。';

-- ---------------------------------------------------------------
-- brain_line_send_queue
-- 既存 public.line_send_queue とは別管理 (customers/customer_idの参照先が
-- brain_customers のため、テーブルを分離する)。
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.brain_line_send_queue (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        uuid        NOT NULL REFERENCES public.brain_stores(id) ON DELETE CASCADE,
  customer_id     uuid        NOT NULL REFERENCES public.brain_customers(id) ON DELETE CASCADE,
  message_draft   text        NOT NULL,
  trigger_type    text        NOT NULL,
  status          text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'sent', 'rejected')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brain_line_send_queue_status ON public.brain_line_send_queue (store_id, status);

-- ---------------------------------------------------------------
-- brain_evaluation_queue
-- saveVisitRecordでエンジン処理が例外を投げた場合の再評価キュー。
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.brain_evaluation_queue (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id    uuid        NOT NULL REFERENCES public.brain_visits(id) ON DELETE CASCADE,
  reason      text        NOT NULL,
  resolved    boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brain_evaluation_queue_unresolved
  ON public.brain_evaluation_queue (resolved)
  WHERE resolved = false;
