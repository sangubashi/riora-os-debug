-- ================================================================
-- Riora Brain Phase2 - Repository & RPC Layer: brain_scenarios新設
--
-- 不足Repository洗い出し(ScenarioRepo)で判明したスキーマギャップを埋める。
-- ScenarioSelector(Step2-2)が要求するScenarioCandidateRow
-- (scenarioCode/priority/customerType/channel/updatedAt/lastSentAt)のうち、
-- lastSentAt以外はbrain_scenariosから取得する。
-- brain_success_patterns(店内)と対になるDM候補マスタ。store_id NULL =
-- ブランド標準シナリオ(全店舗で共有)。
-- ================================================================

CREATE TABLE IF NOT EXISTS public.brain_scenarios (
  id            text        PRIMARY KEY,
  store_id      uuid        REFERENCES public.brain_stores(id) ON DELETE CASCADE,
  customer_type text        NOT NULL CHECK (customer_type IN ('A_acne', 'B_pore', 'C_sensitive', 'D_aging', 'E_bridal')),
  priority      text        NOT NULL CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  channel       text        NOT NULL CHECK (channel IN ('LINE', 'SMS', 'EMAIL')),
  label         text        NOT NULL DEFAULT '',
  is_active     boolean     NOT NULL DEFAULT true,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brain_scenarios_store ON public.brain_scenarios (store_id);
CREATE INDEX IF NOT EXISTS idx_brain_scenarios_type ON public.brain_scenarios (customer_type);

COMMENT ON COLUMN public.brain_scenarios.store_id IS
  'NULL=ブランド標準シナリオ(全店舗で参照可)。値ありは当該店舗専用シナリオ。';
COMMENT ON COLUMN public.brain_scenarios.id IS
  'scenario_code(例: S-001)。ScenarioCandidateRow.scenarioCode / brain_line_send_queue.trigger_typeと対応。';

ALTER TABLE public.brain_scenarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS brain_scenarios_select ON public.brain_scenarios;
CREATE POLICY brain_scenarios_select ON public.brain_scenarios
  FOR SELECT
  USING (store_id IS NULL OR store_id = public.app_store_id());

DROP POLICY IF EXISTS brain_scenarios_write ON public.brain_scenarios;
CREATE POLICY brain_scenarios_write ON public.brain_scenarios
  FOR ALL
  USING (store_id = public.app_store_id())
  WITH CHECK (store_id = public.app_store_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.brain_scenarios TO authenticated, service_role;

-- ---------------------------------------------------------------
-- brain_line_send_queue: template_id / scheduled_at列を追加
--
-- LineSendQueuePayload(ScenarioQueueBuilder)はtemplate_id/scheduled_atを
-- 持つが既存brain_line_send_queueには列が無いため不足分を追加する。
-- message_draftは送信文言の確定をsend worker側に委ねるため、Repository層
-- (LineQueueRepo)からの挿入時はNOT NULL制約を外し空文字を許容する。
-- ---------------------------------------------------------------
ALTER TABLE public.brain_line_send_queue
  ADD COLUMN IF NOT EXISTS template_id text,
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ALTER COLUMN message_draft DROP NOT NULL,
  ALTER COLUMN message_draft SET DEFAULT '';

COMMENT ON COLUMN public.brain_line_send_queue.template_id IS
  'LineSendQueuePayload.template_id。本文はsend worker側でtemplate_id+変数から組み立てる。';
COMMENT ON COLUMN public.brain_line_send_queue.scheduled_at IS
  'LineSendQueuePayload.scheduled_at。';
