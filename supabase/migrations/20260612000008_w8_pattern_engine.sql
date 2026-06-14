-- ================================================================
-- Riora Brain Phase2 - W8: Success Pattern Final Architecture v1.0
-- 列追加(5テーブル) + pattern_fire_log新設 + pattern_step_stats matview
-- + brain_paramsシード(fire_score_weights/style_affinity/lifecycle_thresholds)
--
-- 対象範囲: 店内提案(in_store)のみ。brain_scenarios / scenario_outcomes /
-- scenario_trigger_log (DM側) は後続実装のため本マイグレーションでは扱わない。
-- ================================================================

-- ---------------------------------------------------------------
-- 1. brain_success_patterns: lifecycle_status / lifecycle_changed_at
-- 「候補(Candidate)」のライフサイクルはstep単位ではなくpattern単位で
-- 管理する(3-1の状態機械はpattern全体に対する遷移)。
-- ---------------------------------------------------------------
ALTER TABLE public.brain_success_patterns
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'active'
    CHECK (lifecycle_status IN ('candidate','testing','active','watch','demoted','suspended')),
  ADD COLUMN IF NOT EXISTS lifecycle_changed_at timestamptz;

-- ---------------------------------------------------------------
-- 2. brain_pattern_steps: soft_features / optimal_visit
-- ---------------------------------------------------------------
ALTER TABLE public.brain_pattern_steps
  ADD COLUMN IF NOT EXISTS soft_features jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS optimal_visit integer;

COMMENT ON COLUMN public.brain_pattern_steps.soft_features IS
  'Success Pattern Final v1.0 1-1。{ weights: Record<FeatureName, number> } 形式でcontextFitの特徴重みを保持(timing_proximityはw3で別枠のためweightsからは除く)。';
COMMENT ON COLUMN public.brain_pattern_steps.optimal_visit IS
  'timing_proximityの中心値(σ=1)。PatternScorerが exp(-((visit_count-optimal_visit)^2)/2) で使用。';

-- ---------------------------------------------------------------
-- 3. brain_pattern_progress: assign_score / switch_candidate / switch_streak
-- ---------------------------------------------------------------
ALTER TABLE public.brain_pattern_progress
  ADD COLUMN IF NOT EXISTS assign_score numeric,
  ADD COLUMN IF NOT EXISTS switch_candidate text,
  ADD COLUMN IF NOT EXISTS switch_streak integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.brain_pattern_progress.switch_streak IS
  'Success Pattern Final v1.0 2-3 ケース1。新パターンのAssignScoreが現行+0.15を上回った連続評価回数。2に達するとabandoned+切替。';

-- ---------------------------------------------------------------
-- 4. brain_proposal_outcomes: fire_score / decisive_factor
-- ---------------------------------------------------------------
ALTER TABLE public.brain_proposal_outcomes
  ADD COLUMN IF NOT EXISTS fire_score numeric,
  ADD COLUMN IF NOT EXISTS decisive_factor text;

COMMENT ON COLUMN public.brain_proposal_outcomes.fire_score IS
  'Success Pattern Final v1.0 1-2。当時のFireScore(0-100)。較正回帰の入力。';
COMMENT ON COLUMN public.brain_proposal_outcomes.decisive_factor IS
  'ExplainabilityEngineが判定したdecisive_factor(score_breakdown最大寄与項)。';

-- ---------------------------------------------------------------
-- 5. brain_staff_adjustments: affinity_score
-- ---------------------------------------------------------------
ALTER TABLE public.brain_staff_adjustments
  ADD COLUMN IF NOT EXISTS affinity_score numeric CHECK (affinity_score BETWEEN 0 AND 1);

COMMENT ON COLUMN public.brain_staff_adjustments.affinity_score IS
  'Success Pattern Final v1.0 1-2 w4(StaffAffinity)の実測EWMA値。NULLの場合はbrain_params(style_affinity)のpriorを使用。';

-- ---------------------------------------------------------------
-- 6. brain_pattern_fire_log(新設)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.brain_pattern_fire_log (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        uuid        NOT NULL REFERENCES public.brain_stores(id) ON DELETE CASCADE,
  customer_id     uuid        NOT NULL REFERENCES public.brain_customers(id) ON DELETE CASCADE,
  visit_id        uuid        REFERENCES public.brain_visits(id) ON DELETE SET NULL,
  decision_record jsonb       NOT NULL,
  explanation     text        NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brain_pattern_fire_log_customer ON public.brain_pattern_fire_log (customer_id, created_at DESC);

COMMENT ON TABLE public.brain_pattern_fire_log IS
  'Success Pattern Final v1.0 4章。ConflictResolver通過時にDecisionRecord+説明文を保存(Manager向けfire-log画面・Explainability evidence参照元)。';

ALTER TABLE public.brain_pattern_fire_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS brain_pattern_fire_log_store_isolation ON public.brain_pattern_fire_log;
CREATE POLICY brain_pattern_fire_log_store_isolation ON public.brain_pattern_fire_log
  FOR ALL
  USING (store_id = public.app_store_id())
  WITH CHECK (store_id = public.app_store_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.brain_pattern_fire_log TO authenticated, service_role;

-- ---------------------------------------------------------------
-- 7. brain_pattern_step_stats(マテリアライズドビュー)
-- 店内候補(brain_pattern_steps)のセル統計。DM側(scenario_outcomes)は
-- brain_scenarios未実装のため後続migrationでUNIONする。
-- セル粒度はPatternScorerのcellKey(candidate, customerType, staffStyle)に合わせ
-- (pattern_id, step_no, customer_type, staff_style)。ブランド横断集計
-- (brain_benchmarksと同様に店舗ロールへ全件SELECT許可・n>=10判定のベースライン)。
-- ---------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS public.brain_pattern_step_stats AS
SELECT
  (po.pattern_id || '-step' || po.step_no::text) AS candidate_code,
  po.pattern_id,
  po.step_no,
  po.customer_type,
  po.staff_style,
  count(*)::integer AS executed_n,
  count(*) FILTER (WHERE po.was_accepted)::integer AS accepted_n,
  ((count(*) FILTER (WHERE po.was_accepted))::numeric + 1)
    / ((count(*))::numeric + 3) AS laplace_rate,
  NULL::numeric AS repeat_rate_90d,
  avg(po.fire_score) AS avg_fire_score
FROM public.brain_proposal_outcomes po
WHERE po.was_executed = true
GROUP BY po.pattern_id, po.step_no, po.customer_type, po.staff_style;

CREATE UNIQUE INDEX IF NOT EXISTS idx_brain_pattern_step_stats_cell
  ON public.brain_pattern_step_stats (candidate_code, customer_type, staff_style);

COMMENT ON MATERIALIZED VIEW public.brain_pattern_step_stats IS
  'Success Pattern Final v1.0 5-2。PatternScorer.SuccessRate*(laplace_rate, n=executed_n)の入力。monthly-learning冒頭でREFRESH MATERIALIZED VIEW CONCURRENTLY。';

GRANT SELECT ON TABLE public.brain_pattern_step_stats TO authenticated, service_role;

-- ---------------------------------------------------------------
-- 8. brain_params シード(fire_score_weights / style_affinity / lifecycle_thresholds)
-- cluster='office_area'(新富店)。Phase1は参照のみ・Lv3起票で更新される。
-- ---------------------------------------------------------------
INSERT INTO public.brain_params (key, cluster, version, value)
VALUES
  ('fire_score_weights', 'office_area', 1,
    '{"w1":0.30,"w2":0.20,"w3":0.20,"w4":0.15,"w5":0.15}'::jsonb),
  ('style_affinity', 'office_area', 1,
    '{"evidence":{"homecare":0.5,"rebooking":0.5,"subscription":0.5,"upsell":0.5,"pack":0.5,"none":0.5},
      "theory":{"homecare":0.5,"rebooking":0.5,"subscription":0.5,"upsell":0.5,"pack":0.5,"none":0.5},
      "empathy":{"homecare":0.5,"rebooking":0.5,"subscription":0.5,"upsell":0.5,"pack":0.5,"none":0.5}}'::jsonb),
  ('lifecycle_thresholds', 'office_area', 1,
    '{"promotion":{"liftPt":10,"evaluationDays":60,"minN":20},
      "watchDemotion":{"benchmarkPercentile":25,"dropPt":20,"minN":20},
      "watchRecovery":{"periods":2,"periodDays":60,"minN":15},
      "demotion":{"watchDays":90,"minN":20},
      "suspension":{"acceptRateMin":0.10,"minN":15,"rejectRateMax":0.50,"rejectMinN":10}}'::jsonb)
ON CONFLICT (key, cluster, version) DO NOTHING;

-- ---------------------------------------------------------------
-- 9. 既存pattern_steps(8パターン28step)のoptimal_visit/soft_features初期値
-- soft_featuresは1-1のcontextFit入力5特徴(timing_proximityはw3で別枠)への
-- 既定重み(均等0.2)。optimal_visitは各stepのfire_condition visit_count閾値
-- (閾値を持たないstepは登場順を踏まえた近似値)。
-- ---------------------------------------------------------------
UPDATE public.brain_pattern_steps
SET soft_features = '{"weights":{"cycle_position":0.2,"condition_margin":0.2,"type_confidence":0.2,"csi_alignment":0.2,"skin_momentum":0.2}}'::jsonb
WHERE soft_features = '{}'::jsonb;

UPDATE public.brain_pattern_steps AS bps
SET optimal_visit = v.optimal_visit
FROM (VALUES
  ('A1',1,1), ('A1',2,2), ('A1',3,3), ('A1',4,4),
  ('A2',1,2), ('A2',2,2), ('A2',3,4),
  ('B1',1,1), ('B1',2,2), ('B1',3,3), ('B1',4,4),
  ('B2',1,2), ('B2',2,2), ('B2',3,4),
  ('C1',1,1), ('C1',2,2), ('C1',3,3), ('C1',4,4),
  ('D1',1,1), ('D1',2,2), ('D1',3,3), ('D1',4,4),
  ('D2',1,2), ('D2',2,3), ('D2',3,2),
  ('E1',1,1), ('E1',2,2), ('E1',3,3)
) AS v(pattern_id, step_no, optimal_visit)
WHERE bps.pattern_id = v.pattern_id AND bps.step_no = v.step_no
  AND bps.optimal_visit IS NULL;
